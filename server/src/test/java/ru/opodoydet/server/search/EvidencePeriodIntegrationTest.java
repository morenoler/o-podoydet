package ru.opodoydet.server.search;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

class EvidencePeriodIntegrationTest {
  @Test void distanceToleranceCannotEraseAnOppositeThresholdDecision() throws Exception {
    var first = LocalDate.now().plusDays(5);
    var last = first.plusDays(3);
    List<JsonNode> hotels = new ArrayList<>(), facts = new ArrayList<>();
    for (String id : List.of("full", "partial", "within", "above")) {
      hotels.add(Json.obj("id", id, "name", "Synthetic " + id, "rooms", List.of(
          Json.obj("id", id + "-room", "name", "Synthetic room", "capacity", 2, "demo", false,
              "evidenceStatus", "verified", "sourceUrl", "https://example.test/rooms",
              "quote", "Synthetic category", "obtainedAt", Instant.now().minusSeconds(3600).toString()))));
      var primary = Json.obj("id", id + "-primary", "hotelId", id, "feature", "beach_walk",
          "value", id.equals("above") ? 1100 : 900, "method", "official", "demo", false,
          "sourceUrl", "https://example.test/source", "source", "Synthetic fixture", "quote", "Test evidence",
          "obtainedAt", Instant.now().minusSeconds(3600).toString(), "expiresAt", Instant.now().plusSeconds(86400).toString());
      var secondary = primary.deepCopy().put("id", id + "-secondary").put("method", "geo")
          .put("value", id.equals("within") ? 950 : id.equals("above") ? 1200 : 1100);
      if (id.equals("partial")) secondary.put("validFrom", last.toString()).put("validTo", last.toString());
      facts.add(primary);
      facts.add(secondary);
    }
    var seed = Json.obj("region", "Пусан", "evidencePolicy", "verified-only", "hotels", hotels, "facts", facts);
    try (var db = TestDatabases.create(seed)) {
      var search = db.context().getBean(SearchService.class);
      var trip = Json.obj("region", "Пусан", "checkIn", first.toString(), "checkOut", last.toString(),
          "adults", 2, "children", 0, "scenarios", List.of(), "text", "", "admissionMode", "explore",
          "preferences", List.of(Json.obj("feature", "beach_walk", "required", true)));
      for (String id : List.of("full", "partial", "within", "above")) {
        var match = search.detail(id, trip).path("best");
        var criterion = Json.list(match.path("criteria")).stream()
            .filter(c -> "beach_walk".equals(c.path("feature").asText())).findFirst().orElseThrow();
        assertEquals(id.equals("within") ? "match" : id.equals("above") ? "mismatch" : "conflict",
            criterion.path("evidenceStatus").asText(), id);
        assertEquals(2, criterion.path("facts").size(), id);
        assertEquals(id.equals("within") ? "fits" : "excluded", match.path("status").asText(), id);
      }
    }
    assertFalse(CriterionEvaluator.same(Json.MAPPER.valueToTree(1000), Json.MAPPER.valueToTree(1001), "meters", 1000));
    assertTrue(CriterionEvaluator.same(Json.MAPPER.valueToTree(900), Json.MAPPER.valueToTree(950), "meters", 1000));
  }

  @Test void springOverlayRetainsOverlappingFailuresAndExcludesConflictsInExplore() throws Exception {
    var first = LocalDate.now().plusDays(5);
    var last = first.plusDays(3);
    List<JsonNode> hotels = new ArrayList<>(), facts = new ArrayList<>();
    for (String id : List.of("mid", "checkout", "outside", "distance")) {
      hotels.add(Json.obj("id", id, "name", "Synthetic " + id, "rooms", List.of(
          Json.obj("id", id + "-room", "name", "Synthetic room", "capacity", 2, "demo", false,
              "evidenceStatus", "verified", "sourceUrl", "https://example.test/rooms",
              "quote", "Synthetic category", "obtainedAt", Instant.now().minusSeconds(3600).toString()))));
      String feature = id.equals("distance") ? "beach_walk" : "step_free_route";
      var positive = Json.obj("id", id + "-positive", "hotelId", id, "feature", feature,
          "value", id.equals("distance") ? 300 : true, "method", "official", "demo", false,
          "sourceUrl", "https://example.test/source", "source", "Synthetic fixture", "quote", "Test evidence",
          "obtainedAt", Instant.now().minusSeconds(3600).toString(), "expiresAt", Instant.now().plusSeconds(86400).toString());
      var day = id.equals("outside") ? last.plusDays(1) : id.equals("checkout") ? last : first.plusDays(1);
      var negative = positive.deepCopy().put("id", id + "-negative").put("validFrom", day.toString()).put("validTo", day.toString());
      negative.set("value", Json.MAPPER.valueToTree(id.equals("distance") ? 1500 : false));
      facts.add(positive);
      facts.add(negative);
    }
    var seed = Json.obj("region", "Пусан", "evidencePolicy", "verified-only", "hotels", hotels, "facts", facts);
    try (var db = TestDatabases.create(seed)) {
      var search = db.context().getBean(SearchService.class);
      for (String id : List.of("mid", "checkout", "outside", "distance")) {
        String feature = id.equals("distance") ? "beach_walk" : "step_free_route";
        var trip = Json.obj("region", "Пусан", "checkIn", first.toString(), "checkOut", last.toString(),
            "adults", 2, "children", 0, "scenarios", List.of(), "text", "", "admissionMode", "explore",
            "preferences", List.of(Json.obj("feature", feature, "required", true)));
        var result = search.detail(id, trip);
        var criterion = Json.list(result.path("best").path("criteria")).stream()
            .filter(c -> feature.equals(c.path("feature").asText())).findFirst().orElseThrow();
        assertEquals(id.equals("outside") ? "match" : "conflict", criterion.path("evidenceStatus").asText(), id);
        assertEquals(id.equals("outside") ? 1 : 2, criterion.path("facts").size(), id);
        assertEquals(id.equals("outside") ? "fits" : "excluded", result.path("best").path("status").asText(), id);
      }
    }
  }
}
