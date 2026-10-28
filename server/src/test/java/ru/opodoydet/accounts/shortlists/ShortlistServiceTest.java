package ru.opodoydet.accounts.shortlists;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

class ShortlistServiceTest {
  private static final Instant NOW = Instant.parse("2026-10-28T12:00:00Z");
  private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
  private static ObjectNode seed() { return Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of()); }
  private static void user(AccountDatabase db, String id) throws Exception {
    db.execute("INSERT INTO account_users(id,email,password_hash,role,name,created_at) VALUES(?,?,?,?,?,?)", id, id + "@example.test", "unused", "user", id, NOW.toString());
  }
  private static ObjectNode input(long revision) {
    return Json.obj("revision", revision, "title", "Поездка к морю", "items", List.of(Json.obj(
        "id", "hotel::room", "name", "Тестовый номер", "path", "/hotels/hotel?room=room", "hotelId", "hotel",
        "photos", List.of("/images/hotels/example.jpg"), "note", "PRIVATE_NOTE_417", "stage", "availability", "savedAt", NOW.toString())),
        "trip", Json.obj("region", "Пусан", "checkIn", "2026-12-01", "checkOut", "2026-12-03", "adults", 2, "children", 0,
            "scenarios", List.of(), "preferences", List.of(Json.obj("feature", "courtyard", "required", true)), "text", "PRIVATE_WISH_417",
            "locationWishes", List.of(Json.obj("query", "PRIVATE_PLACE_417", "relation", "near", "radiusMeters", 500, "required", false))));
  }
  @Test void ownersAndRevisionsProtectConcurrentEdits() throws Exception {
    try (var fixture = TestDatabases.create(seed())) {
      var db = fixture.accounts(); user(db, "owner-a"); user(db, "owner-b");
      var service = new ShortlistService(db, CLOCK);
      assertEquals(0, service.get("owner-a").path("revision").asLong());
      var first = service.save("owner-a", input(0));
      assertEquals(1, first.path("revision").asLong());
      assertTrue(service.get("owner-b").path("items").isEmpty());
      var stale = assertThrows(AccountProblem.class, () -> service.save("owner-a", input(0)));
      assertEquals(409, stale.status);
      assertEquals(1, service.get("owner-a").path("revision").asLong());
      try (var executor = Executors.newFixedThreadPool(2)) {
        Callable<Integer> edit = () -> { try { service.save("owner-a", input(1)); return 200; } catch (AccountProblem conflict) { return conflict.status; } };
        var outcomes = executor.invokeAll(List.of(edit, edit));
        var statuses = List.of(outcomes.get(0).get(), outcomes.get(1).get());
        assertEquals(1, statuses.stream().filter(status -> status == 200).count());
        assertEquals(1, statuses.stream().filter(status -> status == 409).count());
      }
      assertEquals(2, service.get("owner-a").path("revision").asLong());
      var missingRevision = input(0); missingRevision.remove("revision");
      assertEquals(400, assertThrows(AccountProblem.class, () -> service.save("owner-b", missingRevision)).status);
      assertTrue(service.get("owner-b").path("items").isEmpty());
    }
  }
  @Test void sharingIsExplicitPrivateRevocableImmutableAndExpires() throws Exception {
    try (var fixture = TestDatabases.create(seed())) {
      var db = fixture.accounts(); user(db, "owner-secret-id"); user(db, "other");
      var service = new ShortlistService(db, CLOCK);
      service.save("owner-secret-id", input(0));
      assertFalse(service.get("owner-secret-id").path("shareActive").asBoolean());
      String token = service.share("owner-secret-id", Json.obj("revision", 1)).path("token").asText();
      JsonNode shared = service.shared(token);
      String publicJson = shared.toString();
      for (String secret : List.of("PRIVATE_NOTE_417", "PRIVATE_WISH_417", "PRIVATE_PLACE_417", "owner-secret-id", "note", "stage", "revision", "locationWishes")) assertFalse(publicJson.contains(secret), secret);
      assertEquals("courtyard", shared.path("trip").path("preferences").get(0).path("feature").asText());
      assertFalse(db.one("SELECT token_hash FROM account_shortlist_shares WHERE owner_id=?", "owner-secret-id").toString().contains(token));
      service.revoke("other");
      assertEquals(shared, service.shared(token));
      service.save("owner-secret-id", input(1).put("title", "Новая поездка"));
      assertEquals("Поездка к морю", service.shared(token).path("title").asText());
      assertEquals(409, assertThrows(AccountProblem.class, () -> service.share("owner-secret-id", Json.obj("revision", 1))).status);
      String replacement = service.share("owner-secret-id", Json.obj("revision", 2)).path("token").asText();
      assertNotEquals(token, replacement);
      assertEquals(404, assertThrows(AccountProblem.class, () -> service.shared(token)).status);
      var later = new ShortlistService(db, Clock.fixed(NOW.plusSeconds(30L * 86400), ZoneOffset.UTC));
      assertEquals(404, assertThrows(AccountProblem.class, () -> later.shared(replacement)).status);
      assertFalse(later.get("owner-secret-id").path("shareActive").asBoolean());
      service.revoke("owner-secret-id");
      assertEquals(404, assertThrows(AccountProblem.class, () -> service.shared(replacement)).status);
    }
  }
  @Test void rejectsUnsafeLinksDuplicatesAndUnknownStates() {
    for (String path : List.of("https://evil.test", "//evil.test", "javascript:alert(1)", "/hotels/a#private", "/hotels/a?next=secret", "/hotels/a\\b")) {
      var value = input(0); ((ObjectNode) value.path("items").get(0)).put("path", path);
      assertThrows(AccountProblem.class, () -> ShortlistService.validate(value), path);
    }
    for (String photo : List.of("javascript:alert(1)", "http://evil.test/a.jpg", "/images/../private.jpg", "https://user:password@evil.test/a.jpg")) {
      var value = input(0); ((ObjectNode) value.path("items").get(0)).set("photos", Json.array(List.of(photo)));
      assertThrows(AccountProblem.class, () -> ShortlistService.validate(value), photo);
    }
    var duplicate = input(0); duplicate.withArray("items").add(duplicate.path("items").get(0).deepCopy());
    assertThrows(AccountProblem.class, () -> ShortlistService.validate(duplicate));
    var invalidStage = input(0); ((ObjectNode) invalidStage.path("items").get(0)).put("stage", "booking_confirmed");
    assertThrows(AccountProblem.class, () -> ShortlistService.validate(invalidStage));
    var injected = input(0); injected.put("ownerId", "other"); ((ObjectNode) injected.path("trip")).put("conversationId", "secret-chat");
    assertFalse(ShortlistService.validate(injected).toString().contains("secret-chat"));
    assertFalse(ShortlistService.validate(injected).has("ownerId"));
  }
  private record Reply(int status, JsonNode body) {}
  private static Reply request(int port, HttpClient browser, String path, JsonNode body) throws Exception {
    var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api" + path));
    if (body == null) request.GET(); else request.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(Json.write(body)));
    var response = browser.send(request.build(), HttpResponse.BodyHandlers.ofString());
    return new Reply(response.statusCode(), Json.read(response.body()));
  }
  @Test void httpRoutesRequireSessionAndBindOwnerFromCookie() throws Exception {
    try (var fixture = TestDatabases.start(seed(), Map.of("ACCOUNT_MODE", "true"))) {
      var first = HttpClient.newBuilder().cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();
      var other = HttpClient.newBuilder().cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();
      var anonymous = HttpClient.newHttpClient();
      assertEquals(401, request(fixture.port(), anonymous, "/account/shortlist", null).status());
      for (var entry : Map.of("first", first, "other", other).entrySet()) assertEquals(201, request(fixture.port(), entry.getValue(), "/auth/register", Json.obj("name", "Тестовый гость", "email", entry.getKey() + "@example.test", "password", "test password 123", "role", "user")).status());
      Reply save = request(fixture.port(), first, "/account/shortlist", input(0));
      assertEquals(200, save.status(), save.body().toString());
      assertTrue(request(fixture.port(), other, "/account/shortlist", null).body().path("items").isEmpty());
      Reply share = request(fixture.port(), first, "/account/shortlist/share", Json.obj("revision", 1));
      assertEquals(200, share.status(), share.body().toString());
      String token = share.body().path("token").asText();
      assertEquals(200, request(fixture.port(), anonymous, "/shortlists/" + token, null).status());
      assertEquals(401, request(fixture.port(), anonymous, "/account/shortlist/revoke", Json.obj()).status());
      assertEquals(200, request(fixture.port(), first, "/account/shortlist/revoke", Json.obj()).status());
      assertEquals(404, request(fixture.port(), anonymous, "/shortlists/" + token, null).status());
    }
  }
}
