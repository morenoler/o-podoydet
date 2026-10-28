package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;
import ru.opodoydet.application.places.PlaceSearch;

class SearchFiltersIntegrationTest {
  @TempDir Path directory;

  @Test void hotelCandidatesApplyInterpretedRequiredAmenitiesAndPreserveEvidenceStates() throws Exception {
    Instant now = Instant.now();
    List<JsonNode> hotels = new ArrayList<>(), facts = new ArrayList<>();
    for (String id : List.of("match", "mismatch", "unknown", "stale", "conflict", "partial-period")) {
      hotels.add(Json.obj("id", id, "name", "Synthetic candidate " + id, "address", "Test address",
          "currency", "KRW", "lodgingType", "hotel", "rooms", List.of(), "noise", List.of(), "route", null));
      if (id.equals("unknown")) continue;
      ObjectNode fact = Json.obj("id", id + "-pool", "hotelId", id, "feature", "pool", "value", !id.equals("mismatch"),
          "demo", false, "method", "official", "sourceUrl", "https://example.test/pool",
          "quote", "Synthetic test evidence for the pool condition", "obtainedAt", now.minusSeconds(60).toString(),
          "expiresAt", (id.equals("stale") ? now.minusSeconds(1) : now.plusSeconds(86400)).toString());
      if (id.equals("partial-period")) {
        fact.put("validFrom", "2027-06-01").put("validTo", "2027-06-01");
      }
      facts.add(fact);
      if (id.equals("conflict")) facts.add(fact.deepCopy().put("id", "conflicting-pool").put("value", false));
    }
    ObjectNode seed = Json.obj("region", "Пусан", "evidencePolicy", "verified-only", "hotels", hotels, "facts", facts);
    ObjectNode trip = Json.obj("region", "Пусан", "checkIn", "2027-06-01", "checkOut", "2027-06-03",
        "adults", 2, "children", 0, "scenarios", List.of(), "text", "Обязательно стиральная машина",
        "preferences", List.of(), "admissionMode", "explore");
    try (var database = TestDatabases.create(seed)) {
      SearchService service = new SearchService(database.store(), new Agents(Agents.Config.from(Map.of())),
          new Environment(directory.resolve("air.json"), directory.resolve("noise.json")), Clock.fixed(now, ZoneOffset.UTC));
      JsonNode washing = service.search(trip);
      assertTrue(Json.list(washing.path("preferences")).stream().anyMatch(preference ->
          Json.str(preference, "feature").equals("washing_machine") && preference.path("required").asBoolean()));
      assertEquals(6, washing.path("hotelCandidates").size());
      for (JsonNode candidate : washing.path("hotelCandidates")) {
        assertTrue(candidate.path("provisional").asBoolean());
        JsonNode criterion = candidate.path("criteria").get(0);
        assertEquals("washing_machine", Json.str(criterion, "feature"));
        assertEquals("unknown", Json.str(criterion, "evidenceStatus"));
        assertTrue(criterion.path("required").asBoolean());
        assertFalse(Json.str(criterion, "explanation").isBlank());
        assertTrue(candidate.path("hotel").path("rooms").isEmpty());
      }
      trip.put("admissionMode", "verified");
      assertTrue(service.search(trip).path("hotelCandidates").isEmpty());

      trip.put("text", "").put("admissionMode", "explore");
      trip.set("preferences", Json.array(List.of(Json.obj("feature", "pool", "required", true))));
      JsonNode pool = service.search(trip).path("hotelCandidates");
      assertEquals(4, pool.size(), "Known absence and conflicting sources exclude in explore too");
      for (JsonNode candidate : pool) {
        String id = Json.str(candidate.path("hotel"), "id");
        String expected = id.equals("match") || id.equals("stale") ? id : "unknown";
        assertEquals(expected, candidate.path("criteria").get(0).path("evidenceStatus").asText());
        assertEquals(!id.equals("match"), candidate.path("provisional").asBoolean());
      }
      trip.put("admissionMode", "verified");
      JsonNode verified = service.search(trip).path("hotelCandidates");
      assertEquals(1, verified.size());
      assertEquals("match", Json.str(verified.get(0).path("hotel"), "id"));
      assertEquals("match", verified.get(0).path("criteria").get(0).path("evidenceStatus").asText());
      trip.set("preferences", Json.array(List.of(Json.obj("feature", "pool", "required", false))));
      JsonNode optional = service.search(trip).path("hotelCandidates");
      assertEquals(6, optional.size());
      assertTrue(Json.list(optional).stream().allMatch(candidate -> !candidate.path("provisional").asBoolean()));
      assertEquals(1, Json.list(optional).stream().filter(candidate ->
          candidate.path("criteria").get(0).path("evidenceStatus").asText().equals("match")).count(),
          "An optional unknown condition must not become confirmed");
    }
  }

