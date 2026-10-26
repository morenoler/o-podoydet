package ru.opodoydet.accounts;

import static org.junit.jupiter.api.Assertions.*;

import java.net.*;
import java.net.http.*;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.accounts.auth.Passwords;
import ru.opodoydet.application.Agents;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;
import ru.opodoydet.web.Api;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

class AccountApiTest {
  @TempDir Path temp;
  private static final String PASSWORD = " test password 123 ";

  private static ObjectNode seed() {
    return Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of());
  }

  private Api server(Store store, boolean enabled) throws Exception {
    return new Api(
        store,
        new Agents(Agents.Config.from(Map.of())),
        temp,
        temp.resolve("areas.json"),
        temp.resolve("noise.json"),
        temp.resolve("traffic.json"),
        "",
        0,
        enabled
            ? Map.of("ACCOUNT_MODE", "true", "LAB_MODE", "true")
            : Map.of("ACCOUNT_MODE", "false"));
  }

  private static HttpClient browser() {
    return HttpClient.newBuilder()
        .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL))
        .build();
  }

  private record Response(int status, JsonNode body, HttpHeaders headers) {}

  private static Response request(Api api, HttpClient client, String path, JsonNode input)
      throws Exception {
    return request(api, client, path, input, null);
  }

  private static Response request(
      Api api, HttpClient client, String path, JsonNode input, String origin) throws Exception {
    var req = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + api.port() + "/api" + path));
    if (origin != null) req.header("Origin", origin);
    if (input == null) req.GET();
    else
      req.header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(Json.write(input)));
    var result = client.send(req.build(), HttpResponse.BodyHandlers.ofString());
    return new Response(result.statusCode(), Json.read(result.body()), result.headers());
  }

  private static JsonNode register(Api api, HttpClient client, String email, String role)
      throws Exception {
    Response result =
        request(
            api,
            client,
            "/auth/register",
            Json.obj("name", "Тестовый гость", "email", email, "password", PASSWORD, "role", role));
    assertEquals(201, result.status, result.body.toString());
    assertTrue(
        result.headers.firstValue("Set-Cookie").orElseThrow().contains("HttpOnly; SameSite=Lax"));
    assertFalse(result.body.toString().contains("password"));
    return result.body.path("user");
  }

  private static ObjectNode listing(String status) {
    return Json.obj(
        "title",
        "Светлый номер у моря",
        "description",
        "Просторный номер с отдельной ванной и видом на город.",
        "city",
        "Пусан",
        "address",
        "Хэундэ, дом 10",
        "roomType",
        "Двухместный номер",
        "capacity",
        3,
        "pricePerNight",
        90000,
        "amenities",
        List.of("Wi-Fi", "Кухня"),
        "status",
        status);
  }

  private static ObjectNode dates() {
    LocalDate from = LocalDate.now(ZoneId.of("Asia/Seoul")).plusDays(10);
    return Json.obj(
        "checkIn",
        from.toString(),
        "checkOut",
        from.plusDays(3).toString(),
        "guests",
        2,
        "note",
        "Поздний заезд");
  }

  @Test
  void explicitOptOutDoesNotActivateAccountsOrCreateTheirTables() throws Exception {
    Path database = temp.resolve("main.sqlite3");
    try (Store store = new Store(database.toString(), seed());
        Api api = server(store, false)) {
      api.start();
      assertEquals(404, request(api, browser(), "/auth/me", null).status);
      assertEquals(200, request(api, browser(), "/questions", null).status);
      try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database);
          var statement = connection.createStatement();
          var rows =
              statement.executeQuery(
                  "SELECT count(*) FROM sqlite_master WHERE name LIKE 'account_%'")) {
        assertTrue(rows.next());
        assertEquals(0, rows.getInt(1));
      }
    }
  }

  @Test
  void accountsEnforceRolesOwnershipAndPersistRealHistory() throws Exception {
    Path database = temp.resolve("lab.sqlite3");
    HttpClient host = browser(),
        otherHost = browser(),
        guest = browser(),
        otherGuest = browser(),
        anonymous = browser();
    String listingId, bookingId, questionId;
    try (Store store = new Store(database.toString(), seed());
        Api api = server(store, true)) {
      api.start();
      assertTrue(request(api, anonymous, "/auth/me", null).body.path("user").isNull());
      assertEquals(401, request(api, anonymous, "/account/bookings", null).status);
      JsonNode owner = register(api, host, "host@example.test", "host");
      register(api, otherHost, "otherhost@example.test", "host");
      register(api, guest, "guest@example.test", "user");
      register(api, otherGuest, "otherguest@example.test", "user");
      assertEquals(403, request(api, guest, "/host/listings", null).status);
      assertEquals(403, request(api, host, "/account/bookings", null).status);
      assertEquals(403, request(api, anonymous, "/questions", Json.obj()).status);
      assertEquals(403, request(api, anonymous, "/drafts/anything/confirm", Json.obj()).status);
      assertEquals(0, request(api, guest, "/account/bookings", null).body.size());
      var created =
          request(api, host, "/host/listings", listing("draft").put("hostId", "somebody-else"));
      assertEquals(201, created.status, created.body.toString());
      listingId = Json.str(created.body, "id");
      assertEquals(Json.str(owner, "id"), Json.str(created.body, "hostId"));
      assertEquals(0, request(api, anonymous, "/listings", null).body.size());
      assertEquals(404, request(api, anonymous, "/listings/" + listingId, null).status);
      assertEquals(
          404, request(api, otherHost, "/host/listings/" + listingId, listing("published")).status);
      assertEquals(
          200, request(api, host, "/host/listings/" + listingId, listing("published")).status);
      assertEquals(1, request(api, anonymous, "/listings", null).body.size());
      assertEquals(
          401,
          request(
                  api,
                  anonymous,
                  "/listings/" + listingId + "/questions",
                  Json.obj("text", "Можно с ребёнком?"))
              .status);
      var question =
          request(
              api,
              guest,
              "/listings/" + listingId + "/questions",
              Json.obj("text", "Можно с ребёнком?"));
      assertEquals(201, question.status);
      questionId = Json.str(question.body, "id");
      assertEquals(0, request(api, otherGuest, "/account/questions", null).body.size());
      assertEquals(
          0, request(api, anonymous, "/listings/" + listingId + "/questions", null).body.size());
      assertEquals(
          404,
          request(
                  api,
                  otherHost,
                  "/host/questions/" + questionId + "/answer",
                  Json.obj("answer", "Можно"))
              .status);
      assertEquals(
          200,
          request(
                  api,
                  host,
                  "/host/questions/" + questionId + "/answer",
                  Json.obj("answer", "Да, с ребёнком можно."))
              .status);
      JsonNode publicQuestion =
          request(api, anonymous, "/listings/" + listingId + "/questions", null).body.get(0);
      assertEquals("", Json.str(publicQuestion, "userId"));
      assertEquals("Тестовый", Json.str(publicQuestion, "guestName"));
      var booking =
          request(
              api,
              guest,
              "/listings/" + listingId + "/bookings",
              dates().put("status", "confirmed").put("totalPrice", 1));
      assertEquals(201, booking.status, booking.body.toString());
      bookingId = Json.str(booking.body, "id");
      assertEquals("pending", Json.str(booking.body, "status"));
      assertEquals(270000, booking.body.path("totalPrice").asLong());
      assertEquals(
          409, request(api, guest, "/listings/" + listingId + "/bookings", dates()).status);
      assertEquals(0, request(api, otherGuest, "/account/bookings", null).body.size());
      assertEquals(
          404,
          request(api, otherGuest, "/account/bookings/" + bookingId + "/cancel", Json.obj())
              .status);
      assertEquals(
          404,
          request(
                  api,
                  otherHost,
                  "/host/bookings/" + bookingId + "/status",
                  Json.obj("status", "confirmed"))
              .status);
      String competingId =
          Json.str(
              request(api, otherGuest, "/listings/" + listingId + "/bookings", dates()).body, "id");
      assertEquals(
          200,
          request(
                  api,
                  host,
                  "/host/bookings/" + bookingId + "/status",
                  Json.obj("status", "confirmed"))
              .status);
      assertEquals(
          409,
          request(
                  api,
                  host,
                  "/host/bookings/" + competingId + "/status",
                  Json.obj("status", "confirmed"))
              .status);
      assertEquals(
          409,
          request(
                  api,
                  host,
                  "/host/bookings/" + bookingId + "/status",
                  Json.obj("status", "completed"))
              .status);
      assertEquals(
          200,
          request(
                  api,
                  host,
                  "/host/listings/" + listingId,
                  listing("published").put("title", "Другое название").put("pricePerNight", 120000))
              .status);
      JsonNode historical = request(api, guest, "/account/bookings", null).body.get(0);
      assertEquals("Светлый номер у моря", Json.str(historical, "listingTitle"));
      assertEquals(270000, historical.path("totalPrice").asLong());
      assertEquals(
          200,
          request(
                  api,
                  guest,
                  "/account/profile",
                  Json.obj(
                      "name",
                      "Алексей",
                      "phone",
                      "+7 999 123 45 67",
                      "about",
                      "Люблю море",
                      "role",
                      "host",
                      "email",
                      "changed@example.test"))
              .status);
      JsonNode profile = request(api, guest, "/auth/me", null).body.path("user");
      assertEquals("user", Json.str(profile, "role"));
      assertEquals("guest@example.test", Json.str(profile, "email"));
      assertEquals(
          403,
          request(
                  api,
                  guest,
                  "/account/profile",
                  Json.obj("name", "Атакующий"),
                  "https://evil.test")
              .status);
      assertEquals(0, store.hotels().size()); // independent from the verified catalogue
    }
    try (Store store = new Store(database.toString(), seed());
        Api api = server(store, true)) {
      api.start();
      assertEquals(
          "Алексей", Json.str(request(api, guest, "/auth/me", null).body.path("user"), "name"));
      assertEquals(1, request(api, guest, "/account/bookings", null).body.size());
      assertEquals(
          "answered",
          Json.str(request(api, guest, "/account/questions", null).body.get(0), "status"));
      assertEquals(
          200,
          request(api, guest, "/account/bookings/" + bookingId + "/cancel", Json.obj()).status);
      assertEquals(
          "cancelled",
          Json.str(request(api, guest, "/account/bookings", null).body.get(0), "status"));
      assertEquals(
          409,
          request(
                  api,
                  host,
                  "/host/bookings/" + bookingId + "/status",
                  Json.obj("status", "confirmed"))
              .status);
      assertEquals(200, request(api, guest, "/auth/logout", Json.obj()).status);
      assertTrue(request(api, guest, "/auth/me", null).body.path("user").isNull());
      assertEquals(
          401,
          request(
                  api,
                  guest,
                  "/auth/login",
                  Json.obj("email", "guest@example.test", "password", "wrong password"))
              .status);
      assertEquals(
          200,
          request(
                  api,
                  guest,
                  "/auth/login",
                  Json.obj("email", "GUEST@example.test", "password", PASSWORD))
              .status);
    }
  }

  @Test
  void invalidInputIsRejectedAndSecretsAreHashed() throws Exception {
    Path database = temp.resolve("validation.sqlite3");
    try (Store store = new Store(database.toString(), seed());
        Api api = server(store, true)) {
      api.start();
      HttpClient host = browser(), guest = browser();
      register(api, host, "host@example.test", "host");
      register(api, guest, "guest@example.test", "user");
      assertEquals(
          409,
          request(
                  api,
                  browser(),
                  "/auth/register",
                  Json.obj(
                      "name",
                      "Кто-то",
                      "email",
                      "HOST@example.test",
                      "password",
                      PASSWORD,
                      "role",
                      "host"))
              .status);
      assertEquals(
          400,
          request(
                  api,
                  browser(),
                  "/auth/register",
                  Json.obj(
                      "name",
                      "Кто-то",
                      "email",
                      "test@example.test",
                      "password",
                      "short",
                      "role",
                      "user"))
              .status);
      assertEquals(
          400,
          request(api, host, "/host/listings", listing("published").put("capacity", 2.5)).status);
      assertEquals(
          400,
          request(api, host, "/host/listings", listing("published").put("description", " "))
              .status);
      String id = Json.str(request(api, host, "/host/listings", listing("published")).body, "id");
      assertEquals(
          400,
          request(api, guest, "/listings/" + id + "/bookings", dates().put("guests", 4)).status);
      assertEquals(
          400,
          request(api, guest, "/listings/" + id + "/bookings", dates().put("checkIn", "2026-02-31"))
              .status);
      assertEquals(
          400, request(api, guest, "/listings/" + id + "/questions", Json.obj("text", " ")).status);
      assertEquals(
          400,
          request(api, guest, "/account/profile", Json.obj("name", "Гость", "phone", "not a phone"))
              .status);
      assertEquals(
          401,
          request(
                  api,
                  browser(),
                  "/auth/login",
                  Json.obj("email", "x'OR'1'='1@example.test", "password", PASSWORD))
              .status);
      try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database);
          var statement = connection.createStatement()) {
        try (var rs = statement.executeQuery("SELECT password_hash FROM account_users")) {
          assertTrue(rs.next());
          String hash = rs.getString(1);
          assertFalse(hash.contains(PASSWORD));
          assertTrue(Passwords.verify(PASSWORD, hash));
        }
        try (var rs = statement.executeQuery("SELECT token_hash FROM account_sessions")) {
          assertTrue(rs.next());
          assertEquals(43, rs.getString(1).length());
        }
      }
    }
    String first = Passwords.hash(PASSWORD), second = Passwords.hash(PASSWORD);
    assertNotEquals(first, second);
    assertFalse(Passwords.verify("incorrect", first));
  }

  @Test
  void privateOwnerProfileIsAtomicAndInvisibleToGuestsAndOtherHosts() throws Exception {
    String canary = "PRIVATE_OWNER_NOTE_CANARY_91823";
    Path database = temp.resolve("private-profile.sqlite3");
    HttpClient host = browser(), outsider = browser(), guest = browser(), anonymous = browser();
    String id;
    try (Store store = new Store(database.toString(), seed());
        Api api = server(store, true)) {
      api.start();
      register(api, host, "profilehost@example.test", "host");
      register(api, outsider, "outsider@example.test", "host");
      register(api, guest, "profileguest@example.test", "user");
      ObjectNode profile =
          Json.obj(
              "notes",
              "Все окна выходят во двор. " + canary,
              "floor",
              3,
              "windowDirections",
              List.of("south", "east"));
      ObjectNode form = listing("published");
      form.set("searchProfile", profile);
      Response created = request(api, host, "/host/listings", form);
      assertEquals(201, created.status);
      id = Json.str(created.body, "id");
      ObjectNode privateNotes = Json.obj("notes", profile.path("notes"));
      assertEquals(privateNotes, created.body.path("searchProfile"));
      assertEquals(3, created.body.path("floor").asInt());
      assertEquals(profile.path("windowDirections"), created.body.path("windowDirections"));
      assertEquals(
          privateNotes,
          request(api, host, "/host/listings/" + id, null).body.path("searchProfile"));
      assertEquals(404, request(api, outsider, "/host/listings/" + id, null).status);
      assertEquals(403, request(api, guest, "/host/listings/" + id, null).status);
      assertEquals(401, request(api, anonymous, "/host/listings/" + id, null).status);
      assertEquals(404, request(api, outsider, "/host/listings/" + id, form).status);
      ObjectNode invalid = listing("published").put("title", "Не должно сохраниться");
      invalid.set("searchProfile", profile.deepCopy().put("floor", 201));
      assertEquals(400, request(api, host, "/host/listings/" + id, invalid).status);
      assertEquals(
          "Светлый номер у моря",
          Json.str(request(api, host, "/host/listings/" + id, null).body, "title"));
      assertEquals(
          privateNotes,
          request(api, host, "/host/listings/" + id, listing("published"))
              .body
              .path("searchProfile"));
      assertEquals(
          400,
          request(
                  api,
                  host,
                  "/host/listings",
                  form.deepCopy().set("searchProfile", profile.deepCopy().put("areaSafety", true)))
              .status);
      assertEquals(
          400,
          request(
                  api,
                  host,
                  "/host/listings",
                  form.deepCopy()
                      .set(
                          "searchProfile",
                          profile
                              .deepCopy()
                              .set("windowDirections", Json.array(List.of("south", "south")))))
              .status);
      assertEquals(
          400,
          request(
                  api,
                  host,
                  "/host/listings",
                  form.deepCopy()
                      .set("searchProfile", profile.deepCopy().put("notes", "x".repeat(6001))))
              .status);
      assertEquals(
          400,
          request(
                  api,
                  host,
                  "/host/listings",
                  form.deepCopy().set("searchProfile", profile.deepCopy().put("floor", 2.5)))
              .status);
      assertEquals(
          400,
          request(
                  api,
                  host,
                  "/host/listings",
                  form.deepCopy()
                      .set(
                          "searchProfile",
                          profile.deepCopy().set("windowDirections", Json.array(List.of("up")))))
              .status);
      ObjectNode trip =
          Json.obj(
              "region",
              "Пусан",
              "checkIn",
              "2027-06-10",
              "checkOut",
              "2027-06-15",
              "adults",
              2,
              "children",
              0,
              "scenarios",
              List.of(),
              "preferences",
              List.of(Json.obj("feature", "courtyard", "required", true)),
              "text",
              "Не выше 3 этажа. Окна на юг");
      Response search = request(api, anonymous, "/search", trip);
      assertEquals(200, search.status, search.body.toString());
      assertEquals(1, search.body.path("results").size());
      assertEquals(
          id, Json.str(search.body.path("results").get(0).path("hotel"), "accountListingId"));
      for (JsonNode value :
          List.of(
              request(api, anonymous, "/listings", null).body,
              request(api, guest, "/listings/" + id, null).body,
              request(api, anonymous, "/catalog", null).body,
              search.body)) {
        assertFalse(value.toString().contains(canary));
        assertFalse(value.toString().contains("searchProfile"));
      }
      assertEquals(0, request(api, anonymous, "/lab/search", trip).body.path("results").size());
    }
    try (Store store = new Store(database.toString(), seed());
        Api api = server(store, true)) {
      api.start();
      assertTrue(
          request(api, host, "/host/listings/" + id, null)
              .body
              .path("searchProfile")
              .path("notes")
              .asText()
              .contains(canary));
    }
  }
}
