package ru.opodoydet.advisor;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import ru.opodoydet.application.Agents;
import ru.opodoydet.application.Environment;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

class AdvisorTest {
  private static final Instant NOW = Instant.parse("2026-10-24T12:00:00Z");

  private static ObjectNode room(String id, int capacity) {
    return Json.obj("id", id, "name", id, "capacity", capacity, "demo", true);
  }

  private static ObjectNode hotel() {
    return Json.obj(
        "id",
        "h",
        "name",
        "Hotel",
        "lodgingType",
        "hotel",
        "rooms",
        List.of(room("room", 4)),
        "route",
        Json.obj("meters", 500));
  }

  private static ObjectNode trip(List<JsonNode> preferences) {
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
        preferences,
        "text",
        "");
  }

  private static JsonNode preference(String feature, boolean required) {
    return Json.obj("feature", feature, "required", required);
  }

  private static JsonNode fact(String room, String feature, boolean value) {
    return Json.obj(
        "hotelId",
        "h",
        "roomId",
        room,
        "feature",
        feature,
        "value",
        value,
        "expiresAt",
        "2099-01-01T00:00:00Z",
        "demo",
        true);
  }

  private static ObjectNode plan(ObjectNode hotel, ObjectNode trip, List<JsonNode> facts) {
    return AdvisorPlanner.plan(
        trip,
        Agents.parseRules(Json.str(trip, "text"), Json.list(trip.path("preferences"))),
        List.of(hotel),
        facts,
        NOW,
        Map.of(),
        "demo");
  }

  private static ObjectNode seed() {
    return Json.obj(
        "region",
        "Пусан",
        "evidencePolicy",
        "demo",
        "hotels",
        List.of(hotel()),
        "facts",
        List.of(),
        "map",
        List.of());
  }

  private static SearchService search(Store store) {
    return new SearchService(
        store,
        new Agents(Agents.Config.from(Map.of())),
        new Environment(Path.of("missing-area"), Path.of("missing-noise")));
  }

  private static ObjectNode report(JsonNode context) {
    boolean conflict = !context.path("conflicts").isEmpty();
    boolean fits = !conflict && context.path("fitCount").asInt() > 0;
    return Json.obj(
        "outcome",
        conflict ? "clarification_needed" : fits ? "shortlist" : "no_matches",
        "summary",
        "Проверка",
        "candidateIds",
        fits ? List.of(Json.str(context.path("candidates").get(0), "id")) : List.of(),
        "scenarioIds",
        List.of(),
        "questionId",
        null,
        "cautions",
        List.of(),
        "nextSteps",
        List.of());
  }

  @Test
  void counterfactualRequiresConsentAndDoesNotChangeOriginalEligibilityOrCapacity() {
    ObjectNode trip = trip(List.of(preference("courtyard", true)));
    ObjectNode context = plan(hotel(), trip, List.of(fact("room", "courtyard", false)));
    assertEquals(0, context.path("fitCount").asInt());
    assertEquals("excluded", context.path("candidates").get(0).path("status").asText());
    assertEquals("requires_consent", context.path("scenarios").get(0).path("kind").asText());
    assertEquals(1, context.path("scenarios").get(0).path("gainedCount").asInt());
    assertTrue(trip.path("preferences").get(0).path("required").asBoolean());
    ObjectNode tooSmall = hotel();
    tooSmall.set("rooms", Json.array(List.of(room("room", 1))));
    ObjectNode impossible = plan(tooSmall, trip, List.of(fact("room", "courtyard", false)));
    assertEquals(0, impossible.path("scenarios").get(0).path("gainedCount").asInt());
  }

  @Test
  void cannotCombineBenefitsFromDifferentRooms() {
    ObjectNode hotel = hotel();
    hotel.set("rooms", Json.array(List.of(room("a", 4), room("b", 4))));
    ObjectNode context =
        plan(
            hotel,
            trip(List.of(preference("courtyard", true), preference("step_free_access", true))),
            List.of(
                fact("a", "courtyard", true),
                fact("a", "step_free_access", false),
                fact("b", "courtyard", false),
                fact("b", "step_free_access", true)));
    assertEquals(0, context.path("fitCount").asInt());
    assertEquals(1, context.path("scenarios").get(0).path("gainedCount").asInt());
    assertEquals(1, context.path("scenarios").get(1).path("gainedCount").asInt());
    assertTrue(
        Json.list(context.path("candidates")).stream()
            .allMatch(c -> Json.str(c, "status").equals("excluded")));
  }

  @Test
  void optionalScenarioDoesNotRelaxRequiredConditionsAndConflictsBlockAdvice() {
    ObjectNode trip = trip(List.of(preference("courtyard", false)));
    ObjectNode context = plan(hotel(), trip, List.of(fact("room", "courtyard", false)));
    assertEquals(1, context.path("fitCount").asInt());
    assertEquals("optional_priority", context.path("scenarios").get(0).path("kind").asText());
    assertEquals(0, context.path("scenarios").get(0).path("gainedCount").asInt());
    trip.put("text", "не нужен номер во двор");
    ObjectNode conflict = plan(hotel(), trip, List.of());
    assertFalse(conflict.path("conflicts").isEmpty());
    assertEquals(0, conflict.path("fitCount").asInt());
    assertTrue(conflict.path("scenarios").isEmpty());
    assertEquals("resolve-conflict", conflict.path("questions").get(0).path("id").asText());
  }

  @Test
  void criticRejectsInventedRecommendationsAndRebuildsOmittedCautions() {
    ObjectNode unknownCapacity = hotel();
    ((ObjectNode) unknownCapacity.path("rooms").get(0)).putNull("capacity");
    ObjectNode context = plan(unknownCapacity, trip(List.of()), List.of());
    ObjectNode checked = AdvisorService.checkedReport(context, report(context));
    assertEquals(1, checked.path("cautions").size());
    assertEquals(
        "h::room::capacity", checked.path("cautions").get(0).path("evidenceIds").get(0).asText());
    ObjectNode bad = report(context);
    bad.set("candidateIds", Json.array(List.of("invented")));
    assertThrows(IllegalArgumentException.class, () -> AdvisorService.checkedReport(context, bad));
    ObjectNode noMatches =
        plan(
            hotel(),
            trip(List.of(preference("courtyard", true))),
            List.of(fact("room", "courtyard", false)));
    ObjectNode hidden = report(noMatches);
    hidden.put("outcome", "shortlist").set("candidateIds", Json.array(List.of("h::room")));
    assertThrows(
        IllegalArgumentException.class, () -> AdvisorService.checkedReport(noMatches, hidden));
  }

  @Test
  void serverContextRetainsSearchConflictWithoutReinterpreting() throws Exception {
    try (Store store = new Store(":memory:", seed())) {
      ObjectNode input =
          trip(List.of(preference("courtyard", true))).put("text", "не нужен номер во двор");
      SearchService search = search(store);
      String searchId = Json.str(search.search(input), "searchId");
      ObjectNode result =
          assertTimeoutPreemptively(
              Duration.ofSeconds(2), () -> search.advisorContext(input, searchId));
      assertFalse(result.path("conflicts").isEmpty());
      assertEquals(input, result.path("trip"));
      assertEquals(0, result.path("fitCount").asInt());
    }
  }

  @Test
  void noMatchesCanExplainExcludedAlternativesWithoutRecommendingThem() {
    ObjectNode context =
        plan(
            hotel(),
            trip(List.of(preference("courtyard", true))),
            List.of(fact("room", "courtyard", false)));
    ObjectNode result = report(context);
    result.set("candidateIds", Json.array(List.of("h::room")));
    ObjectNode checked = AdvisorService.checkedReport(context, result);
    assertEquals("no_matches", checked.path("outcome").asText());
    assertEquals(
        "h::room::courtyard", checked.path("cautions").get(0).path("evidenceIds").get(0).asText());
    assertTrue(
        context.path("questions").isEmpty(),
        "Known negative evidence needs no redundant source question");
    assertEquals("excluded", context.path("candidates").get(0).path("status").asText());
  }

  @Test
  void optionalTradeoffsRemainVisibleAndUnsafeSourceLinksAreDropped() {
    ObjectNode hotel = hotel();
    ((ObjectNode) hotel.path("rooms").get(0)).put("sourceUrl", "javascript:alert(1)");
    ObjectNode context =
        plan(
            hotel,
            trip(List.of(preference("courtyard", false))),
            List.of(fact("room", "courtyard", false)));
    ObjectNode checked = AdvisorService.checkedReport(context, report(context));
    assertEquals(
        "h::room::courtyard", checked.path("cautions").get(0).path("evidenceIds").get(0).asText());
    assertTrue(context.path("candidates").get(0).path("criteria").get(0).path("sources").isEmpty());
  }

  @Test
  void duplicateReusedAndCancelledWorkerCannotPublishLateResult() throws Exception {
    CountDownLatch entered = new CountDownLatch(1), exited = new CountDownLatch(1);
    AtomicInteger calls = new AtomicInteger();
    SearchService searchService;
    try (Store store = new Store(":memory:", seed());
        AdvisorService service =
            new AdvisorService(
                store,
                searchService = search(store),
                Map.of("ADVISOR_LOCAL_MODEL", "test-local"),
                (context, mode, progress) -> {
                  calls.incrementAndGet();
                  progress.accept(
                      Json.obj(
                          "modelCalls",
                          1,
                          "execution",
                          "rules",
                          "diagnostics",
                          List.of(
                              Json.obj(
                                  "id",
                                  "call-selector",
                                  "agent",
                                  "selector",
                                  "status",
                                  "running",
                                  "startedAt",
                                  Instant.now().toString(),
                                  "model",
                                  "test-local",
                                  "input",
                                  Json.obj("test", true)))));
                  entered.countDown();
                  try {
                    new CountDownLatch(1).await();
                  } catch (InterruptedException ignored) {
                    /* deliberately return after cancellation */
                  } finally {
                    exited.countDown();
                  }
                  return Json.obj("report", report(context));
                })) {
      ObjectNode trip = trip(List.of());
      ObjectNode request =
          Json.obj(
              "trip",
              trip,
              "mode",
              "local",
              "searchId",
              Json.str(searchService.search(trip), "searchId"));
      String id = Json.str(service.start(request), "id");
      assertTrue(entered.await(2, TimeUnit.SECONDS));
      assertEquals(id, Json.str(service.start(request), "id"));
      assertThrows(
          IllegalArgumentException.class,
          () -> service.start(request.deepCopy().put("mode", "remote")));
      service.cancel(id);
      assertTrue(exited.await(2, TimeUnit.SECONDS));
      assertEquals("cancelled", Json.str(service.get(id), "status"));
      assertTrue(service.get(id).path("report").isNull());
      assertEquals("failed", service.get(id).path("diagnostics").get(0).path("status").asText());
      assertTrue(service.get(id).path("diagnostics").get(0).has("finishedAt"));
      assertEquals(1, calls.get());
    }
  }
}