  @Test void locationWishesFilterAllHotelOnlyCandidatesWithoutTurningUnknownIntoConfirmed() throws Exception {
    Instant now = Instant.now();
    List<JsonNode> hotels = new ArrayList<>();
    for (int i = 0; i < 876; i++) {
      ObjectNode hotel = Json.obj("id", "location-fixture-" + i, "name", "Synthetic location fixture " + i,
          "address", "Synthetic test address", "lodgingType", "hotel", "currency", "KRW",
          "rooms", List.of(), "noise", List.of(), "route", null);
      if (i < 875) hotel.set("coordinates", Json.array(List.of(129.0, i == 874 ? 35.03 : 35.0)));
      hotels.add(hotel);
    }
    ObjectNode seed = Json.obj("region", "Пусан", "evidencePolicy", "verified-only", "hotels", hotels, "facts", List.of());
    ObjectNode snapshot = Json.obj("schemaVersion", 1, "region", "Пусан", "retrievedAt", now.toString(),
        "sources", List.of(Json.obj("id", "fixture-map", "url", "https://example.test/map", "sha256", "a".repeat(64),
            "obtainedAt", now.toString(), "sourceDate", null)),
        "places", List.of(
            Json.obj("id", "center:seomyeon", "name", "Synthetic center reference", "coordinates", List.of(129.0, 35.0),
                "sourceId", "fixture-map", "categories", List.of(), "aliases", List.of(), "centerScope", "city"),
            Json.obj("id", "fixture-cafe", "name", "Synthetic cafe", "coordinates", List.of(129.0, 35.0),
                "sourceId", "fixture-map", "categories", List.of("cafe"), "aliases", List.of())));
    ObjectNode trip = Json.obj("region", "Пусан", "checkIn", "2027-06-01", "checkOut", "2027-06-02",
        "adults", 2, "children", 0, "scenarios", List.of(), "text", "", "preferences", List.of(), "admissionMode", "explore");
    var center = Json.obj("query", "center:seomyeon", "relation", "near", "radiusMeters", 500, "required", true);
    var cafe = Json.obj("query", "cafe", "relation", "near", "radiusMeters", 500, "required", true);
    trip.set("locationWishes", Json.array(List.of(center, cafe)));
    try (var database = TestDatabases.create(seed)) {
      SearchService service = new SearchService(database.store(), new Agents(Agents.Config.from(Map.of())),
          new Environment(directory.resolve("air.json"), directory.resolve("noise.json")), Clock.fixed(now, ZoneOffset.UTC),
          null, SearchProjection.NONE, new PlaceSearch(snapshot));
      JsonNode explore = service.search(trip).path("hotelCandidates");
      assertEquals(875, explore.size(), "Known center mismatch excludes the far building even in explore");
      assertTrue(Json.list(explore).stream().noneMatch(c -> Json.str(c.path("hotel"), "id").equals("location-fixture-874")));
      assertEquals(1, Json.list(explore).stream().filter(c -> c.path("provisional").asBoolean()).count());
      assertEquals("location-fixture-875", Json.str(explore.get(explore.size() - 1).path("hotel"), "id"));
      trip.put("admissionMode", "verified");
      JsonNode verified = service.search(trip).path("hotelCandidates");
      assertEquals(874, verified.size());
      for (JsonNode candidate : verified) {
        assertFalse(candidate.path("provisional").asBoolean());
        assertFalse(candidate.has("room"));
        for (JsonNode criterion : candidate.path("locationCriteria")) {
          assertEquals("match", criterion.path("evidenceStatus").asText());
          assertTrue(criterion.path("places").get(0).path("distanceMeters").asDouble() <= 500);
        }
      }
      center.put("relation", "far");
      trip.set("locationWishes", Json.array(List.of(center)));
      JsonNode far = service.search(trip).path("hotelCandidates");
      assertEquals(1, far.size());
      assertEquals("location-fixture-874", Json.str(far.get(0).path("hotel"), "id"));
      trip.put("admissionMode", "explore");
      trip.set("locationWishes", Json.array(List.of(cafe)));
      JsonNode incompleteMap = service.search(trip).path("hotelCandidates");
      assertEquals(876, incompleteMap.size());
      assertEquals(2, Json.list(incompleteMap).stream().filter(c -> c.path("provisional").asBoolean()).count(),
          "A distant mapped cafe cannot prove that no nearer unmapped cafe exists");
      trip.put("admissionMode", "verified");
      assertEquals(874, service.search(trip).path("hotelCandidates").size());
    }
  }

