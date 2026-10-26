package ru.opodoydet.server.config;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.accounts.auth.Passwords;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.server.support.TestDatabases.Database;
import ru.opodoydet.shared.Json;

class StartupImportsIntegrationTest {
  @TempDir Path temp;
  private static final String OWNER_TOKEN = "A".repeat(43);
  private static final String STRANGER_TOKEN = "B".repeat(43);
  private static final String PRIVATE = "PRIVATE_STARTUP_IMPORT_CANARY";
  private static final String RECOVERY = "Сервер был перезапущен. Запустите подбор с помощником заново.";
  private static final String CREATED = "2026-10-25T00:00:00Z";

  @Test
  void firstStartupRecoversImportedRunsBeforeServingPrivateHistoryWithoutChangingSqlite()
      throws Exception {
    Path source = temp.resolve("synthetic-advisor-history.sqlite3");
    ObjectNode completed = run("import-completed", "completed");
    createFixture(source, completed);
    byte[] original = Files.readAllBytes(source);
    Instant before = Instant.now();
    try (Database app = TestDatabases.startWithLegacyFixture(
        Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of()),
        Map.of("ACCOUNT_MODE", "true", "ADVISOR_PYTHON", temp.resolve("must-not-run-python").toString()),
        original)) {
      // This is the first real HTTP startup after SQLite import, not a manual recovery call.
      JsonNode history = get(app, "/advisor/runs", OWNER_TOKEN, 200);
      assertEquals(3, history.size());
      for (String id : List.of("import-queued", "import-running")) {
        JsonNode recovered = get(app, "/advisor/runs/" + id, OWNER_TOKEN, 200);
        assertEquals("failed", Json.str(recovered, "status"));
        assertEquals(RECOVERY, Json.str(recovered, "error"));
        assertEquals(PRIVATE, recovered.path("context").path("trip").path("text").asText());
        assertFalse(Instant.parse(Json.str(recovered, "updatedAt")).isBefore(before));
        assertEquals(CREATED, Json.str(recovered, "createdAt"));
      }
      assertEquals(completed, get(app, "/advisor/runs/import-completed", OWNER_TOKEN, 200));
      assertEquals(1, get(app, "/advisor/runs", STRANGER_TOKEN, 200).size());
      assertTrue(get(app, "/advisor/runs", null, 200).isEmpty());
      JsonNode denied = get(app, "/advisor/runs/import-running", STRANGER_TOKEN, 404);
      assertFalse(denied.toString().contains(PRIVATE));
      assertEquals("account:startup-owner", app.jdbc()
          .sql("SELECT owner_key FROM advisor_run WHERE id='import-running'")
          .query(String.class).single());
      assertArrayEquals(original, Files.readAllBytes(source));
      Path importedSource = Path.of(app.env().get("LEGACY_DB_PATH"));
      assertTrue(importedSource.startsWith(app.directory()));
      assertArrayEquals(original, Files.readAllBytes(importedSource));

      JsonNode repaired = get(app, "/advisor/runs/import-running", OWNER_TOKEN, 200);
      ObjectNode correction = completed.deepCopy().put("report", "Changed after migration");
      app.store().saveAdvisorRun(correction);
      app.restart();
      assertEquals(repaired, get(app, "/advisor/runs/import-running", OWNER_TOKEN, 200));
      assertEquals(correction, get(app, "/advisor/runs/import-completed", OWNER_TOKEN, 200));
      assertEquals(3, get(app, "/advisor/runs", OWNER_TOKEN, 200).size());
      assertArrayEquals(original, Files.readAllBytes(source));
      assertArrayEquals(original, Files.readAllBytes(importedSource));
    }
  }

  private static ObjectNode run(String id, String status) {
    return Json.obj("id", id, "status", status, "mode", "local", "createdAt", CREATED,
        "updatedAt", CREATED, "context", Json.obj("trip", Json.obj("region", "Пусан", "text", PRIVATE)),
        "report", status.equals("completed") ? "Saved completed report" : null);
  }

  private static void createFixture(Path file, JsonNode completed) throws Exception {
    try (var connection = DriverManager.getConnection("jdbc:sqlite:" + file);
        var sql = connection.createStatement()) {
      sql.execute("CREATE TABLE account_users(id TEXT PRIMARY KEY,email TEXT,password_hash TEXT,role TEXT,name TEXT,created_at TEXT)");
      sql.execute("CREATE TABLE account_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at TEXT)");
      sql.execute("CREATE TABLE advisor_runs(region TEXT,id TEXT,created_at TEXT,body TEXT,PRIMARY KEY(region,id))");
      sql.execute("CREATE TABLE advisor_run_owners(region TEXT,run_id TEXT,owner_key TEXT,PRIMARY KEY(region,run_id))");
      for (String user : List.of("startup-owner", "startup-stranger")) {
        try (var insert = connection.prepareStatement("INSERT INTO account_users VALUES(?,?,?,?,?,?)")) {
          insert.setString(1, user);
          insert.setString(2, user + "@example.test");
          insert.setString(3, "unused-password-hash");
          insert.setString(4, "user");
          insert.setString(5, user);
          insert.setString(6, CREATED);
          insert.executeUpdate();
        }
        try (var insert = connection.prepareStatement("INSERT INTO account_sessions VALUES(?,?,?)")) {
          insert.setString(1, Passwords.digest(user.equals("startup-owner") ? OWNER_TOKEN : STRANGER_TOKEN));
          insert.setString(2, user);
          insert.setString(3, "2100-01-01T00:00:00Z");
          insert.executeUpdate();
        }
      }
      for (JsonNode run : List.of(run("import-queued", "queued"), run("import-running", "running"),
          completed, run("stranger-completed", "completed"))) {
        try (var insert = connection.prepareStatement("INSERT INTO advisor_runs VALUES(?,?,?,?)")) {
          insert.setString(1, "Пусан");
          insert.setString(2, Json.str(run, "id"));
          insert.setString(3, CREATED);
          insert.setString(4, Json.write(run));
          insert.executeUpdate();
        }
        try (var insert = connection.prepareStatement("INSERT INTO advisor_run_owners VALUES(?,?,?)")) {
          insert.setString(1, "Пусан");
          insert.setString(2, Json.str(run, "id"));
          insert.setString(3, Json.str(run, "id").startsWith("stranger")
              ? "account:startup-stranger" : "account:startup-owner");
          insert.executeUpdate();
        }
      }
    }
  }

  private static JsonNode get(Database app, String path, String token, int expected) throws Exception {
    var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + app.port() + "/api" + path)).GET();
    if (token != null) request.header("Cookie", "op_account_session=" + token);
    try (HttpClient client = HttpClient.newBuilder().proxy(HttpClient.Builder.NO_PROXY).build()) {
      var response = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
      assertEquals(expected, response.statusCode(), response.body());
      return Json.read(response.body());
    }
  }
}
