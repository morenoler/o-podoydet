package ru.opodoydet.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class EvidencePeriodTest {
  private static final Instant NOW = Instant.parse("2026-10-27T00:00:00Z");
  private static final ObjectNode TRIP = Json.obj("checkIn", "2026-11-01", "checkOut", "2026-11-04");

  private static ObjectNode fact(String feature, Object value) {
    return Json.obj("id", "test", "hotelId", "hotel", "feature", feature, "value", value,
        "method", "official", "demo", false, "sourceUrl", "https://example.test/access",
        "quote", "Synthetic test statement", "obtainedAt", "2026-10-26T00:00:00Z",
        "expiresAt", "2026-11-30T00:00:00Z");
  }

  private static ObjectNode evaluate(String feature, JsonNode... facts) {
    return Matching.evaluate(List.of(facts), Json.obj("feature", feature, "required", true),
        Json.obj("id", "room"), TRIP, NOW);
  }

  @Test void negativeOnAnyTripDayIncludingArrivalAndDepartureIsNotDiscarded() {
    for (String day : List.of("2026-11-01", "2026-11-02", "2026-11-04")) {
      var negative = fact("step_free_route", false).put("validFrom", day).put("validTo", day);
      assertEquals("mismatch", evaluate("step_free_route", negative).path("status").asText(), day);
      var conflict = evaluate("step_free_route", fact("step_free_route", true), negative);
      assertEquals("conflict", conflict.path("status").asText(), day);
      assertEquals(2, conflict.path("facts").size());
    }
  }

  @Test void negativeOutsideTripAndPartialPositiveDoNotChangeWholeStayEvidence() {
    for (String day : List.of("2026-10-31", "2026-11-05"))
      assertEquals("match", evaluate("step_free_route", fact("step_free_route", true),
          fact("step_free_route", false).put("validFrom", day).put("validTo", day)).path("status").asText());
    assertEquals("unknown", evaluate("step_free_route",
        fact("step_free_route", true).put("validFrom", "2026-11-02").put("validTo", "2026-11-03"))
        .path("status").asText());
  }

  @Test void aTemporaryDistanceAboveConfiguredThresholdIsNegativeEvidence() {
    var detour = fact("beach_walk", 1500).put("validFrom", "2026-11-04").put("validTo", "2026-11-04");
    assertEquals("mismatch", evaluate("beach_walk", detour).path("status").asText());
    assertEquals("conflict", evaluate("beach_walk", fact("beach_walk", 300), detour).path("status").asText());
    assertEquals("unknown", evaluate("beach_walk",
        fact("beach_walk", 500).put("validFrom", "2026-11-02").put("validTo", "2026-11-02"))
        .path("status").asText());
  }

  @Test void staleAndSupersededFailuresCannotBecomeFreshConflicts() {
    var closure = fact("step_free_route", false).put("validFrom", "2026-11-02").put("validTo", "2026-11-02");
    assertEquals("stale", evaluate("step_free_route", closure.deepCopy().put("expiresAt", "2026-10-20T00:00:00Z"))
        .path("status").asText());
    assertEquals("match", evaluate("step_free_route", fact("step_free_route", true), closure.put("supersededBy", "new"))
        .path("status").asText());
  }

  @Test void malformedBoundsCannotTurnIntoUnboundedEvidence() {
    for (var bounds : List.of(List.of("", "2026-11-04"), List.of("2026-11-31", "2026-12-01"),
        List.of("2026-11-03", "2026-11-02")))
      assertEquals("unknown", evaluate("step_free_route", fact("step_free_route", true)
          .put("validFrom", bounds.get(0)).put("validTo", bounds.get(1))).path("status").asText());
  }
}
