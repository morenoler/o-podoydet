package ru.opodoydet.server.search;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.server.knowledge.KnowledgeCommands;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.server.support.TestDatabases.Database;
import ru.opodoydet.shared.Json;

/** Regression coverage for both main admission modes and the Spring knowledge overlay. */
class SearchOverlayIntegrationTest {
  private static ObjectNode room(String id) {
    return Json.obj("id", id, "name", id, "capacity", 4, "demo", false,
        "evidenceStatus", "verified", "sourceUrl", "https://example.test/rooms/" + id,
        "quote", "Synthetic test category", "obtainedAt", Instant.now().minusSeconds(3600).toString());
  }
  private static ObjectNode seed(List<JsonNode> facts) {
    return Json.obj("region", "Пусан", "evidencePolicy", "verified-only", "hotels",
        List.of(Json.obj("id", "hotel", "name", "Test Hotel", "lodgingType", "hotel",
            "rooms", List.of(room("r1"), room("r2")))), "facts", facts);
  }
  private static ObjectNode trip(String mode, String... features) {
    var day = LocalDate.now().plusDays(10);
    return Json.obj("region", "Пусан", "checkIn", day.toString(), "checkOut", day.plusDays(3).toString(),
        "adults", 2, "children", 0, "scenarios", List.of(), "text", "", "admissionMode", mode,
        "preferences", java.util.Arrays.stream(features).map(f -> Json.obj("feature", f, "required", true)).toList());
  }
  private static ObjectNode fact(String room, String feature, boolean value) {
    return Json.obj("id", room + feature, "hotelId", "hotel", "roomId", room, "feature", feature,
        "value", value, "method", "official", "demo", false, "sourceUrl", "https://example.test/evidence",
        "source", "Synthetic test source", "quote", "Test statement", "obtainedAt", Instant.now().minusSeconds(3600).toString(),
        "expiresAt", Instant.now().plusSeconds(86400).toString());
  }
  private static void host(Database db, String room, String feature, boolean value, boolean simulated) {
    db.context().getBean(KnowledgeCommands.class).recordHostStatement(new KnowledgeCommands.HostStatement(
        "hotel", room, feature, BooleanNode.valueOf(value), "Controlled test statement", "medium",
        "Test fixture", "Test host", simulated, null));
  }
  private static SearchService search(Database db) { return db.context().getBean(SearchService.class); }
  private static JsonNode criterion(JsonNode match, String feature) {
    return Json.list(match.path("best").path("criteria")).stream()
        .filter(c -> feature.equals(c.path("feature").asText())).findFirst().orElseThrow();
  }
  private static JsonNode only(ObjectNode response) {
    return response.path("results").isEmpty() ? response.path("excluded").get(0) : response.path("results").get(0);
  }

  @Test void absentEvidenceRemainsUnknownAndExploreIsExplicitlyProvisional() throws Exception {
    try (var db = TestDatabases.create(seed(List.of()))) {
      for (String feature : List.of("courtyard", "step_free_access", "family", "beach_walk", "step_free_route")) {
        ObjectNode verified = search(db).search(trip("verified", feature));
        assertTrue(verified.path("results").isEmpty());
        assertEquals("unknown", criterion(only(verified), feature).path("evidenceStatus").asText());
        assertEquals("mismatch", criterion(only(verified), feature).path("status").asText());
        ObjectNode explore = search(db).search(trip("explore", feature));
        assertEquals(1, explore.path("results").size());
        assertTrue(only(explore).path("best").path("provisional").asBoolean());
        assertEquals("unknown", criterion(only(explore), feature).path("evidenceStatus").asText());
      }
    }
  }

