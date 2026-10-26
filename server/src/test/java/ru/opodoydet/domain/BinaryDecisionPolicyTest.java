package ru.opodoydet.domain;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class BinaryDecisionPolicyTest {
  private static final Instant NOW = Instant.parse("2026-10-25T09:00:00Z");
  private ObjectNode raw(String feature) {
    return Json.obj("feature", feature, "status", "unknown", "required", true,
        "facts", List.of(Json.obj("quote", "Original evidence")), "explanation", "Original uncertainty");
  }
  private ObjectNode hotel() {
    return Json.obj("lodgingType", "hotel", "route", null, "noise", List.of());
  }
  private ObjectNode source() {
    return Json.obj("sourceUrl", "https://hotel.example/rooms/family", "obtainedAt",
        "2026-10-24T12:00:00Z", "quote", "Official category occupancy fixture");
  }
  private ObjectNode room() {
    return source().put("id", "family").put("name", "Family").putNull("capacity")
        .put("demo", false).put("evidenceStatus", "verified");
  }
  private ObjectNode trip() { return Json.obj("adults", 2, "children", 2); }
  private ObjectNode rule() { return source().put("maxGuests", 4).put("minChildren", 1); }
  private ObjectNode withRule(JsonNode rule) {
    ObjectNode room = room();
    room.set("occupancyRules", Json.array(List.of(rule)));
    return room;
  }

  @Test void allUnresolvedFeaturesRequireClarificationAndPreserveRawEvidence() {
    for (String feature : List.of("family", "beach_walk", "step_free_route", "courtyard",
        "step_free_access", "area_safety", "clean_air", "low_noise")) {
      for (String status : List.of("unknown", "stale", "conflict", "match", "mismatch")) {
        ObjectNode raw = raw(feature).put("status", status).put("currentAirUsAqi", 20)
            .put("nearestRoadMeters", 500).put("assessmentBasis", "historical").put("riskLevel", "low");
        JsonNode before = raw.deepCopy(), decided = BinaryDecisionPolicy.decide(raw, hotel());
        assertEquals(before, raw);
        assertEquals(status, Json.str(decided, "evidenceStatus"));
        assertEquals(raw.path("facts"), decided.path("facts"));
        assertEquals("Original uncertainty", Json.str(decided, "sourceExplanation"));
        boolean known = status.equals("match") || status.equals("mismatch");
        assertEquals(!known, decided.path("assumed").asBoolean());
        assertEquals(status.equals("match") ? "match" : "mismatch", Json.str(decided, "status"));
        if (!known) assertTrue(Json.str(decided, "explanation").contains("Требуется уточнение"));
        else assertEquals(raw.path("explanation"), decided.path("explanation"));
      }
    }
  }

  @Test void shortRoutesMissingStepsAndHotelTypeNeverReplaceMissingEvidence() {
    ObjectNode hotel = hotel();
    hotel.set("route", Json.obj("meters", 100, "steps", 0, "noStepsAlternative", Json.obj("meters", 110)));
    for (String status : List.of("unknown", "stale", "conflict"))
      for (String feature : List.of("beach_walk", "step_free_route"))
        assertEquals("mismatch", Json.str(BinaryDecisionPolicy.decide(raw(feature).put("status", status), hotel), "status"));
    for (String type : List.of("hotel", "guest_house", "apartment", "hostel", "motel", ""))
      assertEquals("mismatch", Json.str(BinaryDecisionPolicy.decide(raw("family"), hotel().put("lodgingType", type)), "status"));
    assertTrue(Json.str(BinaryDecisionPolicy.decide(raw("area_safety"), hotel()), "explanation").contains("не вывод об опасности"));
  }

  @Test void historicalNoiseDistanceAndCurrentAirCannotConfirmFutureTripConditions() {
    for (String risk : List.of("low", "moderate", "high"))
      for (int distance : List.of(0, 150, 151, 1000)) {
        JsonNode decision = BinaryDecisionPolicy.decide(raw("low_noise").put("assessmentBasis", "historical")
            .put("riskLevel", risk).put("nearestRoadMeters", distance), hotel());
        assertEquals("mismatch", Json.str(decision, "status"));
        assertEquals("unknown", Json.str(decision, "evidenceStatus"));
        assertEquals(risk, Json.str(decision, "riskLevel"));
      }
    for (int aqi : List.of(0, 20, 50, 51)) {
      JsonNode decision = BinaryDecisionPolicy.decide(raw("clean_air").put("currentAirUsAqi", aqi)
          .put("currentAirTime", NOW.toString()), hotel());
      assertEquals("mismatch", Json.str(decision, "status"));
      assertEquals("unknown", Json.str(decision, "evidenceStatus"));
      assertEquals(aqi, decision.path("currentAirUsAqi").asInt());
    }
  }

  @Test void unknownCapacityNeverInventsPlacesOrPretendsConfirmedInsufficiency() {
    for (String type : List.of("hotel", "apartment"))
      for (int children : List.of(0, 1, 2)) {
        JsonNode result = BinaryDecisionPolicy.capacity(hotel().put("lodgingType", type), room(), trip().put("children", children), NOW);
        assertEquals("mismatch", Json.str(result, "capacityStatus"));
        assertEquals("unknown", Json.str(result, "capacityEvidenceStatus"));
        assertFalse(result.has("estimatedCapacity"));
        assertTrue(Json.str(result, "capacityExplanation").contains("не установленный недостаток мест"));
      }
    JsonNode confirmed = BinaryDecisionPolicy.capacity(hotel(), room().put("capacity", 2), trip(), NOW);
    assertEquals("mismatch", Json.str(confirmed, "capacityEvidenceStatus"));
    assertFalse(confirmed.path("capacityAssumed").asBoolean());
    assertEquals("unknown", Json.str(BinaryDecisionPolicy.capacity(hotel(),
        room().put("capacity", 2).put("capacityMayVary", true), trip(), NOW), "capacityEvidenceStatus"));
    assertEquals("match", Json.str(BinaryDecisionPolicy.capacity(hotel(), room().put("capacity", 4), trip(), NOW), "capacityStatus"));
  }

  @Test void sourcedApplicableRuleCanAdmitLargerPartyWithoutChangingBaseCapacity() {
    ObjectNode described = withRule(rule()).put("capacity", 3);
    JsonNode before = described.deepCopy();
    JsonNode decision = BinaryDecisionPolicy.capacity(hotel(), described, trip(), NOW);
    assertEquals("match", Json.str(decision, "capacityStatus"));
    assertFalse(decision.path("capacityAssumed").asBoolean());
    assertEquals(rule(), decision.path("capacityRule"));
    assertEquals(before, described);
    assertEquals("mismatch", Json.str(BinaryDecisionPolicy.capacity(hotel(), described,
        trip().put("adults", 4).put("children", 0), NOW), "capacityStatus"));
    assertEquals("mismatch", Json.str(BinaryDecisionPolicy.capacity(hotel(), described,
        trip().put("children", 3), NOW), "capacityStatus"));
  }

  @Test void unknownChildAgesAndInvalidStaleOrUnscopedRulesDoNotAdmit() {
    for (JsonNode invalid : List.of(
        rule().put("childMaxAge", 12), rule().put("maxAdults", 1), rule().put("maxChildren", 1),
        rule().put("quote", ""), rule().put("sourceUrl", "file:///local"),
        rule().put("obtainedAt", "2026-09-24T12:00:00Z"), rule().put("obtainedAt", "2026-10-26T12:00:00Z"),
        rule().put("minChildren", 5))) {
      JsonNode decision = BinaryDecisionPolicy.capacity(hotel(), withRule(invalid), trip(), NOW);
      assertEquals("mismatch", Json.str(decision, "capacityStatus"));
      assertEquals("unknown", Json.str(decision, "capacityEvidenceStatus"));
    }
    assertTrue(Json.str(BinaryDecisionPolicy.capacity(hotel(), withRule(rule().put("childMaxAge", 12)),
        trip(), NOW), "capacityExplanation").contains("возраст"));
    assertEquals("mismatch", Json.str(BinaryDecisionPolicy.capacity(hotel(),
        withRule(rule()).put("evidenceStatus", "unknown"), trip(), NOW), "capacityStatus"));
    assertEquals("match", Json.str(BinaryDecisionPolicy.capacity(hotel(),
        withRule(rule().put("minChildren", 0).put("childMaxAge", 12)), trip().put("children", 0), NOW), "capacityStatus"));
  }
}