  @Test void searchAlternativesDetailsAndAdvisorUseTheSameHardFiltersAndRoomScope() throws Exception {
    Instant now = Instant.now();
    List<JsonNode> hotels = new ArrayList<>(), facts = new ArrayList<>();
    for (String id : List.of("allowed", "expensive", "far", "unknown-price", "wrong-type")) {
      List<JsonNode> rooms = List.of(
          room(id + "-suite", "Ocean Suite", "A balcony overlooking the ocean", now),
          room(id + "-twin", "Garden Twin", "Two beds and a kitchenette", now));
      ObjectNode hotel = Json.obj("id", id, "name", "Test " + id, "address", "Haeundae",
          "lodgingType", id.equals("wrong-type") ? "motel" : "hotel", "coordinates", List.of(129.16, 35.16),
          "currency", "KRW", "pricePerNight", id.equals("expensive") ? 90_000 : 80_000,
          "route", Json.obj("meters", id.equals("far") ? 501 : 500), "rooms", rooms, "noise", List.of());
      if (id.equals("unknown-price")) hotel.remove("pricePerNight");
      hotels.add(hotel);
      for (JsonNode room : rooms)
        facts.add(Json.obj("id", room.path("id").asText() + "-family", "hotelId", id,
            "roomId", room.path("id").asText(), "feature", "family", "value", false,
            "demo", false, "method", "official", "sourceUrl", "https://example.org/rooms",
            "quote", "Synthetic test evidence: family condition is not met", "obtainedAt", now.minusSeconds(60).toString(),
            "expiresAt", now.plusSeconds(86400).toString()));
    }
    ObjectNode seed = Json.obj("region", "Пусан", "evidencePolicy", "verified-only", "hotels", hotels, "facts", facts);
    ObjectNode trip = Json.obj("region", "Пусан", "checkIn", "2027-06-01", "checkOut", "2027-06-02",
        "adults", 2, "children", 0, "scenarios", List.of(), "text", "",
        "preferences", List.of(Json.obj("feature", "family", "required", false)),
        "hotelFilters", Json.obj("query", "кухня", "lodgingTypes", List.of("hotel"), "maxPricePerNight", 80_000, "maxBeachMeters", 500));
    try (var database = TestDatabases.create(seed)) {
      SearchService service = new SearchService(database.store(), new Agents(Agents.Config.from(Map.of())),
          new Environment(directory.resolve("air.json"), directory.resolve("noise.json")), Clock.fixed(now, ZoneOffset.UTC));
      JsonNode result = service.search(trip, "browser:test");
      assertEquals(1, result.path("results").size());
      assertTrue(result.path("roomRecommendations").isEmpty());
      assertEquals(1, result.path("roomAlternatives").size());
      JsonNode alternative = result.path("roomAlternatives").get(0);
      assertEquals("allowed::allowed-twin", alternative.path("id").asText());
      assertFalse(alternative.path("room").path("catalogMatches").isEmpty());
      JsonNode detail = service.detail("allowed", trip);
      assertEquals("allowed-twin", detail.path("best").path("room").path("id").asText());
      assertEquals(alternative.path("room").path("score"), detail.path("best").path("score"));
      assertEquals(1, detail.path("rooms").size());
      assertNull(service.detail("expensive", trip));
      JsonNode advice = service.advisorContext(trip, result.path("searchId").asText(), "browser:test");
      assertEquals(1, advice.path("totalHotels").asInt());
      assertEquals(1, advice.path("candidates").size());
      assertEquals("allowed::allowed-twin", advice.path("candidates").get(0).path("id").asText());
      assertEquals(1, advice.path("scenarios").get(0).path("gainedCount").asInt());
      ObjectNode changed = trip.deepCopy();
      ((ObjectNode) changed.path("hotelFilters")).put("maxPricePerNight", 100_000);
      assertThrows(IllegalArgumentException.class, () -> service.advisorContext(changed, result.path("searchId").asText(), "browser:test"));
      trip.set("preferences", Json.array(List.of()));
      JsonNode exact = service.search(trip);
      assertEquals(1, exact.path("roomRecommendations").size());
      assertTrue(exact.path("roomAlternatives").isEmpty());
      assertEquals("allowed::allowed-twin", exact.path("roomRecommendations").get(0).path("id").asText());
      ((ObjectNode) trip.path("hotelFilters")).put("query", "люкс кухня");
      assertTrue(service.search(trip).path("roomRecommendations").isEmpty());
    }
  }

