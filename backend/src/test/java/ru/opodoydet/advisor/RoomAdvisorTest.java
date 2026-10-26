package ru.opodoydet.advisor;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import ru.opodoydet.application.Agents;
import ru.opodoydet.application.SearchExtension;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

class RoomAdvisorTest {
  private static final Instant NOW = Instant.parse("2026-10-24T12:00:00Z");

  private static ObjectNode room(String id) {
    return Json.obj("id", id, "name", "Номер " + id, "capacity", 2, "demo", true);
  }

  private static ObjectNode hotel(JsonNode... rooms) {
    return Json.obj(
        "id", "hotel", "name", "Отель", "lodgingType", "hotel", "rooms", List.of(rooms));
  }

  private static JsonNode preference(String feature, boolean required) {
    return Json.obj("feature", feature, "required", required);
  }

  private static ObjectNode trip(JsonNode... preferences) {
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
        List.of(preferences),
        "text",
        "");
  }

  private static JsonNode fact(String room, String feature, boolean value) {
    return Json.obj(
        "hotelId",
        "hotel",
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

  private static ObjectNode plan(
      ObjectNode hotel, ObjectNode trip, List<JsonNode> facts, String policy) {
    return AdvisorPlanner.planRooms(
        trip,
        Agents.parseRules("", Json.list(trip.path("preferences"))),
        List.of(hotel),
        facts,
        NOW,
        Map.of(),
        policy,
        SearchExtension.EMPTY);
  }

  @Test
  void recommendsEveryConcreteRoomMeetingAllConditionsAndExcludesOptionalMismatches() {
    ObjectNode context =
        plan(
            hotel(room("a"), room("b"), room("c")),
            trip(preference("courtyard", true), preference("step_free_access", false)),
            List.of(
                fact("a", "courtyard", true),
                fact("a", "step_free_access", false),
                fact("b", "courtyard", true),
                fact("b", "step_free_access", true),
                fact("c", "courtyard", true),
                fact("c", "step_free_access", true)),
            "demo");
    assertEquals("rooms", Json.str(context, "matchingScope"));
    assertEquals(2, context.path("fitCount").asInt());
    assertEquals(
        List.of("hotel::b", "hotel::c"),
        Json.list(context.path("candidates")).stream()
            .filter(c -> Json.str(c, "status").equals("fits"))
            .map(c -> Json.str(c, "id"))
            .toList());
    assertEquals("excluded", context.path("candidates").get(2).path("status").asText());
    assertTrue(context.path("scenarios").isEmpty());
  }

  @Test
  void counterfactualRemovesOnePreferenceOnlyAndNeverCombinesDifferentRooms() {
    ObjectNode request = trip(preference("courtyard", true), preference("step_free_access", false));
    ObjectNode original = (ObjectNode) request.deepCopy();
    ObjectNode context =
        plan(
            hotel(room("a"), room("b")),
            request,
            List.of(
                fact("a", "courtyard", true),
                fact("a", "step_free_access", false),
                fact("b", "courtyard", false),
                fact("b", "step_free_access", true)),
            "demo");
    assertEquals(0, context.path("fitCount").asInt());
    assertEquals(2, context.path("candidates").size());
    assertTrue(
        Json.list(context.path("candidates")).stream()
            .allMatch(c -> Json.str(c, "status").equals("excluded")));
    assertEquals(2, context.path("scenarios").size());
    for (JsonNode scenario : context.path("scenarios")) {
      assertEquals("requires_consent", Json.str(scenario, "kind"));
      assertTrue(Json.str(scenario, "label").startsWith("Если убрать пожелание:"));
      assertEquals(1, scenario.path("gainedCount").asInt());
    }
    assertEquals(original, request);
  }

  @Test
  void missingCategoryIsNeverAnAdvisorCandidateEvenWithoutPreferences() {
    ObjectNode unknown = room("a").put("demo", false).put("evidenceStatus", "unknown");
    ObjectNode context = plan(hotel(unknown), trip(), List.of(), "verified-only");
    assertEquals(0, context.path("fitCount").asInt());
    assertTrue(context.path("candidates").isEmpty());
  }

  @Test
  void estimatedCapacityAndFeaturesCannotBecomeExactRecommendations() {
    ObjectNode unknownCapacity = room("a");
    unknownCapacity.remove("capacity");
    ObjectNode capacity = plan(hotel(unknownCapacity), trip(), List.of(), "demo");
    assertEquals(0, capacity.path("fitCount").asInt());
    assertEquals("excluded", capacity.path("candidates").get(0).path("status").asText());

    ObjectNode feature =
        plan(hotel(room("a")), trip(preference("family", false)), List.of(), "demo");
    assertEquals(0, feature.path("fitCount").asInt());
    assertEquals("excluded", feature.path("candidates").get(0).path("status").asText());
  }
}
