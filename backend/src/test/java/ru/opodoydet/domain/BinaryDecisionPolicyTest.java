package ru.opodoydet.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class BinaryDecisionPolicyTest {
  private ObjectNode raw(String feature) {
    return Json.obj(
        "feature",
        feature,
        "status",
        "unknown",
        "required",
        true,
        "facts",
        List.of(Json.obj("quote", "Original evidence")),
        "explanation",
        "Original uncertainty");
  }

  private ObjectNode hotel() {
    return Json.obj("lodgingType", "hotel", "route", null, "noise", List.of());
  }

  @Test
  void decisionsPreserveRawEvidenceAndDoNotMutateSources() {
    for (String status : List.of("unknown", "stale", "conflict", "match", "mismatch")) {
      ObjectNode raw = raw("courtyard").put("status", status);
      JsonNode before = raw.deepCopy(), decided = BinaryDecisionPolicy.decide(raw, hotel());
      assertEquals(before, raw);
      assertEquals(status, Json.str(decided, "evidenceStatus"));
      assertEquals(raw.path("facts"), decided.path("facts"));
      assertEquals("Original uncertainty", Json.str(decided, "sourceExplanation"));
      boolean known = status.equals("match") || status.equals("mismatch");
      assertEquals(!known, decided.path("assumed").asBoolean());
      assertEquals(known ? "evidence" : "estimate", Json.str(decided, "decisionBasis"));
      assertEquals(status.equals("match") ? "match" : "mismatch", Json.str(decided, "status"));
    }
  }

  @Test
  void routeAndStepRulesUseOnlyAvailableMapFields() {
    ObjectNode hotel = hotel();
    assertEquals(
        "mismatch", Json.str(BinaryDecisionPolicy.decide(raw("beach_walk"), hotel), "status"));
    hotel.set("route", Json.obj("meters", 1000, "steps", 0));
    assertEquals(
        "match", Json.str(BinaryDecisionPolicy.decide(raw("beach_walk"), hotel), "status"));
    assertEquals(
        "match", Json.str(BinaryDecisionPolicy.decide(raw("step_free_route"), hotel), "status"));
    hotel.set("route", Json.obj("meters", 1001, "steps", 3));
    assertEquals(
        "mismatch", Json.str(BinaryDecisionPolicy.decide(raw("beach_walk"), hotel), "status"));
    assertEquals(
        "mismatch", Json.str(BinaryDecisionPolicy.decide(raw("step_free_route"), hotel), "status"));
    ((ObjectNode) hotel.path("route")).set("noStepsAlternative", Json.obj("meters", 1200));
    assertEquals(
        "match", Json.str(BinaryDecisionPolicy.decide(raw("step_free_route"), hotel), "status"));
  }

  @Test
  void familyFallbackDoesNotInventRoomFactsAndSafetyDoesNotLabelAreaDangerous() {
    for (String type : List.of("hotel", "guest_house", "apartment", "hostel", "motel", "")) {
      JsonNode decision =
          BinaryDecisionPolicy.decide(raw("family"), hotel().put("lodgingType", type));
      assertEquals(
          List.of("hotel", "guest_house", "apartment").contains(type) ? "match" : "mismatch",
          Json.str(decision, "status"));
      assertTrue(decision.path("assumed").asBoolean());
    }
    assertTrue(
        Json.str(BinaryDecisionPolicy.decide(raw("area_safety"), hotel()), "explanation")
            .contains("не вывод об опасности"));
    for (String feature : List.of("courtyard", "step_free_access", "clean_air"))
      assertEquals(
          "mismatch", Json.str(BinaryDecisionPolicy.decide(raw(feature), hotel()), "status"));
  }

  @Test
  void noiseUsesHistoricalRiskBeforeRoadProximityAndNoRoadDoesNotPass() {
    ObjectNode hotel = hotel();
    hotel.set("noise", Json.array(List.of(Json.obj("kind", "road", "meters", 151))));
    assertEquals("match", Json.str(BinaryDecisionPolicy.decide(raw("low_noise"), hotel), "status"));
    for (String risk : List.of("low", "moderate", "high")) {
      JsonNode decision =
          BinaryDecisionPolicy.decide(
              raw("low_noise").put("assessmentBasis", "historical").put("riskLevel", risk), hotel);
      assertEquals(risk.equals("low") ? "match" : "mismatch", Json.str(decision, "status"));
    }
    hotel.set("noise", Json.array(List.of(Json.obj("kind", "road", "meters", 150))));
    assertEquals(
        "mismatch", Json.str(BinaryDecisionPolicy.decide(raw("low_noise"), hotel), "status"));
    assertEquals(
        "mismatch", Json.str(BinaryDecisionPolicy.decide(raw("low_noise"), hotel()), "status"));
  }

  @Test
  void unknownCapacityUsesExplicitEstimateAndConditionalIncreaseIsNotPromised() {
    JsonNode trip = Json.obj("adults", 2, "children", 1), room = Json.obj("capacity", null);
    JsonNode standard = BinaryDecisionPolicy.capacity(hotel(), room, trip);
    assertEquals("mismatch", Json.str(standard, "capacityStatus"));
    assertEquals(2, standard.path("estimatedCapacity").asInt());
    JsonNode apartment =
        BinaryDecisionPolicy.capacity(hotel().put("lodgingType", "apartment"), room, trip);
    assertEquals("match", Json.str(apartment, "capacityStatus"));
    assertEquals(4, apartment.path("estimatedCapacity").asInt());
    JsonNode conditional =
        BinaryDecisionPolicy.capacity(
            hotel(), Json.obj("capacity", 2, "capacityMayVary", true), trip);
    assertEquals("mismatch", Json.str(conditional, "capacityStatus"));
    assertTrue(conditional.path("capacityAssumed").asBoolean());
  }
}