  @Test void structuredAmenityCatalogUsesExactRoomScopeAndIntersectingPoolClosures() throws Exception {
    ObjectNode query = trip("explore", "pool");
    ObjectNode pool = fact(null,"pool",true).put("id","pool-open");
    ObjectNode closure = fact(null,"pool",false).put("id","pool-closed")
        .put("validFrom",query.path("checkOut").asText()).put("validTo",query.path("checkOut").asText());
    try (var db = TestDatabases.create(seed(List.of(pool,closure,
        fact("r1","dishwasher",true),fact("r2","washing_machine",true))))) {
      ObjectNode result = search(db).search(query);
      assertTrue(result.path("results").isEmpty());
      assertEquals("conflict",criterion(only(result),"pool").path("evidenceStatus").asText());
      ObjectNode separated = search(db).search(trip("verified","dishwasher","washing_machine"));
      assertTrue(separated.path("results").isEmpty(),"Amenities from two rooms must never combine");
      for (JsonNode roomMatch : only(separated).path("rooms")) {
        assertEquals(1,Json.list(roomMatch.path("criteria")).stream().filter(c -> c.path("evidenceStatus").asText().equals("match")).count());
        assertEquals(1,Json.list(roomMatch.path("criteria")).stream().filter(c -> c.path("evidenceStatus").asText().equals("unknown")).count());
      }
    }
  }

  @Test void hostEvidenceChangesSearchAndAdvisorUsesThatFinalImmutableResult() throws Exception {
    try (var db = TestDatabases.create(seed(List.of()))) {
      ObjectNode trip = trip("verified", "courtyard");
      assertTrue(search(db).search(trip).path("results").isEmpty());
      host(db, "r1", "courtyard", true, false);
      ObjectNode result = search(db).search(trip, "visitor:owner");
      assertEquals(1, result.path("results").size());
      assertEquals("r1", only(result).path("best").path("room").path("id").asText());
      String id = result.path("searchId").asText();
      ObjectNode context = search(db).advisorContext(trip, id, "visitor:owner");
      assertEquals(1, context.path("fitCount").asInt());
      assertEquals("fits", context.path("candidates").get(0).path("status").asText());
      assertTrue(criterion(only(result), "courtyard").path("facts").toString().contains("host"));
      // New evidence and caller mutations cannot rewrite the old search snapshot.
      host(db, "r1", "courtyard", false, false);
      ObjectNode afterContradiction = search(db).search(trip);
      assertTrue(afterContradiction.path("results").isEmpty(), afterContradiction::toString);
      ((ObjectNode) only(result).path("best")).put("status", "excluded");
      assertEquals(context, search(db).advisorContext(trip, id, "visitor:owner"));
      context.put("fitCount", 99);
      assertEquals(1, search(db).advisorContext(trip, id, "visitor:owner").path("fitCount").asInt());
      assertThrows(IllegalArgumentException.class, () -> search(db).advisorContext(trip, id, "visitor:other"));
    }
  }

