package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.shared.Json;

class NearbyPlacesTest {
  private static final Instant NOW = Instant.parse("2026-10-27T12:00:00Z");

  static ObjectNode place(String kind, double meters, Instant now) {
    return Json.obj("kind", kind, "name", "Synthetic test place", "meters", meters,
        "coordinates", List.of(129.16, 35.16), "osmId", "node/123",
        "sourceUrl", "https://www.openstreetmap.org/node/123",
        "obtainedAt", now.minusSeconds(60).toString(), "expiresAt", now.plusSeconds(3600).toString(),
        "method", "haversine-osm-v1", "status", "supported", "scope", "hotel_surroundings");
  }

  static ObjectNode filters(String kind, double meters) {
    return Json.obj("nearby", List.of(Json.obj("kind", kind, "maxMeters", meters)));
  }

  private static ObjectNode hotel(JsonNode... places) {
    return Json.obj("coordinates", List.of(129.16, 35.16), "nearbyPlaces", List.of(places));
  }

  @Test void knownDistanceIsInclusiveButMissingAndExpiredAreUnknown() {
    ObjectNode hotel = hotel(place("cafe", 500, NOW));
    assertTrue(HotelFilters.active(filters("cafe", 500)));
    assertTrue(HotelFilters.matches(hotel, null, List.of(), filters("cafe", 500), NOW));
    assertFalse(HotelFilters.matches(hotel, null, List.of(), filters("cafe", 499), NOW));
    assertFalse(HotelFilters.matches(Json.obj(), null, List.of(), filters("cafe", 500), NOW));
    assertFalse(HotelFilters.matches(hotel, null, List.of(), filters("cafe", 500), NOW.plusSeconds(3600)));
    assertFalse(HotelFilters.matches(hotel, null, List.of(), filters("cafe", 500), NOW.minusSeconds(61)));
  }

  @Test void allKindsMustMatchAndOnlyClosestCurrentSourceIsSelected() {
    ObjectNode closest = place("cafe", 100, NOW).put("osmId", "way/456")
        .put("sourceUrl", "https://www.openstreetmap.org/way/456");
    ObjectNode hotel = hotel(place("cafe", 500, NOW), closest,
        place("restaurant", 300, NOW), place("cafe", 20, NOW).put("status", "conflict"));
    ObjectNode request = filters("cafe", 500);
    request.withArray("nearby").add(Json.obj("kind", "restaurant", "maxMeters", 300));
    List<JsonNode> selected = NearbyPlaces.selected(hotel, request, NOW);
    assertTrue(NearbyPlaces.matches(hotel, request, NOW));
    assertEquals(2, selected.size());
    assertEquals("way/456", selected.getFirst().path("osmId").asText());
    assertFalse(selected.getFirst().has("sourceDate"));
    ((ObjectNode) selected.getFirst()).put("name", "changed copy");
    assertEquals("Synthetic test place", closest.path("name").asText());
    request.withArray("nearby").add(Json.obj("kind", "park", "maxMeters", 800));
    assertFalse(NearbyPlaces.matches(hotel, request, NOW));
  }

  @Test void invalidMapEvidenceCannotBecomeConfirmation() {
    ObjectNode good = place("cafe", 500, NOW);
    for (ObjectNode invalid : List.of(
        good.deepCopy().put("status", "reported"), good.deepCopy().put("scope", "room_category"),
        good.deepCopy().put("method", "walking"), good.deepCopy().put("meters", "500"),
        good.deepCopy().put("meters", -1), good.deepCopy().put("obtainedAt", "broken"),
        good.deepCopy().put("expiresAt", NOW.toString()), good.deepCopy().put("sourceUrl", "https://example.org/node/123"),
        good.deepCopy().put("sourceUrl", "http://www.openstreetmap.org/node/123"),
        good.deepCopy().put("osmId", "node/456"), good.deepCopy().put("name", ""),
        good.deepCopy().put("sourceDate", "invalid"), good.deepCopy().put("sourceDate", NOW.plusSeconds(1).toString()),
        good.deepCopy().putNull("sourceDate"),
        good.deepCopy().set("coordinates", Json.array(List.of(129.16, 91)))))
      assertFalse(NearbyPlaces.usable(invalid, NOW), invalid.toString());
  }

  @Test void sourceDateIsOptionalAndPreservedWhenKnown() {
    ObjectNode source = place("city_center", 1500, NOW).put("sourceDate", "2026-10-10T12:00:00Z");
    JsonNode selected = NearbyPlaces.selected(hotel(source), filters("city_center", 1500), NOW).getFirst();
    assertEquals(source, selected);
    assertEquals("2026-10-10T12:00:00Z", selected.path("sourceDate").asText());
  }

  @Test void syntheticHotelsAndUnknownHotelCoordinatesCannotGetGeographicConfirmation() {
    ObjectNode original = hotel(place("cafe", 500, NOW));
    assertFalse(NearbyPlaces.matches(original.deepCopy().put("synthetic", true), filters("cafe", 500), NOW));
    assertFalse(NearbyPlaces.matches(original.deepCopy().putNull("coordinates"), filters("cafe", 500), NOW));
    ObjectNode invalid = original.deepCopy();
    invalid.set("coordinates", Json.array(List.of(129.16, "35.16")));
    assertFalse(NearbyPlaces.matches(invalid, filters("cafe", 500), NOW));
    assertTrue(NearbyPlaces.matches(original.deepCopy().put("synthetic", true), Json.obj(), NOW));
  }

  @Test void validationRejectsUnknownKindsDuplicatesCoercionAndLimits() {
    for (String raw : List.of("{\"nearby\":null}", "{\"nearby\":{}}", "{\"nearby\":[null]}",
        "{\"nearby\":[{\"kind\":\"casino\",\"maxMeters\":500}]}",
        "{\"nearby\":[{\"kind\":\"cafe\",\"maxMeters\":500,\"walking\":true}]}",
        "{\"nearby\":[{\"kind\":\"cafe\",\"maxMeters\":\"500\"}]}",
        "{\"nearby\":[{\"kind\":\"cafe\",\"maxMeters\":0}]}",
        "{\"nearby\":[{\"kind\":\"cafe\",\"maxMeters\":10001}]}",
        "{\"nearby\":[{\"kind\":\"cafe\",\"maxMeters\":500},{\"kind\":\"cafe\",\"maxMeters\":1000}]}"))
      assertThrows(IllegalArgumentException.class, () -> Validation.hotelFilters(Json.read(raw)), raw);
    assertDoesNotThrow(() -> Validation.hotelFilters(filters("cafe", 1)));
    assertDoesNotThrow(() -> Validation.hotelFilters(filters("city_center", 10000)));
    assertDoesNotThrow(() -> Validation.hotelFilters(filters("cafe", 500.5)));
  }

  @Test void supportedKindsStayAlignedWithConfiguration() throws Exception {
    Path file = Path.of("data", "busan", "place-categories.json");
    if (!Files.exists(file)) file = Path.of("..").resolve(file);
    assertEquals(NearbyPlaces.KINDS, Json.list(Json.read(Files.readString(file))).stream()
        .map(category -> category.path("key").asText()).collect(Collectors.toSet()));
    for (String kind : NearbyPlaces.KINDS)
      assertDoesNotThrow(() -> Validation.hotelFilters(filters(kind, 500)));
  }
}
