package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.domain.Features;
import ru.opodoydet.domain.Matching;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

/** The five original knowledge criteria have one source across ranking and counterfactuals. */
class SinglePassKnowledgeTest {
  private static final List<String> FEATURES = List.of("beach_walk", "step_free_route", "courtyard", "step_free_access", "family");
  @TempDir Path directory;

  private static ObjectNode room(String id) {
    return Json.obj("id", id, "name", id, "capacity", 4, "demo", false,
        "evidenceStatus", "verified", "scope", "room_category", "sourceUrl", "https://test.example/rooms",
        "quote", "Synthetic test category", "obtainedAt", Instant.now().minusSeconds(60).toString());
  }

  private static ObjectNode trip() {
    return Json.obj("region", "Пусан", "checkIn", "2027-06-10", "checkOut", "2027-06-17",
        "adults", 2, "children", 0, "scenarios", List.of(), "text", "",
        "preferences", FEATURES.stream().map(f -> Json.obj("feature", f, "required", true)).toList());
  }

  @Test void searchCounterfactualsAndDetailEvaluateEachKnowledgeSubjectOncePerRequest() throws Exception {
    var seed = Json.obj("region", "Пусан", "hotels", List.of(Json.obj("id", "hotel", "name", "Test",
        "rooms", List.of(room("r1"), room("r2")))), "facts", List.of());
    Map<String, Integer> calls = new HashMap<>();
    SearchProjection source = (trip, now) -> (hotel, room, feature) -> {
      if (!FEATURES.contains(feature)) return null;
      String key = feature + ":" + (Features.get(feature).scope().equals("hotel") ? "hotel" : room.path("id").asText());
      calls.merge(key, 1, Integer::sum);
      return Json.obj("feature", feature, "required", false, "status", "unknown", "facts", List.of(), "explanation", "Missing test evidence");
    };
    try (var db = TestDatabases.create(seed)) {
      var service = new SearchService(db.store(), new Agents(Agents.Config.from(Map.of())),
          new Environment(directory.resolve("area.json"), directory.resolve("noise.json")), Clock.systemUTC(), null, source);
      var query = trip();
      var result = service.search(query);
      var advice = service.advisorContext(query, result.path("searchId").asText());
      assertFalse(advice.path("scenarios").isEmpty(), "Counterfactual planner must exercise repeated ranking");
      assertEquals(8, calls.size(), "Two hotel criteria plus three criteria in each of two rooms");
      assertTrue(calls.values().stream().allMatch(count -> count == 1), calls.toString());
      JsonNode searched = result.path("excluded").get(0).path("best");
      var detail = service.detail("hotel", query);
      assertTrue(calls.values().stream().allMatch(count -> count == 2), calls.toString());
      assertEquals(searched.path("room"), detail.path("best").path("room"));
      assertEquals(searched.path("score"), detail.path("best").path("score"));
      assertEquals(searched.path("status"), detail.path("best").path("status"));
      assertEquals(Features.ids().size(), detail.path("best").path("criteria").size());
      assertEquals(advice, service.advisorContext(query, result.path("searchId").asText()));
    }
  }

  @Test void cachedEvidenceIsDetachedAndRequiredFlagIsAppliedOnlyByRanking() {
    var calls = new AtomicInteger();
    var raw = Json.obj("feature", "courtyard", "status", "match", "facts", List.of(Json.obj("id", "source")), "explanation", "Test");
    SearchProjection.Snapshot source = SearchProjection.memoized((hotel, room, feature) -> {
      calls.incrementAndGet();
      return raw;
    });
    var hotel = Json.obj("id", "hotel");
    var room = room("r1");
    var mandatory = Matching.criterion(source, hotel, List.of(), Json.obj("feature", "courtyard", "required", true),
        room, trip(), Instant.now(), Map.of(), "verified-only");
    mandatory.put("status", "mismatch");
    ((ObjectNode) mandatory.path("facts").get(0)).put("id", "corrupted");
    raw.put("status", "conflict");
    var optional = Matching.criterion(source, hotel, List.of(), Json.obj("feature", "courtyard", "required", false),
        room, trip(), Instant.now(), Map.of(), "verified-only");
    assertEquals(1, calls.get());
    assertEquals("match", optional.path("status").asText());
    assertEquals("source", optional.path("facts").get(0).path("id").asText());
    assertFalse(optional.path("required").asBoolean());
    assertTrue(mandatory.path("required").asBoolean());
    assertFalse(raw.has("required"));
    source.evaluateCriterion(hotel, room.deepCopy().put("evidenceStatus", "unknown"), "courtyard");
    assertEquals(2, calls.get(), "Changed room provenance must not reuse a verified-room decision");
  }
}
