package ru.opodoydet;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class BackendTest {
  @TempDir Path temp;
  private static final Instant NOW = Instant.parse("2026-10-24T12:00:00Z");

  private static ObjectNode trip() {
    return Json.obj(
        "region",
        "Пусан",
        "checkIn",
        "2027-06-10",
        "checkOut",
        "2027-06-17",
        "adults",
        2,
        "children",
        1,
        "scenarios",
        List.of(),
        "preferences",
        List.of(),
        "text",
        "");
  }

  private static ObjectNode preference(String feature, boolean required) {
    return Json.obj("feature", feature, "required", required);
  }

  private static ObjectNode hotel() {
    return Json.obj(
        "id",
        "hotel-a",
        "name",
        "Тестовый отель Пусана",
        "address",
        "Haeundae",
        "coordinates",
        List.of(129.16, 35.16),
        "osmUrl",
        "https://www.openstreetmap.org/",
        "route",
        null,
        "noise",
        List.of(),
        "rooms",
        List.of(realRoom("room-a"), realRoom("room-b")));
  }

  private static ObjectNode realRoom(String id) {
    return Json.obj(
        "id",
        id,
        "name",
        "Тестовая категория",
        "capacity",
        4,
        "demo",
        false,
        "evidenceStatus",
        "verified",
        "sourceUrl",
        "https://example.org/test-room",
        "quote",
        "Synthetic fixture: maximum 4 guests",
        "obtainedAt",
        "2026-10-01T00:00:00Z");
  }

  private static ObjectNode fact() {
    return Json.obj(
        "id",
        "fact-a",
        "hotelId",
        "hotel-a",
        "roomId",
        "room-a",
        "feature",
        "courtyard",
        "value",
        true,
        "source",
        "Демо",
        "quote",
        "Окна во двор",
        "method",
        "official",
        "confidence",
        "low",
        "confidenceReason",
        "Демонстрация",
        "obtainedAt",
        "2026-10-01T00:00:00Z",
        "expiresAt",
        "2030-01-01T00:00:00Z",
        "demo",
        false,
        "sourceUrl",
        "https://example.org/test-fact");
  }

  private static ObjectNode seed() {
    return Json.obj(
        "evidencePolicy",
        "demo",
        "region",
        "Пусан",
        "fetchedAt",
        NOW.toString(),
        "sourceDate",
        NOW.toString(),
        "attribution",
        "OSM",
        "bbox",
        List.of(129.1, 35.1, 129.2, 35.2),
        "hotels",
        List.of(hotel()),
        "facts",
        List.of(),
        "map",
        List.of());
  }

  private static JsonNode ask(Store store) throws Exception {
    return store.ask(
        Json.obj(
            "hotelId",
            "hotel-a",
            "roomId",
            "room-a",
            "feature",
            "courtyard",
            "text",
            "Куда выходят все окна?",
            "trace",
            List.of()));
  }

  private static ObjectNode draft(JsonNode question, String id, boolean value) {
    String text = value ? "Все окна во двор." : "Окна на улицу.";
    return Json.obj(
        "id",
        id,
        "questionId",
        question.path("id"),
        "text",
        text,
        "extractions",
        List.of(Json.obj("feature", "courtyard", "value", value, "quote", text)),
        "warnings",
        List.of(),
        "mode",
        "rules");
  }

  private static void save(Store store, JsonNode question, ObjectNode draft) throws Exception {
    store.saveDraft(draft, Json.str(question, "createdAt"));
  }

  private static JsonNode room() {
    return hotel().path("rooms").path(0);
  }

  @Test
  void validatesRealDatesRegionGuestsAndUniquePreferences() {
    assertDoesNotThrow(() -> Validation.trip(trip(), "Пусан"));
    for (ObjectNode invalid :
        List.of(
            trip().put("checkIn", "2027-02-30"),
            trip().put("checkOut", "2027-06-10"),
            trip().put("adults", 0),
            trip().put("children", 0.5),
            trip().put("region", "Адлер")))
      assertThrows(IllegalArgumentException.class, () -> Validation.trip(invalid, "Пусан"));
    ObjectNode duplicate = trip();
    duplicate.set(
        "preferences",
        Json.array(List.of(preference("courtyard", true), preference("courtyard", false))));
    assertThrows(IllegalArgumentException.class, () -> Validation.trip(duplicate, "Пусан"));
  }

  @Test
  void unknownExpiredInvalidAndOutOfPeriodEvidenceNeverMatches() {
    List<List<JsonNode>> facts =
        List.of(
            List.of(),
            List.of(fact().put("expiresAt", "2026-10-23T00:00:00Z")),
            List.of(fact().put("value", "unknown")),
            List.of(fact().put("validTo", "2027-06-12")),
            List.of(fact().put("supersededBy", "new")));
    List<String> expected = List.of("unknown", "stale", "unknown", "unknown", "unknown");
    for (int i = 0; i < facts.size(); i++)
      assertEquals(
          expected.get(i),
          Matching.evaluate(facts.get(i), preference("courtyard", true), room(), trip(), NOW)
              .path("status")
              .asText());
    assertEquals(
        "clarify",
        Matching.rank(
                List.of(hotel()), List.of(), List.of(preference("courtyard", true)), trip(), NOW)
            .getFirst()
            .path("best")
            .path("status")
            .asText());
  }

  @Test
  void factsStayWithinTheirHotelAndCategory() {
    List<JsonNode> facts =
        List.of(
            fact(),
            fact()
                .put("id", "access-b")
                .put("roomId", "room-b")
                .put("feature", "step_free_access"));
    JsonNode match =
        Matching.rank(
                List.of(hotel()),
                facts,
                List.of(preference("courtyard", true), preference("step_free_access", true)),
                trip(),
                NOW)
            .getFirst();
    assertEquals("clarify", match.path("best").path("status").asText());
    for (JsonNode room : match.path("rooms"))
      assertEquals(
          1,
          Json.list(room.path("criteria")).stream()
              .filter(c -> Json.str(c, "status").equals("match"))
              .count());
    JsonNode other =
        Matching.rank(
                List.of(hotel().put("id", "other")),
                facts,
                List.of(preference("courtyard", true)),
                trip(),
                NOW)
            .getFirst();
    assertEquals("unknown", other.path("best").path("criteria").path(0).path("status").asText());
  }

  @Test
  void conflictsAndMandatoryMismatchesAreNeverSilentlyRelaxed() {
    assertEquals(
        "conflict",
        Matching.evaluate(
                List.of(fact(), fact().put("id", "no").put("value", false)),
                preference("courtyard", true),
                room(),
                trip(),
                NOW)
            .path("status")
            .asText());
    ObjectNode distance = fact().put("feature", "beach_walk").put("value", 1500);
    distance.remove("roomId");
    assertEquals(
        "excluded",
        Matching.rank(
                List.of(hotel()),
                List.of(distance),
                List.of(preference("beach_walk", true)),
                trip(),
                NOW)
            .getFirst()
            .path("best")
            .path("status")
            .asText());
    assertEquals(
        "fits",
        Matching.rank(
                List.of(hotel()),
                List.of(distance),
                List.of(preference("beach_walk", false)),
                trip(),
                NOW)
            .getFirst()
            .path("best")
            .path("status")
            .asText());
    assertEquals(
        "excluded",
        Matching.rank(List.of(hotel()), List.of(), List.of(), trip().put("adults", 5), NOW)
            .getFirst()
            .path("best")
            .path("status")
            .asText());
  }

  @Test
  void mandatorySelectionsSurviveTextAndNegationStaysLocal() {
    JsonNode interpreted =
        Agents.parseRules(
            "Тишина не нужна, нужен семейный номер.", List.of(preference("courtyard", true)));
    assertFalse(interpreted.path("conflicts").isEmpty());
    assertTrue(interpreted.path("preferences").path(0).path("required").asBoolean());
    assertTrue(
        Json.list(interpreted.path("preferences")).stream()
            .anyMatch(p -> Json.str(p, "feature").equals("family")));
    assertFalse(
        Agents.parseRules("Не обязательно тихий номер", List.of())
            .path("preferences")
            .path(0)
            .path("required")
            .asBoolean());
    assertTrue(
        Agents.parseRules("Тихий номер", List.of())
            .path("warnings")
            .toString()
            .contains("не гарантирует"));
  }

  @Test
  void extractionRejectsPartialAmbiguousAndSpecificRoomClaims() {
    Map<String, String> examples =
        Map.ofEntries(
            Map.entry("Лифт есть.", "step_free_access"),
            Map.entry("Лифта нет.", "step_free_access"),
            Map.entry("Вход без ступеней.", "step_free_access"),
            Map.entry("Перед входом три ступени, есть обход по пандусу.", "step_free_access"),
            Map.entry("Номер 203 выходит во двор.", "courtyard"),
            Map.entry("Не все окна во двор.", "courtyard"),
            Map.entry("Возможно, все окна во двор.", "courtyard"),
            Map.entry("Подходит.", "family"),
            Map.entry("С детьми не знаю.", "family"));
    examples.forEach(
        (text, feature) ->
            assertTrue(Agents.extractRules(text, feature).path("extractions").isEmpty(), text));
    assertFalse(
        Agents.extractRules("Этот номер не семейный.", "family")
            .path("extractions")
            .path(0)
            .path("value")
            .asBoolean());
    assertFalse(
        Agents.extractRules(
                "Лифт есть, но перед входом три ступени, пандуса нет.", "step_free_access")
            .path("extractions")
            .path(0)
            .path("value")
            .asBoolean());
    String text = "От улицы до номера можно пройти без ступеней.";
    JsonNode extraction = Agents.extractRules(text, "step_free_access").path("extractions").path(0);
    assertTrue(extraction.path("value").asBoolean());
    assertEquals(text, Json.str(extraction, "quote"));
  }

  @Test
  void sqlitePersistsCatalogRoomsAnswersAndRegionIsolationWithoutResurrectingSeedFacts()
      throws Exception {
    Path database = temp.resolve("busan.sqlite3");
    ObjectNode seeded = seed();
    seeded.set("facts", Json.array(List.of(fact().put("demo", true))));
    String factId;
    try (Store store = new Store(database.toString(), seeded)) {
      JsonNode q = ask(store);
      save(store, q, draft(q, "a", false));
      factId = Json.str(store.confirm("a", true).getFirst(), "id");
      store.importSeed(seeded);
      assertEquals(2, store.facts().size());
      assertTrue(
          store.facts().stream()
              .filter(f -> Json.str(f, "id").equals("fact-a"))
              .findFirst()
              .orElseThrow()
              .hasNonNull("supersededBy"));
      assertEquals(1, store.hotels().size());
      assertEquals(2, store.hotel("hotel-a").path("rooms").size());
      try (var sql = store.connection.createStatement();
          var result = sql.executeQuery("SELECT sqlite_version()")) {
        assertTrue(result.next());
        assertTrue(result.getString(1).startsWith("3."));
      }
    }
    try (Store store = new Store(database.toString(), seeded)) {
      assertEquals(2, store.facts().size());
      assertTrue(store.facts().stream().anyMatch(f -> Json.str(f, "id").equals(factId)));
      assertEquals("answered", Json.str(store.questions().getFirst(), "status"));
    }
    try (Store other = new Store(database.toString(), seed().put("region", "Other"))) {
      assertTrue(other.facts().isEmpty());
      assertTrue(other.questions().isEmpty());
      assertEquals("Other", Json.str(other.dataset(), "region"));
    }
  }

  @Test
  void catalogSyncAddsHotelsAndRetainsOmittedHotelsRoomsAndUserHistory() throws Exception {
    Path database = temp.resolve("catalog-sync.sqlite3");
    ObjectNode initial = seed();
    initial.set("facts", Json.array(List.of(fact().put("demo", true))));
    JsonNode answered, pending, savedDraft, hostFact;
    try (Store store = new Store(database.toString(), initial)) {
      JsonNode question = ask(store);
      save(store, question, draft(question, "confirmed", false));
      hostFact = store.confirm("confirmed", true).getFirst();
      answered = store.question(Json.str(question, "id"));
      pending =
          store.ask(
              Json.obj(
                  "hotelId",
                  "hotel-a",
                  "roomId",
                  "room-b",
                  "feature",
                  "courtyard",
                  "text",
                  "Куда выходят окна?",
                  "trace",
                  List.of()));
      savedDraft = draft(pending, "pending", true);
      save(store, pending, (ObjectNode) savedDraft);

      ObjectNode updatedHotel = hotel().put("name", "Обновлённое название");
      updatedHotel.set("rooms", Json.array(List.of(room())));
      ObjectNode expanded = seed();
      expanded.set("hotels", Json.array(List.of(updatedHotel, hotel().put("id", "hotel-new"))));
      expanded.set("facts", Json.array(List.of(fact())));
      store.importSeed(expanded);
      store.importSeed(expanded);
      assertEquals(2, store.hotels().size());
      assertEquals("Обновлённое название", Json.str(store.hotel("hotel-a"), "name"));
      assertEquals(2, store.hotel("hotel-a").path("rooms").size());
      assertEquals(answered, store.question(Json.str(answered, "id")));
      assertEquals(pending, store.question(Json.str(pending, "id")));
      assertEquals(savedDraft, store.draft("pending"));
      assertEquals(2, store.facts().size());
      assertTrue(store.facts().contains(hostFact));
      assertEquals(
          Json.str(hostFact, "id"),
          store.facts().stream()
              .filter(f -> Json.str(f, "id").equals("fact-a"))
              .findFirst()
              .orElseThrow()
              .path("supersededBy")
              .asText());
    }

    ObjectNode partial = seed();
    partial.set("hotels", Json.array(List.of(hotel().put("id", "hotel-new"))));
    try (Store store = new Store(database.toString(), partial)) {
      assertEquals(2, store.hotels().size());
      assertNotNull(store.hotel("hotel-a"));
      assertNotNull(Store.room(store.hotel("hotel-a"), "room-b"));
      assertEquals(answered, store.question(Json.str(answered, "id")));
      assertEquals(savedDraft, store.draft("pending"));
      assertEquals(List.of(hostFact), store.facts());
      try (var sql = store.connection.createStatement();
          var rows = sql.executeQuery("SELECT body,active FROM facts WHERE id='fact-a'")) {
        assertTrue(rows.next());
        assertEquals(
            Json.str(hostFact, "id"), Json.read(rows.getString(1)).path("supersededBy").asText());
        assertEquals(0, rows.getInt(2));
      }
      assertEquals(1, store.confirm("pending", false).size());
    }
  }

  @Test
  void confirmationIsIdempotentAndReopeningCannotReuseAnOldPreview() throws Exception {
    try (Store store = new Store(":memory:", seed())) {
      JsonNode question = ask(store);
      assertEquals(question, ask(store));
      save(store, question, draft(question, "a", true));
      save(store, question, draft(question, "b", false));
      assertTrue(store.confirm("a", false).getFirst().path("demo").asBoolean());
      assertThrows(IllegalArgumentException.class, () -> store.confirm("a", false));
      ask(store);
      assertNull(store.draft("b"));
      assertThrows(IllegalArgumentException.class, () -> store.confirm("b", false));
      assertEquals(1, store.facts().size());
    }
  }

  @Test
  void invalidExtractionScopeAndOldRevisionAreRejected() throws Exception {
    try (Store store = new Store(":memory:", seed())) {
      JsonNode question = ask(store);
      ObjectNode invalid = draft(question, "a", true);
      ((ObjectNode) invalid.path("extractions").path(0)).put("feature", "family");
      assertThrows(IllegalArgumentException.class, () -> save(store, question, invalid));
      assertThrows(
          IllegalArgumentException.class,
          () -> store.saveDraft(draft(question, "b", true), "obsolete"));
      ObjectNode forged = draft(question, "c", true);
      ((ObjectNode) forged.path("extractions").path(0)).put("quote", "Выдуманная цитата");
      assertThrows(IllegalArgumentException.class, () -> save(store, question, forged));
    }
  }

  @Test
  void confirmationFailureRollsBackFactsSupersessionAndQuestion() throws Exception {
    ObjectNode seeded = seed();
    seeded.set("facts", Json.array(List.of(fact())));
    try (Store store = new Store(":memory:", seeded)) {
      JsonNode question = ask(store);
      save(store, question, draft(question, "fail", false));
      store.execute(
          "CREATE TRIGGER reject_answer BEFORE UPDATE ON questions BEGIN SELECT RAISE(ABORT, 'test"
              + " rollback'); END");
      assertThrows(java.sql.SQLException.class, () -> store.confirm("fail", true));
      assertEquals(1, store.facts().size());
      assertFalse(store.facts().getFirst().hasNonNull("supersededBy"));
      assertEquals("open", Json.str(store.question(Json.str(question, "id")), "status"));
      assertNotNull(store.draft("fail"));
      store.execute("DROP TRIGGER reject_answer");
      assertEquals(1, store.confirm("fail", true).size());
    }
  }

  @Test
  void modelOutageAndUnsupportedQuoteFallBackHonestly() throws Exception {
    AtomicInteger calls = new AtomicInteger();
    HttpServer mock = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    mock.createContext(
        "/responses",
        exchange -> {
          int call = calls.incrementAndGet();
          byte[] output =
              (call == 1
                      ? "unavailable"
                      : Json.write(
                          Json.obj(
                              "status",
                              "completed",
                              "output",
                              List.of(
                                  Json.obj(
                                      "content",
                                      List.of(
                                          Json.obj(
                                              "type",
                                              "output_text",
                                              "text",
                                              Json.write(
                                                  Json.obj(
                                                      "extractions",
                                                      List.of(
                                                          Json.obj(
                                                              "feature",
                                                              "step_free_access",
                                                              "value",
                                                              true,
                                                              "quote",
                                                              "Выдуманная цитата")),
                                                      "warnings",
                                                      List.of())))))))))
                  .getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(call == 1 ? 503 : 200, output.length);
          exchange.getResponseBody().write(output);
          exchange.close();
        });
    mock.start();
    try {
      Agents agents =
          new Agents(
              new Agents.Config(
                  "test-only", "test-model", "http://127.0.0.1:" + mock.getAddress().getPort()));
      JsonNode interpreted = agents.interpret(trip().put("text", "Тихий номер"));
      assertEquals("rules", Json.str(interpreted, "mode"));
      assertTrue(interpreted.path("warnings").toString().contains("недоступен"));
      assertTrue(interpreted.path("warnings").toString().contains("не гарантирует"));
      JsonNode answer = agents.extract("Лифт есть.", "step_free_access");
      assertEquals("rules", Json.str(answer, "mode"));
      assertTrue(answer.path("extractions").isEmpty());
      assertEquals(2, calls.get());
    } finally {
      mock.stop(0);
    }
  }

  @Test
  void httpContractQuestionPreviewConfirmationAndUpdatedMatching() throws Exception {
    Files.writeString(temp.resolve("index.html"), "<!doctype html><title>MVP</title>");
    try (Store store = new Store(":memory:", seed());
        Api api =
            new Api(
                store,
                new Agents(Agents.Config.from(Map.of())),
                temp,
                temp.resolve("areas.json"),
                "",
                0)) {
      api.start();
      String base = "http://127.0.0.1:" + api.port();
      assertEquals(
          400, request(base, "POST", "/api/search", trip().put("region", "Адлер"), null).code);
      assertEquals(403, request(base, "POST", "/api/search", trip(), "https://external.test").code);
      assertEquals(403, request(base, "POST", "/api/search", trip(), "invalid").code);
      JsonNode catalog = request(base, "GET", "/api/catalog", null, null).body;
      assertEquals("Пусан", Json.str(catalog, "region"));
      assertEquals(1, catalog.path("hotels").size());
      assertFalse(catalog.has("facts"));
      ObjectNode search = trip();
      search.set("preferences", Json.array(List.of(preference("courtyard", true))));
      assertEquals(
          "clarify",
          request(base, "POST", "/api/search", search, null)
              .body
              .path("results")
              .path(0)
              .path("best")
              .path("status")
              .asText());
      ObjectNode ask =
          Json.obj(
              "hotelId", "hotel-a", "roomId", "room-a", "feature", "courtyard", "trip", trip());
      JsonNode q = request(base, "POST", "/api/questions", ask, null).body.path("question");
      assertEquals(q, request(base, "POST", "/api/questions", ask, null).body.path("question"));
      JsonNode preview =
          request(
                  base,
                  "POST",
                  "/api/questions/" + Json.str(q, "id") + "/preview",
                  Json.obj("text", "Все окна во двор."),
                  null)
              .body;
      assertEquals(1, preview.path("extractions").size());
      assertTrue(store.facts().isEmpty());
      String confirm = "/api/drafts/" + Json.str(preview, "id") + "/confirm";
      assertEquals(
          400, request(base, "POST", confirm, Json.obj("resolveConflict", "true"), null).code);
      assertTrue(
          request(base, "POST", confirm, Json.obj("resolveConflict", false), null)
              .body
              .path("facts")
              .path(0)
              .path("demo")
              .asBoolean());
      assertEquals(
          400, request(base, "POST", confirm, Json.obj("resolveConflict", false), null).code);
      JsonNode best =
          request(base, "POST", "/api/search", search, null)
              .body
              .path("results")
              .path(0)
              .path("best");
      assertEquals("fits", Json.str(best, "status"));
      assertEquals("room-a", Json.str(best.path("room"), "id"));
      assertEquals(
          404,
          request(
                  base,
                  "POST",
                  "/api/questions/" + Json.str(q, "id") + "/preview",
                  Json.obj("text", "Все окна во двор."),
                  null)
              .code);
      search.put("text", "Тихий номер не нужен.");
      JsonNode conflict = request(base, "POST", "/api/search", search, null).body;
      assertTrue(conflict.path("results").isEmpty());
      assertFalse(conflict.path("conflicts").isEmpty());
      assertTrue(
          request(base, "GET", "/api/areas/hotel-a", null, null).body.path("assessment").isNull());
      HttpResponse<String> staticPage =
          HttpClient.newHttpClient()
              .send(
                  HttpRequest.newBuilder(URI.create(base + "/hotels/hotel-a")).GET().build(),
                  HttpResponse.BodyHandlers.ofString());
      assertEquals(200, staticPage.statusCode());
      assertTrue(staticPage.body().contains("MVP"));
      assertEquals(404, request(base, "GET", "/../pom.xml", null, null).code);
    }
  }

  @Test
  void areaFreshnessAndCoordinatesAreCheckedWithoutInventingSafety() throws Exception {
    Path area = temp.resolve("areas.json");
    ObjectNode item =
        Json.obj(
            "hotelId",
            "hotel-a",
            "coordinates",
            hotel().path("coordinates"),
            "assessedAt",
            NOW.minusSeconds(8 * 3600).toString(),
            "airQuality",
            Json.obj(
                "status",
                "available",
                "time",
                NOW.minusSeconds(8 * 3600).toString(),
                "pm25",
                12,
                "limitations",
                List.of()),
            "safety",
            Json.obj("status", "unknown", "summary", "Нет сведений"));
    Files.writeString(area, Json.write(Json.obj("assessments", List.of(item))));
    try (Store store = new Store(":memory:", seed());
        Api api = new Api(store, new Agents(Agents.Config.from(Map.of())), temp, area, "", 0)) {
      JsonNode result = api.assessment(hotel(), NOW);
      assertEquals("stale", Json.str(result.path("airQuality"), "status"));
      assertEquals("unknown", Json.str(result.path("safety"), "status"));
      assertEquals(
          "available",
          Json.read(Files.readString(area))
              .path("assessments")
              .path(0)
              .path("airQuality")
              .path("status")
              .asText());
      item.set("coordinates", Json.array(List.of(39.7, 43.5)));
      Files.writeString(area, Json.write(Json.obj("assessments", List.of(item))));
      assertNull(api.assessment(hotel(), NOW));
    }
  }

  @Test
  void missingInvalidFutureAndCachedAirTimesCannotRemainAvailable() throws Exception {
    Path area = temp.resolve("freshness.json");
    ObjectNode item =
        Json.obj(
            "hotelId",
            "hotel-a",
            "coordinates",
            hotel().path("coordinates"),
            "assessedAt",
            NOW.toString(),
            "airQuality",
            Json.obj(
                "status",
                "available",
                "time",
                NOW.toString(),
                "fetchedAt",
                NOW.toString(),
                "limitations",
                List.of()),
            "safety",
            Json.obj("status", "unknown"));
    try (Store store = new Store(":memory:", seed());
        Api api = new Api(store, new Agents(Agents.Config.from(Map.of())), temp, area, "", 0)) {
      Files.writeString(area, Json.write(Json.obj("assessments", List.of(item))));
      assertEquals(
          "available", api.assessment(hotel(), NOW).path("airQuality").path("status").asText());
      for (String field : List.of("time", "fetchedAt"))
        for (String value :
            List.of(
                "",
                "invalid",
                NOW.plusSeconds(3600).toString(),
                NOW.minusSeconds(7 * 3600).toString())) {
          ObjectNode changed = item.deepCopy();
          ((ObjectNode) changed.path("airQuality")).put(field, value);
          Files.writeString(area, Json.write(Json.obj("assessments", List.of(changed))));
          assertEquals(
              "stale",
              api.assessment(hotel(), NOW).path("airQuality").path("status").asText(),
              field + "=" + value);
        }
    }
  }

  private record Response(int code, JsonNode body) {}

  @Test
  void verifiedOnlyIgnoresEveryDemoFlagAndRequiresRoomProvenance() {
    for (ObjectNode untrusted :
        List.of(
            fact().put("demo", true),
            fact().put("method", "demo"),
            fact().put("sourceUrl", ""),
            fact().put("obtainedAt", "2028-01-01T00:00:00Z"))) {
      assertEquals(
          "unknown",
          Json.str(
              Matching.evaluate(
                  List.of(untrusted), preference("courtyard", true), room(), trip(), NOW),
              "status"));
    }
    ObjectNode missingFlag = fact();
    missingFlag.remove("demo");
    assertEquals(
        "unknown",
        Json.str(
            Matching.evaluate(
                List.of(missingFlag), preference("courtyard", true), room(), trip(), NOW),
            "status"));
    assertEquals(
        "match",
        Json.str(
            Matching.evaluate(
                List.of(
                    fact(),
                    fact().put("id", "fake-negative").put("demo", true).put("value", false)),
                preference("courtyard", true),
                room(),
                trip(),
                NOW),
            "status"));
    ObjectNode demoHotel = hotel();
    demoHotel.set("rooms", Json.array(List.of(realRoom("room-a").put("demo", true))));
    JsonNode result =
        Matching.rank(List.of(demoHotel), List.of(fact()), List.of(), trip(), NOW).getFirst();
    assertEquals("clarify", Json.str(result.path("best"), "status"));
    assertEquals("unknown", Json.str(result.path("best"), "capacityStatus"));
    assertEquals("hotel-a-unverified", Json.str(result.path("best").path("room"), "id"));
    assertFalse(result.path("hotel").path("rooms").toString().contains("\"demo\":true"));
    assertEquals(
        "unknown",
        Json.str(
            Matching.evaluate(
                List.of(fact().put("roomId", "hotel-a-unverified")),
                preference("courtyard", true),
                result.path("best").path("room"),
                trip(),
                NOW),
            "status"));
  }

  @Test
  void unknownAndConditionalCapacityClarifyAndNullGeoEvidenceExplainsItsLimits() {
    assertFalse(
        Evidence.room(
            realRoom("old").put("obtainedAt", NOW.minusSeconds(31L * 86400).toString()), NOW));
    assertTrue(
        Evidence.room(
            realRoom("recent").put("obtainedAt", NOW.minusSeconds(30L * 86400).toString()), NOW));
    for (ObjectNode room :
        List.of(
            realRoom("room-a").putNull("capacity"),
            realRoom("room-a").put("capacity", 2).put("capacityMayVary", true))) {
      ObjectNode h = hotel();
      h.set("rooms", Json.array(List.of(room)));
      JsonNode best =
          Matching.rank(List.of(h), List.of(), List.of(), trip(), NOW).getFirst().path("best");
      assertEquals("clarify", Json.str(best, "status"));
      assertEquals("unknown", Json.str(best, "capacityStatus"));
    }
    ObjectNode partial =
        fact()
            .put("feature", "step_free_route")
            .put("method", "geo")
            .put("quote", "OSM: steps absent, entire route not surveyed")
            .putNull("value");
    partial.remove("roomId");
    JsonNode criterion =
        Matching.evaluate(
            List.of(partial), preference("step_free_route", true), room(), trip(), NOW);
    assertEquals("unknown", Json.str(criterion, "status"));
    assertTrue(Json.str(criterion, "explanation").contains("entire route not surveyed"));
    assertEquals(1, criterion.path("facts").size());
  }

  @Test
  void verifiedCatalogKeepsLegacyHistoryButHidesDemoRoomsFactsAndHostChanges() throws Exception {
    Path db = temp.resolve("verified-transition.sqlite3");
    ObjectNode legacy = seed();
    ObjectNode oldHotel = hotel();
    oldHotel.set(
        "rooms",
        Json.array(
            List.of(realRoom("room-a").put("demo", true), realRoom("room-b").put("demo", true))));
    legacy.set("hotels", Json.array(List.of(oldHotel)));
    legacy.set("facts", Json.array(List.of(fact().put("demo", true))));
    JsonNode oldQuestion;
    try (Store store = new Store(db.toString(), legacy)) {
      oldQuestion = ask(store);
      save(store, oldQuestion, draft(oldQuestion, "legacy-preview", false));
    }
    ObjectNode verified = seed();
    verified.remove("evidencePolicy");
    ObjectNode realHotel = hotel();
    realHotel.set("rooms", Json.array(List.of(realRoom("real-room"))));
    verified.set("hotels", Json.array(List.of(realHotel)));
    verified.set(
        "facts", Json.array(List.of(fact().put("id", "real-fact").put("roomId", "real-room"))));
    try (Store store = new Store(db.toString(), verified);
        Api api =
            new Api(
                store,
                new Agents(Agents.Config.from(Map.of())),
                temp,
                temp.resolve("areas.json"),
                "",
                0)) {
      assertEquals("verified-only", store.evidencePolicy());
      assertNotNull(store.draft("legacy-preview"));
      assertEquals(oldQuestion, store.question(Json.str(oldQuestion, "id")));
      assertEquals(1, store.hotel("hotel-a").path("rooms").size());
      assertEquals("real-room", Json.str(store.hotel("hotel-a").path("rooms").get(0), "id"));
      assertEquals(1, store.matchingFacts().size());
      JsonNode q =
          store.ask(
              Json.obj(
                  "hotelId",
                  "hotel-a",
                  "roomId",
                  "real-room",
                  "feature",
                  "courtyard",
                  "text",
                  "Test",
                  "trace",
                  List.of()));
      save(store, q, draft(q, "host-demo", false));
      store.confirm("host-demo", true);
      assertFalse(store.matchingFacts().getFirst().has("supersededBy"));
      assertEquals(1, store.matchingFacts().size());
      assertEquals(2, store.facts().size());
      api.start();
      String base = "http://127.0.0.1:" + api.port();
      JsonNode catalog = request(base, "GET", "/api/catalog", null, null).body;
      assertFalse(catalog.toString().contains("\"demo\":true"));
      JsonNode detail = request(base, "GET", "/api/hotels/hotel-a", null, null).body;
      assertEquals(1, detail.path("facts").size());
      ObjectNode query = trip();
      query.set("preferences", Json.array(List.of(preference("courtyard", true))));
      JsonNode best =
          request(base, "POST", "/api/search", query, null)
              .body
              .path("results")
              .get(0)
              .path("best");
      assertEquals("fits", Json.str(best, "status"));
      assertFalse(best.toString().contains("\"demo\":true"));
      store.confirm("legacy-preview", true);
      assertEquals(1, store.matchingFacts().size());
    }
  }

  private static Response request(
      String base, String method, String path, JsonNode body, String origin) throws Exception {
    HttpRequest.Builder request =
        HttpRequest.newBuilder(URI.create(base + path)).header("Content-Type", "application/json");
    if (origin != null) request.header("Origin", origin);
    request.method(
        method,
        body == null
            ? HttpRequest.BodyPublishers.noBody()
            : HttpRequest.BodyPublishers.ofString(Json.write(body)));
    HttpResponse<String> response =
        HttpClient.newHttpClient().send(request.build(), HttpResponse.BodyHandlers.ofString());
    return new Response(response.statusCode(), Json.read(response.body()));
  }
}