  @Test void nearbyConditionsUseSnapshotTimeAndHotelCandidatesNeverBecomeRooms() throws Exception {
    Instant now = Instant.now();
    List<JsonNode> hotels = new ArrayList<>();
    for (String id : List.of("verified-near", "verified-far", "verified-stale", "capacity-wrong", "candidate-near", "candidate-far", "candidate-expired")) {
      List<JsonNode> rooms = id.startsWith("candidate") ? List.of()
          : List.of(room(id + "-suite", "Test suite", "Synthetic test category", id.equals("verified-stale") ? now.minusSeconds(40L * 86400) : now)
              .put("capacity", id.equals("capacity-wrong") ? 1 : 2));
      ObjectNode place = NearbyPlacesTest.place("cafe", id.endsWith("far") ? 501 : 500, now);
      if (id.endsWith("expired")) place.put("expiresAt", now.toString());
      hotels.add(Json.obj("id", id, "name", "Test " + id, "address", "Busan test address",
          "lodgingType", "hotel", "coordinates", List.of(129.16, 35.16), "currency", "KRW",
          "route", Json.obj("meters", null), "rooms", rooms, "noise", List.of(),
          "nearbyPlaces", List.of(place), "sourceEvidence", Json.obj("sourceUrl", "https://www.openstreetmap.org/node/456")));
    }
    ObjectNode seed = Json.obj("region", "Пусан", "evidencePolicy", "verified-only", "hotels", hotels, "facts", List.of());
    ObjectNode trip = Json.obj("region", "Пусан", "checkIn", "2027-06-01", "checkOut", "2027-06-02",
        "adults", 2, "children", 0, "scenarios", List.of(), "text", "", "preferences", List.of(),
        "hotelFilters", NearbyPlacesTest.filters("cafe", 500));
    try (var database = TestDatabases.create(seed)) {
      SearchService service = new SearchService(database.store(), new Agents(Agents.Config.from(Map.of())),
          new Environment(directory.resolve("air.json"), directory.resolve("noise.json")), Clock.fixed(now, ZoneOffset.UTC));
      JsonNode result = service.search(trip, "browser:test");
      assertEquals(1, result.path("roomRecommendations").size());
      assertEquals("verified-near", result.path("roomRecommendations").get(0).path("hotel").path("id").asText());
      assertEquals(1, result.path("roomRecommendations").get(0).path("room").path("nearbyMatches").size());
      assertEquals(1, result.path("hotelCandidates").size());
      JsonNode candidate = result.path("hotelCandidates").get(0);
      assertEquals("candidate-near", candidate.path("hotel").path("id").asText());
      assertFalse(candidate.path("limitations").isEmpty());
      assertFalse(candidate.has("room"));
      assertTrue(candidate.path("hotel").path("rooms").isEmpty(), "No synthetic placeholder category on hotel-only cards");
      assertFalse(candidate.path("hotel").path("hasCollectedRoomCategories").asBoolean());
      assertEquals("https://www.openstreetmap.org/node/456", candidate.path("hotel").path("sourceEvidence").path("sourceUrl").asText());
      assertTrue(database.store().hotel("verified-stale").path("hasCollectedRoomCategories").asBoolean(),
          "Expired categories retain collection history and must not reappear as hotel-only candidates");
      assertEquals(1, candidate.path("nearbyMatches").size());
      assertTrue(candidate.path("catalogMatches").isEmpty());
      assertNull(service.detail("verified-far", trip));
      assertEquals(1, service.detail("verified-near", trip).path("best").path("nearbyMatches").size());
      JsonNode advice = service.advisorContext(trip, result.path("searchId").asText(), "browser:test");
      for (JsonNode recommendation : advice.path("candidates"))
        assertFalse(recommendation.path("id").asText().startsWith("candidate-"));
      ((ObjectNode) trip.path("hotelFilters")).put("query", "suite");
      assertTrue(service.search(trip).path("hotelCandidates").isEmpty(), "Room text must not qualify a hotel-only candidate");
      ((ObjectNode) trip.path("hotelFilters")).remove("query");
      ((ObjectNode) trip.path("hotelFilters")).put("maxPricePerNight", 100_000);
      assertTrue(service.search(trip).path("hotelCandidates").isEmpty(), "An unknown price must not pass a hard budget");
    }
  }

  private static ObjectNode room(String id, String name, String quote, Instant now) {
    return Json.obj("id", id, "name", name, "capacity", 2, "demo", false, "scope", "room_category",
        "evidenceStatus", "verified", "sourceUrl", "https://example.org/rooms/" + id,
        "quote", quote, "obtainedAt", now.minusSeconds(60).toString());
  }
}
