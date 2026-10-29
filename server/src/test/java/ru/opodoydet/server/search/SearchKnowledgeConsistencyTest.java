package ru.opodoydet.server.search;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.server.knowledge.Fact;
import ru.opodoydet.server.knowledge.FactResolver;
import ru.opodoydet.server.knowledge.Subject;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

class SearchKnowledgeConsistencyTest {
  private static ObjectNode fact(String id, String feature, Object value) {
    return Json.obj("id", id, "hotelId", "hotel", "feature", feature,
        "value", value, "method", "official", "demo", false,
        "sourceUrl", "https://example.test/evidence", "source", "Synthetic source", "quote", "Test statement",
        "obtainedAt", Instant.now().minusSeconds(3600).toString(),
        "expiresAt", Instant.now().plusSeconds(86400).toString());
  }

  private static ObjectNode seed(JsonNode... facts) {
    return Json.obj("region", "Пусан", "evidencePolicy", "verified-only", "hotels", List.of(
        Json.obj("id", "hotel", "name", "Synthetic hotel", "rooms", List.of(
            Json.obj("id", "r1", "name", "Synthetic room", "capacity", 2, "demo", false,
                "evidenceStatus", "verified", "sourceUrl", "https://example.test/rooms", "quote", "Test category",
                "obtainedAt", Instant.now().minusSeconds(3600).toString())))), "facts", List.of(facts));
  }

  private static ObjectNode trip(String feature) {
    LocalDate first = LocalDate.now().plusDays(5);
    return Json.obj("region", "Пусан", "checkIn", first.toString(), "checkOut", first.plusDays(3).toString(),
        "adults", 2, "children", 0, "scenarios", List.of(), "text", "", "admissionMode", "explore",
        "preferences", List.of(Json.obj("feature", feature, "required", true)));
  }

  private static JsonNode criterion(JsonNode match, String feature) {
    return Json.list(match.path("best").path("criteria")).stream()
        .filter(c -> feature.equals(c.path("feature").asText())).findFirst().orElseThrow();
  }

  @Test void missingExplicitExpiryUsesCharacteristicTtlAndCannotHideAConflictingFailure() throws Exception {
    ObjectNode negative = fact("negative", "step_free_route", false);
    negative.remove("expiresAt");
    try (var db = TestDatabases.create(seed(fact("positive", "step_free_route", true), negative))) {
      var resolver = db.context().getBean(FactResolver.class);
      var search = db.context().getBean(SearchService.class);
      var query = trip("step_free_route");
      resolver.resolveAll();
      assertEquals(Fact.Status.conflict, resolver.fact(new Subject("hotel", null, "step_free_route")).orElseThrow().getStatus());
      var response = search.search(query);
      assertTrue(response.path("results").isEmpty(), "Fresh TTL-only failure must exclude even in explore");
      assertEquals("conflict", criterion(response.path("excluded").get(0), "step_free_route").path("evidenceStatus").asText());
      assertEquals("conflict", criterion(search.detail("hotel", query), "step_free_route").path("evidenceStatus").asText());
      assertEquals(0, search.advisorContext(query, response.path("searchId").asText()).path("fitCount").asInt());

      db.jdbc().sql("UPDATE evidence SET obtained_at = now() - interval '10000 days' WHERE id='negative'").update();
      resolver.resolveAll();
      assertEquals(Fact.Status.confirmed, resolver.fact(new Subject("hotel", null, "step_free_route")).orElseThrow().getStatus());
      assertEquals("match", criterion(search.detail("hotel", query), "step_free_route").path("evidenceStatus").asText());
    }
  }

  @Test void toleranceNeverConfirmsMeasurementsOnOppositeSidesOfTheSearchThreshold() throws Exception {
    try (var db = TestDatabases.create(seed(fact("within", "beach_walk", 900), fact("outside", "beach_walk", 1100)))) {
      var resolver = db.context().getBean(FactResolver.class);
      resolver.resolveAll();
      assertEquals(Fact.Status.conflict, resolver.fact(new Subject("hotel", null, "beach_walk")).orElseThrow().getStatus());
      var detail = db.context().getBean(SearchService.class).detail("hotel", trip("beach_walk"));
      assertEquals("conflict", criterion(detail, "beach_walk").path("evidenceStatus").asText());
    }
  }
}
