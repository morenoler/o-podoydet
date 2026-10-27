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

class SearchFiltersIntegrationTest {
  @TempDir Path directory;

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
