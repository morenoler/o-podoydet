package ru.opodoydet.advisor;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.application.Agents;
import ru.opodoydet.application.Environment;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;
import ru.opodoydet.web.Api;

class AdvisorPrivacyTest {
  @TempDir Path temp;
  private static final String PRIVATE = "PRIVATE_TRIP_CANARY_25719";
  private static final String PASSWORD = "local test password 25719";

  private static ObjectNode seed() {
    return Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of());
  }

  private static ObjectNode trip() {
    LocalDate day = LocalDate.now().plusDays(30);
    return Json.obj("region", "Пусан", "checkIn", day.toString(),
        "checkOut", day.plusDays(3).toString(), "adults", 2, "children", 0,
        "scenarios", List.of(), "preferences", List.of(), "text", PRIVATE);
  }

  private static ObjectNode requestBody(JsonNode trip, String searchId) {
    return Json.obj("trip", trip, "searchId", searchId, "mode", "rules");
  }

  private static HttpClient browser() {
    return HttpClient.newBuilder()
        .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();
  }

  private record Response(int status, JsonNode body, HttpHeaders headers) {}

  private static Response request(Api api, HttpClient browser, String path, JsonNode body)
      throws Exception {
    var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + api.port() + "/api" + path));
    if (body == null) request.GET();
    else request.header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(Json.write(body)));
    var result = browser.send(request.build(), HttpResponse.BodyHandlers.ofString());
    return new Response(result.statusCode(), Json.read(result.body()), result.headers());
  }

  private Api server(Store store, boolean accounts, boolean secureCookie) throws Exception {
    // Privacy integration tests do not need Python or a model; a missing executable fails closed.
    return new Api(store, new Agents(Agents.Config.from(Map.of())), temp,
        temp.resolve("areas.json"), temp.resolve("noise.json"), temp.resolve("traffic.json"), "", 0,
        Map.of("ACCOUNT_MODE", Boolean.toString(accounts),
            "SESSION_COOKIE_SECURE", Boolean.toString(secureCookie),
            "ADVISOR_PYTHON", temp.resolve("no-python-in-privacy-test").toString(),
            "UPLOADS_PATH", temp.resolve("uploads").toString(), "LAB_MODE", "true"));
  }

  private static String search(Api api, HttpClient browser, JsonNode trip) throws Exception {
    Response found = request(api, browser, "/search", trip);
    assertEquals(200, found.status, found.body.toString());
    return Json.str(found.body, "searchId");
  }

  private static String start(Api api, HttpClient browser, JsonNode trip, String searchId)
      throws Exception {
    Response started = request(api, browser, "/advisor/runs", requestBody(trip, searchId));
    assertEquals(202, started.status, started.body.toString());
    return Json.str(started.body, "id");
  }

  private static void hidden(Api api, HttpClient browser, String runId) throws Exception {
    for (Response response : List.of(
        request(api, browser, "/advisor/runs/" + runId, null),
        request(api, browser, "/advisor/runs/" + runId + "/cancel", Json.obj()))) {
      assertEquals(404, response.status, response.body.toString());
      assertFalse(response.body.toString().contains(PRIVATE));
      assertFalse(response.body.toString().contains(runId));
    }
  }

  @Test
  void anonymousBrowsersCannotReadListCancelOrReuseAnotherSearchAndOwnershipSurvivesRestart()
      throws Exception {
    Path db = temp.resolve("privacy.sqlite3");
    ObjectNode query = trip();
    HttpClient owner = browser(), stranger = browser();
    String id;
    try (Store store = new Store(db.toString(), seed()); Api api = server(store, false, false)) {
      api.start();
      Response found = request(api, owner, "/search", query);
      assertEquals(200, found.status);
      String cookie = found.headers.firstValue("Set-Cookie").orElseThrow();
      assertTrue(cookie.contains("HttpOnly; SameSite=Lax"));
      assertFalse(cookie.contains("Domain="));
      String searchId = Json.str(found.body, "searchId");
      Response stolen = request(api, stranger, "/advisor/runs", requestBody(query, searchId));
      assertEquals(400, stolen.status);
      assertFalse(stolen.body.toString().contains(PRIVATE));
      id = start(api, owner, query, searchId);
      assertEquals(PRIVATE,
          request(api, owner, "/advisor/runs/" + id, null).body.path("context").path("trip").path("text").asText());
      hidden(api, stranger, id);
      assertTrue(request(api, stranger, "/advisor/runs", null).body.isEmpty());
      Response history = request(api, owner, "/advisor/runs", null);
      assertEquals(1, history.body.size());
      assertEquals(id, Json.str(history.body.get(0), "id"));
      assertFalse(history.body.toString().contains("owner_key"));
      assertFalse(history.body.toString().contains(cookie.split(";", 2)[0].split("=", 2)[1]));
    }
    try (Store store = new Store(db.toString(), seed()); Api api = server(store, false, false)) {
      api.start();
      assertEquals(200, request(api, owner, "/advisor/runs/" + id, null).status);
      assertEquals(1, request(api, owner, "/advisor/runs", null).body.size());
      hidden(api, stranger, id);
      assertTrue(request(api, stranger, "/advisor/runs", null).body.isEmpty());
    }
    try (var connection = DriverManager.getConnection("jdbc:sqlite:" + db);
        var statement = connection.createStatement();
        var rows = statement.executeQuery("SELECT owner_key FROM advisor_run_owners")) {
      assertTrue(rows.next());
      assertTrue(rows.getString(1).matches("visitor:[a-f0-9]{64}"));
      assertFalse(rows.next());
    }
  }

  @Test
  void authenticatedHistoryIsAccountScopedAcrossLoginLogoutAndBrowsers() throws Exception {
    Path db = temp.resolve("accounts.sqlite3");
    ObjectNode query = trip();
    HttpClient sharedBrowser = browser(), secondBrowser = browser();
    try (Store store = new Store(db.toString(), seed()); Api api = server(store, true, false)) {
      api.start();
      register(api, sharedBrowser, "first@example.test");
      String firstSearch = search(api, sharedBrowser, query);
      String id = start(api, sharedBrowser, query, firstSearch);
      assertEquals(200, request(api, sharedBrowser, "/auth/logout", Json.obj()).status);
      hidden(api, sharedBrowser, id);
      assertTrue(request(api, sharedBrowser, "/advisor/runs", null).body.isEmpty());
      register(api, sharedBrowser, "second@example.test");
      hidden(api, sharedBrowser, id);
      assertTrue(request(api, sharedBrowser, "/advisor/runs", null).body.isEmpty());
      assertEquals(400, request(api, sharedBrowser, "/advisor/runs", requestBody(query, firstSearch)).status);
      Response login = request(api, secondBrowser, "/auth/login",
          Json.obj("email", "first@example.test", "password", PASSWORD));
      assertEquals(200, login.status, login.body.toString());
      assertEquals(200, request(api, secondBrowser, "/advisor/runs/" + id, null).status);
      assertEquals(id, Json.str(request(api, secondBrowser, "/advisor/runs", null).body.get(0), "id"));
    }
  }

  private static void register(Api api, HttpClient browser, String email) throws Exception {
    Response registered = request(api, browser, "/auth/register",
        Json.obj("name", "Тестовый гость", "email", email, "password", PASSWORD, "role", "user"));
    assertEquals(201, registered.status, registered.body.toString());
  }

  @Test
  void legacyUnownedRunsStayPrivateAfterAdditiveMigrationAndSecureCookieIsExplicit() throws Exception {
    Path db = temp.resolve("legacy.sqlite3");
    ObjectNode legacy = Json.obj("id", "legacy-private", "createdAt", Instant.now().toString(),
        "status", "completed", "context", Json.obj("trip", trip()));
    try (var connection = DriverManager.getConnection("jdbc:sqlite:" + db);
        var create = connection.createStatement()) {
      create.execute("CREATE TABLE advisor_runs(region TEXT NOT NULL,id TEXT NOT NULL,"
          + "created_at TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(region,id))");
      try (var insert = connection.prepareStatement("INSERT INTO advisor_runs VALUES(?,?,?,?)")) {
        insert.setString(1, "Пусан");
        insert.setString(2, "legacy-private");
        insert.setString(3, Json.str(legacy, "createdAt"));
        insert.setString(4, Json.write(legacy));
        insert.executeUpdate();
      }
    }
    try (Store store = new Store(db.toString(), seed()); Api api = server(store, false, true)) {
      api.start();
      assertEquals(legacy, store.advisorRun("legacy-private"));
      HttpClient browser = browser();
      Response history = request(api, browser, "/advisor/runs", null);
      assertEquals(200, history.status);
      assertTrue(history.body.isEmpty());
      assertTrue(history.headers.firstValue("Set-Cookie").orElseThrow().contains("; Secure"));
      hidden(api, browser, "legacy-private");
      assertNull(store.advisorRun("legacy-private", "visitor:guessed"));
      assertTrue(store.advisorRuns("account:guessed").isEmpty());
      assertThrows(IllegalArgumentException.class, () -> store.advisorRuns(""));
    }
  }

  @Test
  void activeRunCannotLeakThroughDeduplicationBusyResponseOrForeignCancellation() throws Exception {
    CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    try (Store store = new Store(":memory:", seed())) {
      SearchService search = new SearchService(store, new Agents(Agents.Config.from(Map.of())),
          new Environment(temp.resolve("areas.json"), temp.resolve("noise.json")));
      try (AdvisorService service = new AdvisorService(store, search, Map.of(), (context, mode, progress) -> {
        entered.countDown();
        release.await();
        throw new IllegalStateException("Controlled test worker");
      })) {
        ObjectNode query = trip();
        String a = "visitor:owner", b = "visitor:stranger";
        String searchA = Json.str(search.search(query, a), "searchId");
        String searchB = Json.str(search.search(query, b), "searchId");
        ObjectNode requestA = requestBody(query, searchA);
        String run = Json.str(service.start(requestA, a), "id");
        assertTrue(entered.await(2, TimeUnit.SECONDS));
        assertEquals(run, Json.str(service.start(requestA, a), "id"));
        assertThrows(IllegalArgumentException.class, () -> service.start(requestA, b));
        assertThrows(IllegalArgumentException.class, () -> service.start(requestA));
        assertThrows(IllegalArgumentException.class, () -> search.advisorContext(query, searchA));
        var busy = assertThrows(IllegalStateException.class,
            () -> service.start(requestBody(query, searchB), b));
        assertFalse(busy.getMessage().contains(PRIVATE));
        assertFalse(busy.getMessage().contains(run));
        assertNull(service.cancel(run, b));
        assertNull(service.get(run, b));
        assertTrue(service.list(b).isEmpty());
        assertEquals("running", Json.str(service.get(run, a), "status"));
        assertEquals("cancelled", Json.str(service.cancel(run, a), "status"));
      } finally {
        release.countDown();
      }
    }
  }
}
