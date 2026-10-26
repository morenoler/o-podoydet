package ru.opodoydet.server.migration;

import org.springframework.test.context.ContextConfiguration;
import ru.opodoydet.server.support.IsolatedPostgresInitializer;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Files;
import java.sql.DriverManager;
import java.security.MessageDigest;
import org.junit.jupiter.api.io.TempDir;
import java.util.Map;
import java.util.List;
import com.fasterxml.jackson.databind.node.ObjectNode;
import ru.opodoydet.shared.Json;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.server.catalog.SeedImporter;
import ru.opodoydet.server.support.TestDatabases;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * Перенос учебной демо-базы старого бэкенда ({@code data/demo/preview.sqlite3}) в PostgreSQL:
 * данные на месте, а учебный аккаунт входит с тем же паролем — хеши паролей совместимы.
 */
@ContextConfiguration(initializers = IsolatedPostgresInitializer.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SqliteImporterIntegrationTest {

  static final Path DEMO = Path.of("../data/demo/preview.sqlite3");

  @TempDir Path temp;

  @Autowired SqliteImporter importer;
  @Autowired SeedImporter seedImporter;
  @Autowired Store store;
  @Autowired JdbcClient jdbc;
  @LocalServerPort int port;

  @Test
  void importsDemoAccountsAndKeepsPasswordsWorking() throws Exception {
    Map<String, Integer> copied = importer.importFile(DEMO.toAbsolutePath());

    assertThat(count("SELECT count(*) FROM account_users WHERE email LIKE '%@demo.test'")).isEqualTo(2);
    assertThat(count("SELECT count(*) FROM account_listings l JOIN account_users u ON u.id = l.host_id"
            + " WHERE u.email = 'host@demo.test'")).isEqualTo(4);
    assertThat(count("SELECT count(*) FROM account_bookings b JOIN account_users u ON u.id = b.user_id"
            + " WHERE u.email = 'user@demo.test'")).isEqualTo(6);
    assertThat(copied).containsKeys("account_users", "account_listings", "account_bookings", "account_questions");

    // Повторный импорт ничего не дублирует.
    importer.importFile(DEMO.toAbsolutePath());
    assertThat(count("SELECT count(*) FROM account_users WHERE email LIKE '%@demo.test'")).isEqualTo(2);

    HttpResponse<String> login =
        HttpClient.newBuilder()
            .proxy(HttpClient.Builder.NO_PROXY)
            .build()
            .send(
                HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/auth/login"))
                    .header("Content-Type", "application/json")
                    .POST(
                        HttpRequest.BodyPublishers.ofString(
                            "{\"email\":\"user@demo.test\",\"password\":\"UserDemo2026!\"}"))
                    .build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(login.statusCode()).isEqualTo(200);
    assertThat(login.headers().allValues("Set-Cookie")).anyMatch(c -> c.startsWith("op_account_session="));
  }

  @Test
  void importsPrivateHistoriesScopeGenerationsAndAdvisorOwnershipWithoutChangingSqlite() throws Exception {
    seedImporter.importSeed(Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of()));
    Path source = temp.resolve("private-history.sqlite3");
    try (var connection = DriverManager.getConnection("jdbc:sqlite:" + source);
        var statement = connection.createStatement()) {
      for (String sql : Files.readString(Path.of("../data/demo/sqlite-schema/accounts-schema.sql")).split(";"))
        if (!sql.isBlank()) statement.execute(sql);
      statement.executeUpdate("INSERT INTO account_users(id,email,password_hash,role,name,created_at) VALUES"
          + "('import-host','import-host@example.test','unused','host','Host','2026-10-25T00:00:00Z'),"
          + "('import-guest','import-guest@example.test','unused','user','Guest','2026-10-25T00:00:00Z')");
      statement.executeUpdate("INSERT INTO account_listings(id,host_id,title,description,city,address,room_type,capacity,price_per_night,amenities,status,created_at,updated_at)"
          + " VALUES('import-listing','import-host','Imported room','Description of imported room','Пусан','Street 1','Room',3,10000,'[]','published','2026-10-25T00:00:00Z','2026-10-25T00:00:00Z')");
      statement.executeUpdate("INSERT INTO account_listing_scopes(listing_id,generation) VALUES('import-listing',7)");
      statement.executeUpdate("INSERT INTO account_clarifications(id,listing_id,user_id,feature,question_text,note,trip,context,scope_fingerprint,created_at,version,request_key,payload_hash)"
          + " VALUES('import-question','import-listing','import-guest','courtyard','Question','PRIVATE_IMPORT_NOTE','{\"text\":\"PRIVATE_IMPORT_TRIP\"}','{}','original-scope','2026-10-25T00:00:00Z',2,'import-ask-key','ask-hash')");
      statement.executeUpdate("INSERT INTO account_clarification_answers(id,clarification_id,host_id,version,value,answer_text,recorded_at,recheck_at,scope_fingerprint,supersedes,superseded_by,request_key,payload_hash)"
          + " VALUES('import-a1','import-question','import-host',1,1,'PRIVATE_FIRST','2026-10-25T01:00:00Z','2027-01-01T00:00:00Z','original-scope','[]','import-a2','import-answer-1','answer-hash-1'),"
          + "('import-a2','import-question','import-host',2,NULL,'PRIVATE_UNKNOWN','2026-10-25T02:00:00Z','2027-01-01T00:00:00Z','original-scope','[\"import-a1\"]',NULL,'import-answer-2','answer-hash-2')");
      statement.execute("CREATE TABLE advisor_runs(region TEXT NOT NULL,id TEXT PRIMARY KEY,created_at TEXT NOT NULL,body TEXT NOT NULL)");
      statement.execute("CREATE TABLE advisor_run_owners(region TEXT NOT NULL,run_id TEXT NOT NULL,owner_key TEXT NOT NULL,PRIMARY KEY(region,run_id))");
      statement.executeUpdate("INSERT INTO advisor_runs VALUES('Пусан','import-run','2026-10-25T00:00:00Z','{}')");
      statement.executeUpdate("INSERT INTO advisor_run_owners VALUES('Пусан','import-run','account:import-guest'),('Другой регион','import-run','account:someone-else')");
    }
    byte[] before = MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(source));
    Map<String, Integer> copied = importer.importFile(source);
    assertThat(copied).containsEntry("account_listing_scopes", 1).containsEntry("account_clarifications", 1)
        .containsEntry("account_clarification_answers", 2).containsEntry("advisor_run", 1);
    assertThat(jdbc.sql("SELECT generation FROM account_listing_scopes WHERE listing_id='import-listing'").query(Integer.class).single()).isEqualTo(7);
    assertThat(jdbc.sql("SELECT version FROM account_clarifications WHERE id='import-question'").query(Integer.class).single()).isEqualTo(2);
    assertThat(jdbc.sql("SELECT note FROM account_clarifications WHERE id='import-question'").query(String.class).single()).isEqualTo("PRIVATE_IMPORT_NOTE");
    assertThat(jdbc.sql("SELECT superseded_by FROM account_clarification_answers WHERE id='import-a1'").query(String.class).single()).isEqualTo("import-a2");
    assertThat(count("SELECT count(*) FROM account_clarification_answers WHERE id='import-a2' AND value IS NULL AND superseded_by IS NULL")).isEqualTo(1);
    assertThat(jdbc.sql("SELECT region FROM advisor_run WHERE id='import-run'").query(String.class).single()).isEqualTo("Пусан");
    assertThat(jdbc.sql("SELECT owner_key FROM advisor_run WHERE id='import-run'").query(String.class).single()).isEqualTo("account:import-guest");
    assertThat(store.advisorRun("import-run", "account:import-guest")).isNotNull();
    assertThat(store.advisorRuns("account:import-guest")).hasSize(1);
    assertThat(store.advisorRun("import-run", "account:someone-else")).isNull();
    assertThat(store.advisorRuns("account:someone-else")).isEmpty();
    // Existing PostgreSQL edits win on any subsequent import, including newly added tables.
    jdbc.sql("UPDATE account_listing_scopes SET generation=8 WHERE listing_id='import-listing'").update();
    importer.importFile(source);
    assertThat(jdbc.sql("SELECT generation FROM account_listing_scopes WHERE listing_id='import-listing'").query(Integer.class).single()).isEqualTo(8);
    assertThat(count("SELECT count(*) FROM account_clarification_answers WHERE clarification_id='import-question'")).isEqualTo(2);
    assertThat(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(source))).containsExactly(before);
  }

  @Test
  void advisorHistoryWithoutOwnerIsPreservedButRemainsUnowned() throws Exception {
    Path source = temp.resolve("old-advisor.sqlite3");
    try (var connection = DriverManager.getConnection("jdbc:sqlite:" + source);
        var statement = connection.createStatement()) {
      statement.execute("CREATE TABLE advisor_runs(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,body TEXT NOT NULL)");
      statement.executeUpdate("INSERT INTO advisor_runs VALUES('import-unowned-run','2026-10-25T00:00:00Z','{}')");
    }
    importer.importFile(source);
    assertThat(jdbc.sql("SELECT owner_key FROM advisor_run WHERE id='import-unowned-run'").query(String.class).single())
        .isEqualTo("legacy-unowned");
  }

  @Test
  void foreignRegionFactCannotAttachToLocalHotelAndRollsBackOtherImportedTables() throws Exception {
    try (var db = TestDatabases.create(hostSeed())) {
      Path source = factSource("foreign-fact.sqlite3", "Другой регион",
          fact("foreign-fact", "import-hotel", "import-room", null));
      try (var connection = DriverManager.getConnection("jdbc:sqlite:" + source);
          var statement = connection.createStatement()) {
        statement.execute("CREATE TABLE advisor_runs(region TEXT,id TEXT,created_at TEXT,body TEXT)");
        statement.executeUpdate("INSERT INTO advisor_runs VALUES('Пусан','rolled-back-run','2026-10-26','{}')");
      }
      assertThatThrownBy(() -> db.context().getBean(SqliteImporter.class).importFile(source))
          .hasMessageContaining("region collision");
      assertThat(db.jdbc().sql("SELECT count(*) FROM evidence").query(Long.class).single()).isZero();
      assertThat(db.jdbc().sql("SELECT count(*) FROM advisor_run").query(Long.class).single()).isZero();
    }
  }

  @Test
  void catalogQuestionCannotAttachToAnotherRegionsHotel() throws Exception {
    try (var db = TestDatabases.create(hostSeed())) {
      Path source = temp.resolve("foreign-question.sqlite3");
      try (var connection = DriverManager.getConnection("jdbc:sqlite:" + source);
          var statement = connection.createStatement()) {
        statement.execute("CREATE TABLE questions(region TEXT,id TEXT,hotel_id TEXT,room_id TEXT,feature TEXT,body TEXT)");
        statement.executeUpdate("INSERT INTO questions VALUES('Другой регион','foreign-question',"
            + "'import-hotel','import-room','courtyard','{}')");
      }
      assertThatThrownBy(() -> db.context().getBean(SqliteImporter.class).importFile(source))
          .hasMessageContaining("Question/hotel region collision");
      assertThat(db.jdbc().sql("SELECT count(*) FROM catalog_question").query(Long.class).single())
          .isZero();
      assertThat(db.store().region()).isEqualTo("Пусан");
    }
  }

  @Test
  void importingAgainPreservesPostgresCorrectionsButRestoresNewSameSubjectReplacementChains() throws Exception {
    try (var db = TestDatabases.create(hostSeed())) {
      Path source = factSource("replacements.sqlite3", "Пусан",
          fact("import-first", "import-hotel", "import-room", "import-second"),
          fact("import-second", "import-hotel", "import-room", null));
      SqliteImporter isolated = db.context().getBean(SqliteImporter.class);
      assertThat(isolated.importFile(source)).containsEntry("evidence", 2);
      assertThat(db.jdbc().sql("SELECT source_url FROM evidence WHERE id='import-first'")
          .query(String.class).single()).isEqualTo("https://example.test/import-source");
      assertThat(db.jdbc().sql("SELECT count(*) FROM evidence WHERE id='import-first'"
          + " AND source_date=TIMESTAMPTZ '2026-10-01T00:00:00Z'")
          .query(Long.class).single()).isEqualTo(1);
      assertThat(db.jdbc().sql("SELECT superseded_by FROM evidence WHERE id='import-first'")
          .query(String.class).single()).isEqualTo("import-second");
      db.jdbc().sql("UPDATE evidence SET superseded_by=NULL, quote='PostgreSQL correction', active=TRUE"
          + " WHERE id='import-first'").update();
      assertThat(isolated.importFile(source)).containsEntry("evidence", 0);
      assertThat(db.jdbc().sql("SELECT count(*) FROM evidence WHERE id='import-first'"
          + " AND superseded_by IS NULL AND quote='PostgreSQL correction' AND active")
          .query(Long.class).single()).isEqualTo(1);
      Path additional = factSource("additional.sqlite3", "Пусан",
          fact("import-third", "import-hotel", "import-room", "import-second"));
      assertThat(isolated.importFile(additional)).containsEntry("evidence", 1);
      assertThat(db.jdbc().sql("SELECT superseded_by FROM evidence WHERE id='import-third'")
          .query(String.class).single()).isEqualTo("import-second");
    }
  }

  @Test
  void rejectsCrossSubjectReplacementAndGlobalEvidenceIdCollisions() throws Exception {
    try (var db = TestDatabases.create(hostSeed())) {
      SqliteImporter isolated = db.context().getBean(SqliteImporter.class);
      Path crossSubject = factSource("cross-subject.sqlite3", "Пусан",
          fact("subject-a", "import-hotel", "import-room", "subject-b"),
          fact("subject-b", "other-hotel", "other-room", null));
      assertThatThrownBy(() -> isolated.importFile(crossSubject))
          .hasMessageContaining("subject/region collision");
      assertThat(db.jdbc().sql("SELECT count(*) FROM evidence").query(Long.class).single()).isZero();
      Path collision = factSource("evidence-id-collision.sqlite3", "Пусан",
          fact("same-evidence", "import-hotel", "import-room", null),
          fact("same-evidence", "other-hotel", "other-room", null));
      assertThatThrownBy(() -> isolated.importFile(collision))
          .hasMessageContaining("subject/region collision");
      assertThat(db.jdbc().sql("SELECT count(*) FROM evidence").query(Long.class).single()).isZero();
    }
  }

  @Test
  void globalHistoryIdsCannotSilentlyDiscardAnotherRegion() throws Exception {
    for (String table : List.of("advisor_runs", "questions", "drafts")) {
      String target = switch (table) {
        case "advisor_runs" -> "advisor_run"; case "questions" -> "catalog_question";
        default -> "catalog_draft";
      };
      Path source = temp.resolve("region-collision-" + table + ".sqlite3");
      try (var connection = DriverManager.getConnection("jdbc:sqlite:" + source);
          var statement = connection.createStatement()) {
        statement.execute("CREATE TABLE advisor_runs(region TEXT,id TEXT,created_at TEXT,body TEXT)");
        statement.execute("CREATE TABLE questions(region TEXT,id TEXT,hotel_id TEXT,room_id TEXT,feature TEXT,body TEXT)");
        statement.execute("CREATE TABLE drafts(region TEXT,id TEXT,question_id TEXT,body TEXT)");
        if (table.equals("advisor_runs")) {
          statement.executeUpdate("INSERT INTO advisor_runs VALUES('Пусан','collision-run','2026','{}'),"
              + "('Другой регион','collision-run','2026','{}')");
        } else if (table.equals("questions")) {
          statement.executeUpdate("INSERT INTO questions VALUES('Пусан','collision-question','h','r','courtyard','{}'),"
              + "('Другой регион','collision-question','h','r','courtyard','{}')");
        } else {
          statement.executeUpdate("INSERT INTO questions VALUES('Пусан','collision-q1','h','r','courtyard','{}'),"
              + "('Другой регион','collision-q2','h','r','courtyard','{}')");
          statement.executeUpdate("INSERT INTO drafts VALUES('Пусан','collision-draft','collision-q1','{}'),"
              + "('Другой регион','collision-draft','collision-q2','{}')");
        }
      }
      assertThatThrownBy(() -> importer.importFile(source)).hasMessageContaining("Region/id collision");
      assertThat(count("SELECT count(*) FROM " + target + " WHERE id LIKE 'collision-%'")).isZero();
      assertThat(count("SELECT count(*) FROM catalog_question WHERE id LIKE 'collision-%'")).isZero();
    }
  }

  private static ObjectNode hostSeed() {
    return Json.obj("region", "Пусан", "evidencePolicy", "verified-only", "hotels", List.of(
        Json.obj("id", "import-hotel", "name", "Synthetic import hotel", "rooms", List.of(
            Json.obj("id", "import-room", "capacity", 3))),
        Json.obj("id", "other-hotel", "name", "Synthetic other hotel", "rooms", List.of(
            Json.obj("id", "other-room", "capacity", 3)))), "facts", List.of());
  }

  private static ObjectNode fact(String id, String hotel, String room, String replacement) {
    ObjectNode fact = Json.obj("id", id, "hotelId", hotel, "roomId", room,
        "feature", "courtyard", "value", true, "demo", true, "simulated", true,
        "source", "Synthetic importer fixture", "quote", "Synthetic answer",
        "sourceUrl", "https://example.test/import-source", "sourceDate", "2026-10-01T00:00:00Z",
        "obtainedAt", "2026-10-26T00:00:00Z", "expiresAt", "2027-01-01T00:00:00Z");
    if (replacement != null) fact.put("supersededBy", replacement);
    return fact;
  }

  private Path factSource(String filename, String region, ObjectNode... facts) throws Exception {
    Path source = temp.resolve(filename);
    try (var connection = DriverManager.getConnection("jdbc:sqlite:" + source);
        var statement = connection.createStatement()) {
      statement.execute("CREATE TABLE facts(region TEXT,id TEXT,hotel_id TEXT,room_id TEXT,feature TEXT,"
          + "seeded INTEGER,active INTEGER,body TEXT)");
      try (var insert = connection.prepareStatement("INSERT INTO facts VALUES(?,?,?,?,?,0,1,?)")) {
        for (ObjectNode fact : facts) {
          insert.setString(1, region); insert.setString(2, Json.str(fact, "id"));
          insert.setString(3, Json.str(fact, "hotelId")); insert.setString(4, Json.str(fact, "roomId"));
          insert.setString(5, Json.str(fact, "feature")); insert.setString(6, Json.write(fact));
          insert.executeUpdate();
        }
      }
    }
    return source;
  }

  private long count(String sql) {
    return jdbc.sql(sql).query(Long.class).single();
  }
}