  @Test void simulatedStatementsCannotPromoteRealHotelEvidence() throws Exception {
    try (var db = TestDatabases.create(seed(List.of()))) {
      assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> host(db, "r1", "courtyard", true, true));
      // Older imports may already contain simulated rows; read-time policy still excludes them.
      host(db, "r1", "courtyard", true, false);
      db.jdbc().sql("UPDATE evidence SET simulated = TRUE, raw = jsonb_set(raw::jsonb, '{simulated}', 'true'::jsonb)::text WHERE method = 'host'").update();
      ObjectNode result = search(db).search(trip("verified", "courtyard"));
      assertTrue(result.path("results").isEmpty());
      assertEquals("unknown", criterion(only(result), "courtyard").path("evidenceStatus").asText());
    }
  }

  @Test void conflictNeverPassesEvenInExploreAndBothVersionsRemainVisible() throws Exception {
    try (var db = TestDatabases.create(seed(List.of(fact("r1", "courtyard", false), fact("r2", "courtyard", false))))) {
      host(db, "r1", "courtyard", true, false);
      ObjectNode result = search(db).search(trip("explore", "courtyard"));
      assertTrue(result.path("results").isEmpty());
      JsonNode r1 = Json.list(only(result).path("rooms")).stream()
          .filter(r -> r.path("room").path("id").asText().equals("r1")).findFirst().orElseThrow();
      assertEquals("conflict", r1.path("criteria").get(0).path("evidenceStatus").asText());
      assertEquals(2, r1.path("criteria").get(0).path("facts").size());
      assertFalse(r1.path("provisional").asBoolean());
    }
  }

  @Test void conditionsFromDifferentRoomsAreNeverCombinedIntoConfirmedMatch() throws Exception {
    try (var db = TestDatabases.create(seed(List.of()))) {
      host(db, "r1", "courtyard", true, false);
      host(db, "r2", "step_free_access", true, false);
      ObjectNode result = search(db).search(trip("verified", "courtyard", "step_free_access"));
      assertTrue(result.path("results").isEmpty());
      ObjectNode exploratory = search(db).search(trip("explore", "courtyard", "step_free_access"));
      assertTrue(only(exploratory).path("best").path("provisional").asBoolean());
      for (JsonNode room : only(exploratory).path("rooms"))
        assertEquals(1, Json.list(room.path("criteria")).stream().filter(c -> c.path("status").asText().equals("match")).count());
    }
  }

  @Test void counterfactualUsesSameCapturedOverlayAsActualSearch() throws Exception {
    try (var db = TestDatabases.create(seed(List.of()))) {
      host(db, "r1", "courtyard", true, false);
      ObjectNode trip = trip("verified", "courtyard", "family");
      ObjectNode result = search(db).search(trip);
      ObjectNode context = search(db).advisorContext(trip, result.path("searchId").asText());
      assertEquals(0, context.path("fitCount").asInt());
      JsonNode scenario = Json.list(context.path("scenarios")).stream()
          .filter(s -> "family".equals(s.path("feature").asText())).findFirst().orElseThrow();
      assertEquals(1, scenario.path("gainedCount").asInt());
      assertEquals("requires_consent", scenario.path("kind").asText());
    }
  }
  @Test void aDemoRegionCannotPromoteSimulatedEvidenceOfAnotherRegion() throws Exception {
    try (var db = TestDatabases.create(seed(List.of()))) {
      host(db, "r1", "courtyard", true, false);
      db.jdbc().sql("UPDATE evidence SET simulated = TRUE WHERE method = 'host'").update();
      db.importSeed(Json.obj("region", "Synthetic region", "evidencePolicy", "demo", "hotels",
          List.of(Json.obj("id", "demo-other", "name", "Synthetic", "demo", true, "rooms",
              List.of(Json.obj("id", "demo-room", "name", "Synthetic", "capacity", 2, "demo", true)))),
          "facts", List.of()));
      var resolver = db.context().getBean(ru.opodoydet.server.knowledge.FactResolver.class);
      resolver.resolveAll();
      var fact = resolver.fact(new ru.opodoydet.server.knowledge.Subject("hotel", "r1", "courtyard")).orElseThrow();
      assertEquals(ru.opodoydet.server.knowledge.Fact.Status.unknown, fact.getStatus());
      assertNull(fact.getValue());
    }
  }

  @Test void personalWishRecognitionStaysConsistentAcrossSearchDetailAndAdvice() throws Exception {
    try (var db = TestDatabases.create(seed(List.of()))) {
      host(db, "r1", "courtyard", true, false);
      for (String text : List.of("Нужны окна во двор", "абракадабра крокозябра")) {
        ObjectNode trip = trip("verified", "courtyard").put("text", text);
        ObjectNode result = search(db).search(trip);
        String expected = text.startsWith("Нужны") ? "recognized" : "unrecognized";
        assertEquals(expected, result.path("personalWishes").path("status").asText());
        assertEquals(result.path("personalWishes"), only(result).path("personalWishes"));
        assertEquals(result.path("personalWishes"), search(db).detail("hotel", trip).path("personalWishes"));
        ObjectNode advice = search(db).advisorContext(trip, result.path("searchId").asText());
        assertEquals(result.path("personalWishes"), advice.path("personalWishes"));
        assertEquals(1, advice.path("fitCount").asInt());
      }
    }
  }

}
