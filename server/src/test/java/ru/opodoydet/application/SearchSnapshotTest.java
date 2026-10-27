package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import ru.opodoydet.advisor.AdvisorService;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.server.support.TestDatabases.Database;
import ru.opodoydet.shared.Json;

class SearchSnapshotTest {
  private static ObjectNode seed(int capacity) {
    return Json.obj(
        "region",
        "Пусан",
        "evidencePolicy",
        "demo",
        "hotels",
        List.of(
            Json.obj(
                "id",
                "hotel",
                "name",
                "Hotel",
                "rooms",
                List.of(
                    Json.obj("id", "room", "name", "Family", "capacity", capacity, "demo", true)))),
        "facts",
        List.of(
            Json.obj(
                "id",
                "family",
                "hotelId",
                "hotel",
                "roomId",
                "room",
                "feature",
                "family",
                "value",
                true,
                "demo",
                true,
                "method",
                "demo",
                "expiresAt",
                "2099-01-01T00:00:00Z")));
  }

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
        0,
        "scenarios",
        List.of(),
        "preferences",
        List.of(),
        "text",
        "");
  }

  private static Environment environment() {
    return new Environment(Path.of("missing-air"), Path.of("missing-noise"));
  }

  @Test
  void labCasesExposeAllSixSnapshotDecisionsWithoutExpandingSelectableCandidates()
      throws Exception {
    List<JsonNode> hotels = new ArrayList<>(), facts = new ArrayList<>();
    for (int i = 0; i < 7; i++) {
      String id = "control-" + i;
      hotels.add(caseHotel(id, 4, false));
      facts.add(caseFact(id, "family", true, "", false));
      facts.add(caseFact(id, "courtyard", true, "", false));
    }
    for (String scenario :
        List.of("match", "mismatch", "unknown", "stale", "conflict", "capacity")) {
      String id = "lab-demo-" + scenario;
      hotels.add(caseHotel(id, scenario.equals("capacity") ? 2 : 4, true));
      facts.add(caseFact(id, "family", true, "", false));
      if (!scenario.equals("unknown"))
        facts.add(
            caseFact(id, "courtyard", !scenario.equals("mismatch"), "", scenario.equals("stale")));
      if (scenario.equals("conflict")) facts.add(caseFact(id, "courtyard", false, "-other", false));
    }
    ObjectNode seed =
        Json.obj("region", "Пусан", "evidencePolicy", "demo", "hotels", hotels, "facts", facts);
    ObjectNode trip = trip().put("children", 1);
    trip.set(
        "preferences",
        Json.array(
            List.of(
                Json.obj("feature", "courtyard", "required", true),
                Json.obj("feature", "family", "required", true))));
    MutableClock clock = new MutableClock();
    try (var database = TestDatabases.create(seed)) {
      Store store = database.store();
      SearchService search =
          new SearchService(store, new Agents(Agents.Config.from(Map.of())), environment(), clock);
      String searchId = Json.str(search.search(trip), "searchId");
      ObjectNode context = search.advisorContext(trip, searchId);
      assertEquals(6, context.path("testCases").size());
      assertEquals(6, context.path("candidates").size());
      assertTrue(
          Json.list(context.path("candidates")).stream()
              .allMatch(candidate -> Json.str(candidate, "hotelId").startsWith("control-")));
      Map<String, String> expected =
          Map.of(
              "match",
              "match",
              "mismatch",
              "mismatch",
              "unknown",
              "unknown",
              "stale",
              "stale",
              "conflict",
              "conflict",
              "capacity",
              "match");
      for (Map.Entry<String, String> entry : expected.entrySet()) {
        String hotelId = "lab-demo-" + entry.getKey();
        JsonNode candidate =
            Json.list(context.path("testCases")).stream()
                .filter(item -> Json.str(item, "hotelId").equals(hotelId))
                .findFirst()
                .orElseThrow();
        assertEquals(
            entry.getKey().equals("match") ? "fits" : "excluded", Json.str(candidate, "status"));
        JsonNode courtyard =
            Json.list(candidate.path("criteria")).stream()
                .filter(item -> Json.str(item, "feature").equals("courtyard"))
                .findFirst()
                .orElseThrow();
        assertEquals(entry.getValue(), Json.str(courtyard, "evidenceStatus"));
        assertTrue(courtyard.path("required").asBoolean());
        assertFalse(
            candidate.has("aiDecision"),
            "Test cases are Java decisions, not fabricated AI outputs");
        if (entry.getKey().equals("capacity"))
          assertEquals("mismatch", candidate.path("criteria").get(0).path("status").asText());
      }
      ObjectNode invalidSelection =
          Json.obj(
              "outcome",
              "shortlist",
              "summary",
              "Invalid fixture selection",
              "candidateIds",
              List.of("lab-demo-mismatch::lab-demo-mismatch-room"),
              "scenarioIds",
              List.of(),
              "questionId",
              null,
              "cautions",
              List.of(),
              "nextSteps",
              List.of());
      assertThrows(
          IllegalArgumentException.class,
          () -> AdvisorService.checkedReport(context, invalidSelection));
      ObjectNode changed = seed.deepCopy();
      for (JsonNode hotel : changed.path("hotels"))
        ((ObjectNode) hotel.path("rooms").get(0)).put("capacity", 1);
      database.importSeed(changed);
      assertEquals(
          context.path("testCases"), search.advisorContext(trip, searchId).path("testCases"));
    }
  }

  private static ObjectNode caseHotel(String id, int capacity, boolean synthetic) {
    return Json.obj(
        "id",
        id,
        "name",
        id,
        "synthetic",
        synthetic,
        "rooms",
        List.of(
            Json.obj("id", id + "-room", "name", "Category", "capacity", capacity, "demo", true)));
  }

  private static ObjectNode caseFact(
      String hotelId, String feature, boolean value, String suffix, boolean expired) {
    return Json.obj(
        "id",
        hotelId + "-" + feature + suffix,
        "hotelId",
        hotelId,
        "roomId",
        hotelId + "-room",
        "feature",
        feature,
        "value",
        value,
        "demo",
        true,
        "method",
        "demo",
        "expiresAt",
        expired ? "2026-10-23T12:00:00Z" : "2099-01-01T00:00:00Z");
  }

  @Test
  void advisorReusesDeterministicInterpretationAndEvidenceSnapshotWithoutModelCalls()
      throws Exception {
    AtomicInteger calls = new AtomicInteger();
    HttpServer provider = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    provider.createContext(
        "/responses",
        exchange -> {
          calls.incrementAndGet();
          exchange.getRequestBody().readAllBytes();
          ObjectNode content =
              Json.obj(
                  "preferences",
                  List.of(Json.obj("feature", "family", "required", true)),
                  "excluded",
                  List.of(),
                  "warnings",
                  List.of("Synthetic interpretation"));
          byte[] body =
              Json.write(
                      Json.obj(
                          "status",
                          "completed",
                          "output",
                          List.of(
                              Json.obj(
                                  "content",
                                  List.of(
                                      Json.obj(
                                          "type", "output_text", "text", Json.write(content)))))))
                  .getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    provider.start();
    ObjectNode originalSeed = seed(4);
    ((ObjectNode) originalSeed.path("facts").get(0))
        .put("sourceUrl", "https://example.org/synthetic-family-source")
        .put("source", "Synthetic test source");
    try (var database = TestDatabases.create(originalSeed)) {
      Store store = database.store();
      SearchService service =
          new SearchService(
              store,
              new Agents(
                  new Agents.Config(
                      "test-key",
                      "test-model",
                      "http://127.0.0.1:" + provider.getAddress().getPort())),
              environment());
      ObjectNode unknown = service.search(trip().put("text", "Условия для маленького путешественника обязательны"));
      assertEquals("unrecognized", unknown.path("personalWishes").path("status").asText());
      assertTrue(unknown.path("preferences").isEmpty(), "Unsupported prose must not acquire model-inferred criteria");
      assertEquals(0, calls.get());
      ObjectNode input = trip().put("text", "Семейный номер обязателен");
      ObjectNode result = service.search(input);
      assertEquals("rules", Json.str(result, "mode"));
      assertEquals("recognized", result.path("personalWishes").path("status").asText());
      assertEquals("family", result.path("personalWishes").path("features").path(0).asText());
      assertEquals("unverified", result.path("personalWishes").path("completeness").asText());
      assertEquals(0, calls.get(), "Search must not contact even a configured provider");
      assertEquals(
          Agents.parseRules(Json.str(input, "text"), List.of()).path("preferences"),
          result.path("preferences"));
      String id = Json.str(result, "searchId");
      ObjectNode originalContext = service.advisorContext(input, id);
      JsonNode originalCandidates = originalContext.path("candidates").deepCopy();
      JsonNode familyEvidence = Json.list(originalCandidates.get(0).path("criteria")).stream()
          .filter(criterion -> "family".equals(Json.str(criterion, "feature")))
          .findFirst().orElseThrow();
      assertEquals("match", familyEvidence.path("evidenceStatus").asText());
      assertEquals("https://example.org/synthetic-family-source", familyEvidence.path("sources").get(0).path("url").asText());
      database.importSeed(seed(1));
      ((ObjectNode) result.path("preferences").get(0)).put("required", false);
      ObjectNode context = service.advisorContext(input, id);
      assertTrue(context.path("preferences").get(0).path("required").asBoolean());
      assertEquals("family", context.path("preferences").get(0).path("feature").asText());
      assertEquals(result.path("personalWishes"), context.path("personalWishes"));
      assertEquals(
          1, context.path("fitCount").asInt(), "Cached capacity must survive catalog change");
      assertEquals("fits", context.path("candidates").get(0).path("status").asText());
      assertEquals(originalCandidates, context.path("candidates"), "Snapshot retains criterion evidence and source links after catalog replacement");
      assertEquals(id, context.path("searchId").asText());
      ((ObjectNode) context.path("candidates").get(0)).put("status", "excluded");
      assertEquals(originalCandidates, service.advisorContext(input, id).path("candidates"), "Caller mutations must not change the stored snapshot");
      assertTrue(service.search(input).path("roomRecommendations").isEmpty(), "Fresh search sees the changed capacity");
      assertEquals(originalCandidates, service.advisorContext(input, id).path("candidates"));
      assertEquals(0, calls.get(), "Neither snapshot reuse nor a fresh search may invoke the model");
    } finally {
      provider.stop(0);
    }
  }

  @Test
  void explorationIsBoundToSnapshotAndTextConflictCannotKeepProvisionalAdmission() throws Exception {
    try (var database = TestDatabases.create(seed(4))) {
      Store store = database.store();
      SearchService service = new SearchService(store, new Agents(Agents.Config.from(Map.of())), environment());
      ObjectNode query = trip().put("admissionMode", "explore");
      query.set("preferences", Json.array(List.of(Json.obj("feature", "courtyard", "required", true))));
      ObjectNode result = service.search(query);
      assertEquals("explore", Json.str(result, "admissionMode"));
      assertTrue(result.path("results").get(0).path("best").path("provisional").asBoolean());
      String id = Json.str(result, "searchId");
      assertThrows(IllegalArgumentException.class,
          () -> service.advisorContext(query.deepCopy().put("admissionMode", "verified"), id));
      assertEquals("explore", service.advisorContext(query, id).path("trip").path("admissionMode").asText());
      assertTrue(service.detail("hotel", query).path("best").path("provisional").asBoolean());

      ObjectNode conflict = query.deepCopy().put("text", "Окна во двор не нужны");
      ObjectNode blocked = service.search(conflict);
      assertFalse(blocked.path("conflicts").isEmpty());
      assertTrue(blocked.path("results").isEmpty());
      assertFalse(blocked.path("excluded").get(0).path("best").path("provisional").asBoolean());
      for (JsonNode room : blocked.path("excluded").get(0).path("rooms")) {
        assertEquals("excluded", Json.str(room, "status"));
        assertFalse(room.path("provisional").asBoolean());
      }
      assertFalse(service.detail("hotel", conflict).path("best").path("provisional").asBoolean());
      JsonNode context = service.advisorContext(conflict, Json.str(blocked, "searchId"));
      assertEquals(0, context.path("fitCount").asInt());
      assertFalse(context.path("candidates").get(0).path("provisional").asBoolean());
    }
  }

  @Test
  void unknownChangedExpiredAndEvictedSearchesRequireRefresh() throws Exception {
    MutableClock clock = new MutableClock();
    try (var database = TestDatabases.create(seed(4))) {
      Store store = database.store();
      SearchService service =
          new SearchService(store, new Agents(Agents.Config.from(Map.of())), environment(), clock);
      ObjectNode input = trip();
      String id = Json.str(service.search(input), "searchId");
      assertThrows(IllegalArgumentException.class, () -> service.advisorContext(input, "unknown"));
      assertThrows(
          IllegalArgumentException.class,
          () -> service.advisorContext(input.deepCopy().put("adults", 3), id));
      assertEquals(id, service.advisorContext(input, id).path("searchId").asText());
      clock.now = clock.now.plusSeconds(600);
      assertThrows(IllegalArgumentException.class, () -> service.advisorContext(input, id));
      String first = Json.str(service.search(input), "searchId");
      String last = "";
      for (int index = 0; index < 20; index++) last = Json.str(service.search(input), "searchId");
      assertThrows(IllegalArgumentException.class, () -> service.advisorContext(input, first));
      assertEquals(last, service.advisorContext(input, last).path("searchId").asText());
    }
  }

  private static final class MutableClock extends Clock {
    private Instant now = Instant.parse("2026-10-24T12:00:00Z");

    @Override
    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
      return this;
    }

    @Override
    public Instant instant() {
      return now;
    }
  }
}
