package ru.opodoydet.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class RoomRecommendationsTest {
  private static final Instant NOW = Instant.parse("2026-10-26T12:00:00Z");

  private static ObjectNode room(String id) {
    return Json.obj(
        "id",
        id,
        "name",
        "Category " + id,
        "capacity",
        2,
        "demo",
        false,
        "evidenceStatus",
        "verified",
        "sourceUrl",
        "https://example.org/rooms/" + id,
        "quote",
        "The named category accommodates two guests.",
        "obtainedAt",
        NOW.minusSeconds(60).toString());
  }

  private static ObjectNode criterion(String feature, boolean matches) {
    return Json.obj(
        "feature",
        feature,
        "required",
        false,
        "status",
        matches ? "match" : "mismatch",
        "evidenceStatus",
        matches ? "match" : "mismatch",
        "assumed",
        false);
  }

  private static ObjectNode roomMatch(String id, JsonNode... criteria) {
    return Json.obj(
        "room",
        room(id),
        "criteria",
        List.of(criteria),
        "status",
        "fits",
        "score",
        0,
        "capacityStatus",
        "match",
        "capacityEvidenceStatus",
        "match",
        "capacityAssumed",
        false);
  }

  private static ObjectNode hotelMatch(String id, JsonNode... rooms) {
    return Json.obj(
        "hotel",
        Json.obj("id", id, "name", "Hotel " + id, "route", null),
        "best",
        rooms[0],
        "rooms",
        List.of(rooms));
  }

  private static RoomRecommendations.Selection select(JsonNode... matches) {
    return RoomRecommendations.select(List.of(matches), NOW, "verified-only");
  }

  @Test
  void advantagesFromDifferentRoomsCannotBeCombinedIntoOneRecommendation() {
    ObjectNode family =
        roomMatch("family", criterion("family", true), criterion("courtyard", false));
    ObjectNode courtyard =
        roomMatch("courtyard", criterion("family", false), criterion("courtyard", true));
    var selection = select(hotelMatch("hotel", family, courtyard));
    assertTrue(selection.recommendations().isEmpty());
    assertEquals(2, selection.alternatives().size());
    assertEquals(0, selection.unverifiedHotelCount());
  }

  @Test
  void everyRoomIsInspectedAndSameHotelCategoriesKeepDistinctStableIdentities() {
    ObjectNode partialBest =
        roomMatch("partial", criterion("family", true), criterion("courtyard", false));
    ObjectNode exactA =
        roomMatch("suite-a", criterion("family", true), criterion("courtyard", true));
    ObjectNode exactB =
        roomMatch("suite-b", criterion("family", true), criterion("courtyard", true));
    ObjectNode match = hotelMatch("hotel", partialBest, exactB, exactA);
    String before = Json.write(match);
    var selection = select(match);
    assertEquals(
        List.of("hotel::suite-a", "hotel::suite-b"),
        selection.recommendations().stream().map(item -> Json.str(item, "id")).toList());
    assertEquals(
        "suite-a",
        selection.recommendations().getFirst().path("room").path("room").path("id").asText());
    assertEquals("verified", Json.str(selection.recommendations().getFirst(), "source"));
    assertEquals(1, selection.alternatives().size());
    assertEquals(before, Json.write(match));
    ((ObjectNode) selection.recommendations().getFirst().path("room").path("room"))
        .put("name", "Changed copy");
    assertEquals(
        before,
        Json.write(match),
        "Recommendation projections must not mutate the matching snapshot");
  }

  @Test
  void placeholdersStaleAndUnverifiedCategoriesAreNeverConcreteRecommendations() {
    ObjectNode placeholder = roomMatch("placeholder-unverified");
    placeholder.set("room", Evidence.placeholder("placeholder"));
    ObjectNode stale = roomMatch("old-category");
    ((ObjectNode) stale.path("room")).put("obtainedAt", NOW.minusSeconds(31L * 86400).toString());
    ObjectNode unknown = roomMatch("unknown-category");
    ((ObjectNode) unknown.path("room")).put("evidenceStatus", "unknown");
    var selection =
        select(
            hotelMatch("placeholder", placeholder),
            hotelMatch("old", stale),
            hotelMatch("unknown", unknown));
    assertTrue(selection.recommendations().isEmpty());
    assertTrue(selection.alternatives().isEmpty());
    assertEquals(3, selection.unverifiedHotelCount());
  }

  @Test
  void noPreferencesStillRequiresKnownCapacityAndAConcreteCategory() {
    ObjectNode known = roomMatch("known");
    ObjectNode estimated = roomMatch("estimated");
    ((ObjectNode) estimated.path("room")).putNull("capacity");
    estimated.put("capacityEvidenceStatus", "unknown").put("capacityAssumed", true);
    var selection = select(hotelMatch("hotel", known, estimated));
    assertEquals(
        List.of("hotel::known"),
        selection.recommendations().stream().map(item -> Json.str(item, "id")).toList());
    assertEquals("hotel::estimated", Json.str(selection.alternatives().getFirst(), "id"));
  }

  @Test
  void unknownStaleConflictingOrAssumedMatchesDoNotClaimEveryCriterionIsMet() {
    for (String evidence : List.of("unknown", "stale", "conflict")) {
      ObjectNode criterion = criterion("family", true).put("evidenceStatus", evidence);
      var selection = select(hotelMatch("hotel", roomMatch("room", criterion)));
      assertTrue(selection.recommendations().isEmpty(), evidence);
      assertEquals(1, selection.alternatives().size(), evidence);
    }
    var estimated =
        select(
            hotelMatch("hotel", roomMatch("room", criterion("family", true).put("assumed", true))));
    assertTrue(estimated.recommendations().isEmpty());
    assertEquals(1, estimated.alternatives().size());
  }

  @Test
  void requiredAndCapacityExclusionsCannotReenterThroughAlternatives() {
    ObjectNode required = roomMatch("blocked", criterion("courtyard", false).put("required", true));
    required.put("status", "excluded");
    ObjectNode capacity = roomMatch("too-small");
    capacity
        .put("status", "excluded")
        .put("capacityStatus", "mismatch")
        .put("capacityEvidenceStatus", "mismatch");
    var selection = select(hotelMatch("hotel", required, capacity));
    assertTrue(selection.recommendations().isEmpty());
    assertTrue(selection.alternatives().isEmpty());
    assertEquals(
        0,
        selection.unverifiedHotelCount(),
        "Known but unsuitable categories are not missing categories");
  }

  @Test
  void ownerDeclaredConcreteRoomsCanMatchWithTheirSourceExplicitlyPreserved() {
    ObjectNode declared =
        roomMatch("account-room:listing", criterion("courtyard", true).put("assumed", true));
    ((ObjectNode) declared.path("room")).put("evidenceStatus", "unknown");
    declared.put("capacityAssumed", true);
    ObjectNode match = hotelMatch("account-listing:listing", declared);
    ((ObjectNode) match.path("hotel")).put("accountListingId", "listing");
    var exact = select(match);
    assertEquals(1, exact.recommendations().size());
    assertEquals("owner", Json.str(exact.recommendations().getFirst(), "source"));
    assertTrue(exact.recommendations().getFirst().path("room").path("capacityAssumed").asBoolean());
    ((ObjectNode) declared.path("criteria").get(0)).put("evidenceStatus", "unknown");
    var unknown = select(hotelMatchWithOwner(declared));
    assertTrue(unknown.recommendations().isEmpty());
    assertEquals(1, unknown.alternatives().size());
  }

  private static ObjectNode hotelMatchWithOwner(JsonNode room) {
    ObjectNode match = hotelMatch("account-listing:listing", room);
    ((ObjectNode) match.path("hotel")).put("accountListingId", "listing");
    return match;
  }

  @Test
  void optionalFloorAndWindowRequirementsMustAlsoMatchForAnExactRoom() {
    ObjectNode match = hotelMatchWithOwner(roomMatch("account-room:listing"));
    ObjectNode floor = criterion("floor", true).put("assumed", true);
    ObjectNode direction = criterion("window_direction", false).put("assumed", true);
    match.set("ownerCriteria", Json.array(List.of(floor, direction)));
    assertTrue(select(match).recommendations().isEmpty());
    assertEquals(1, select(match).alternatives().size());
    direction.put("status", "match").put("evidenceStatus", "match");
    match.set("ownerCriteria", Json.array(List.of(floor, direction)));
    assertEquals(1, select(match).recommendations().size());
  }

  @Test
  void fictionalRoomsStayExplicitlyDemoAndAreNotAdmittedByVerifiedPolicy() {
    ObjectNode demo = roomMatch("demo-room");
    ((ObjectNode) demo.path("room")).put("demo", true);
    ObjectNode match = hotelMatch("demo-hotel", demo);
    assertTrue(select(match).recommendations().isEmpty());
    var selection = RoomRecommendations.select(List.of(match), NOW, "demo");
    assertEquals(1, selection.recommendations().size());
    assertEquals("demo", Json.str(selection.recommendations().getFirst(), "source"));
  }
}
