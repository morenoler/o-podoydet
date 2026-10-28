package ru.opodoydet.application.places;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class PlaceSearchTest {
  private static final Instant NOW = Instant.parse("2026-10-27T10:00:00Z");
  private ObjectNode source() {
    return Json.obj("id", "fixture-source", "url", "https://example.test/map", "sha256", "a".repeat(64),
        "obtainedAt", "2026-10-26T10:00:00Z", "sourceDate", "2026-10-25T09:00:00Z");
  }
  private ObjectNode place(String id, String name, String category, double latitude) {
    return Json.obj("id", id, "name", name, "aliases", List.of(), "categories", List.of(category),
        "coordinates", List.of(129.0, latitude), "sourceId", "fixture-source", "sourceUrl", "https://example.test/" + id,
        "coordinateMethod", "osm_node", "assumptions", List.of());
  }
  private ObjectNode snapshot() {
    return Json.obj("schemaVersion", 1, "region", "Пусан", "retrievedAt", "2026-10-26T10:00:00Z", "sourceDate", "2026-10-25T09:00:00Z",
        "sources", List.of(source()), "coverage", Json.obj("complete", false, "bbox", List.of(128.9, 34.9, 129.1, 35.1)),
        "places", List.of(place("cafe-a", "Учебная кофейня", "cafe", 35.001),
            place("park-a", "Тестовый парк", "park", 35.01),
            place("center:haeundae", "Опорная точка Хэундэ", "subway", 35.002).put("centerScope", "district"),
            place("center:seomyeon", "Опорная точка Сомён", "subway", 35.03).put("centerScope", "city")));
  }
  private ObjectNode hotel() { return Json.obj("id", "fixture-hotel", "coordinates", List.of(129.0, 35.0)); }
  private ObjectNode trip() { return Json.obj("locationWishes", List.of()); }
  private ObjectNode wish(String query, String relation, int radius, boolean required) {
    return Json.obj("query", query, "relation", relation, "radiusMeters", radius, "required", required);
  }
  private ObjectNode trip(JsonNode wish) { return Json.obj("locationWishes", List.of(wish)); }
  private JsonNode criterion(String query, String relation, int radius) {
    return new PlaceSearch(snapshot()).evaluate(hotel(), trip(wish(query, relation, radius, true)), NOW).getFirst();
  }

  @Test void realCoordinatesAndSourceProduceMeasuredNearbyEvidence() {
    JsonNode result = criterion("cafe", "near", 300);
    assertEquals("match", result.path("status").asText());
    assertEquals("match", result.path("evidenceStatus").asText());
    assertEquals("haversine_straight_line", result.path("method").asText());
    JsonNode found = result.path("places").get(0);
    assertEquals("Учебная кофейня", found.path("name").asText());
    assertTrue(found.path("meters").asInt() > 100 && found.path("meters").asInt() < 120);
    assertEquals("https://example.test/cafe-a", found.path("sourceUrl").asText());
    assertEquals("2026-10-26T10:00:00Z", found.path("obtainedAt").asText());
    assertTrue(result.path("assumptions").toString().contains("по прямой"));
  }

  @Test void missingCategoryAndIncompleteCoverageNeverBecomeAbsenceOrKnownMismatch() {
    assertEquals("unknown", criterion("pharmacy", "near", 800).path("status").asText());
    assertEquals("unknown", criterion("park", "near", 200).path("status").asText());
    assertEquals("unknown", criterion("cafe", "far", 50).path("status").asText());
    assertEquals("mismatch", criterion("cafe", "far", 300).path("status").asText());
  }

  @Test void exactNamedAnchorCanBeComparedWithAnExplicitDistance() {
    assertEquals("mismatch", criterion("center:seomyeon", "near", 800).path("status").asText());
    assertEquals("match", criterion("center:haeundae", "near", 800).path("status").asText());
    assertTrue(criterion("center:haeundae", "near", 800).path("explanation").asText().contains("опорной точкой"));
    assertEquals("match", criterion("Тестовый парк", "far", 500).path("status").asText());
  }

  @Test void hotelWithoutCoordinatesAndSyntheticHotelCannotBorrowGeographicalFacts() {
    var search = new PlaceSearch(snapshot());
    JsonNode trip = trip(wish("cafe", "near", 800, true));
    assertEquals("unknown", search.evaluate(Json.obj("id", "account-listing:fixture"), trip, NOW).getFirst().path("status").asText());
    assertEquals("unknown", search.evaluate(hotel().put("synthetic", true), trip, NOW).getFirst().path("status").asText());
    assertEquals("unknown", search.surroundings(hotel().put("synthetic", true), 800, NOW).path("status").asText());
  }

  @Test void staleFutureAndUnverifiableSourcesAreUnknown() {
    for (String date : List.of("2024-01-01T00:00:00Z", "2027-01-01T00:00:00Z", "bad-date")) {
      ObjectNode snapshot = snapshot();
      ((ObjectNode) snapshot.path("sources").get(0)).put("obtainedAt", date);
      assertEquals("unknown", new PlaceSearch(snapshot).evaluate(hotel(), trip(wish("cafe", "near", 800, true)), NOW).getFirst().path("status").asText());
    }
    ObjectNode snapshot = snapshot();
    ((ObjectNode) snapshot.path("sources").get(0)).put("sha256", "not-a-digest");
    assertEquals("unknown", new PlaceSearch(snapshot).evaluate(hotel(), trip(wish("cafe", "near", 800, true)), NOW).getFirst().path("status").asText());
  }

  @Test void malformedOrMissingSnapshotDoesNotCrashOrdinarySearch() {
    var search = new PlaceSearch(Path.of(".local/definitely-missing-location-snapshot.json"));
    assertEquals("unknown", search.evaluate(hotel(), trip(wish("cafe", "near", 800, true)), NOW).getFirst().path("status").asText());
    assertEquals("unknown", search.surroundings(hotel(), 800, NOW).path("status").asText());
  }

  @Test void surroundingsReportsPlacesAndCenterReferencesWithoutClaimingAnOfficialCenter() {
    JsonNode nearby = new PlaceSearch(snapshot()).surroundings(hotel(), 300, NOW);
    assertEquals("available", nearby.path("status").asText());
    assertEquals(1, nearby.path("places").size());
    assertEquals(2, nearby.path("centers").size());
    assertEquals("Учебная кофейня", nearby.path("places").get(0).path("name").asText());
  }

  @Test void parsesMultipleIndependentLocationConditionsAndPreservesOrdinaryClauses() {
    JsonNode result = new PlaceSearch(snapshot()).refine(trip(), "Обязательно кафе в пределах 300 м, а парк желательно в пределах 2 км, и тихо");
    assertTrue(result.path("handled").asBoolean());
    assertEquals(2, result.path("locationWishes").size());
    assertEquals("cafe", result.path("locationWishes").get(0).path("query").asText());
    assertTrue(result.path("locationWishes").get(0).path("required").asBoolean());
    assertEquals(2000, result.path("locationWishes").get(1).path("radiusMeters").asInt());
    assertFalse(result.path("locationWishes").get(1).path("required").asBoolean());
    assertTrue(result.path("remainingText").asText().contains("тихо"));
  }

  @Test void aDefaultDistanceIsExplicitAndCanBeChangedWithoutWeakeningMandatoryStatus() {
    var search = new PlaceSearch(snapshot());
    JsonNode first = search.refine(trip(), "Обязательно кафе рядом");
    assertEquals(800, first.path("locationWishes").get(0).path("radiusMeters").asInt());
    assertFalse(first.path("warnings").isEmpty());
    JsonNode changed = search.refine(first, "Кафе до 500 м");
    assertEquals(500, changed.path("locationWishes").get(0).path("radiusMeters").asInt());
    assertTrue(changed.path("locationWishes").get(0).path("required").asBoolean());
    JsonNode optional = search.refine(changed, "Кафе не обязательно");
    assertFalse(optional.path("locationWishes").get(0).path("required").asBoolean());
    assertTrue(search.refine(optional, "Убери кафе").path("locationWishes").isEmpty());
  }

  @Test void ambiguousCenterRequiresClarificationAndRetainsItsConstraintAcrossTurns() {
    var search = new PlaceSearch(snapshot());
    JsonNode pending = search.refine(trip(), "Обязательно в центре в пределах 500 м");
    assertTrue(pending.path("handled").asBoolean());
    assertTrue(pending.path("locationWishes").isEmpty());
    assertEquals("center", pending.path("pendingLocationQuery").path("query").asText());
    JsonNode resolved = search.refine(pending, "Хэундэ");
    assertEquals("center:haeundae", resolved.path("locationWishes").get(0).path("query").asText());
    assertEquals(500, resolved.path("locationWishes").get(0).path("radiusMeters").asInt());
    assertTrue(resolved.path("locationWishes").get(0).path("required").asBoolean());
    assertTrue(resolved.path("pendingLocationQuery").isNull());
  }

  @Test void pendingCenterSurvivesAnUnrelatedTurnAndCanBeCancelled() {
    var search = new PlaceSearch(snapshot());
    JsonNode pending = search.refine(trip(), "Хочу в центре");
    assertEquals(pending.path("pendingLocationQuery"), search.refine(pending, "И ещё тихо").path("pendingLocationQuery"));
    assertTrue(search.refine(pending, "Убери условие про центр").path("pendingLocationQuery").isNull());
  }

  @Test void namedUnknownPlacesAreRetainedWithoutInventingCoordinates() {
    var search = new PlaceSearch(snapshot());
    JsonNode result = search.refine(trip(), "Рядом с Неизвестным музеем");
    assertEquals("неизвестным музеем", result.path("locationWishes").get(0).path("query").asText());
    assertEquals("unknown", search.evaluate(hotel(), result, NOW).getFirst().path("status").asText());
  }

  @Test void walkingTimeDoesNotBecomeAnUnlabelledStraightLineEstimate() {
    JsonNode result = new PlaceSearch(snapshot()).refine(trip(), "Метро в 10 минутах пешком");
    assertTrue(result.path("handled").asBoolean());
    assertTrue(result.path("locationWishes").isEmpty());
    assertTrue(result.path("warnings").toString().contains("маршрут"));
  }

  @Test void kilometerDecimalsAndNearNegationAreHandled() {
    var search = new PlaceSearch(snapshot());
    JsonNode result = search.refine(trip(), "Кафе недалеко, в пределах 0,5 км");
    // The comma joining the radius is a separate clause, so do not claim a hidden radius change.
    assertEquals("near", result.path("locationWishes").get(0).path("relation").asText());
    JsonNode exact = search.refine(trip(), "Кафе в пределах 0,5 км");
    assertEquals(500, exact.path("locationWishes").get(0).path("radiusMeters").asInt());
    assertEquals("far", search.refine(trip(), "Кафе не ближе 300 м").path("locationWishes").get(0).path("relation").asText());
  }

  @Test void validationRejectsMalformedCoordinatesAndUnboundedUserWishes() {
    var search = new PlaceSearch(snapshot());
    ObjectNode badHotel = hotel(); badHotel.set("coordinates", Json.array(List.of(999, 35)));
    assertEquals("unknown", search.evaluate(badHotel, trip(wish("cafe", "near", 800, true)), NOW).getFirst().path("status").asText());
    assertThrows(IllegalArgumentException.class, () -> PlaceSearch.validateWishes(Json.array(List.of(wish("cafe", "near", 49, true)))));
    assertThrows(IllegalArgumentException.class, () -> PlaceSearch.validateWishes(Json.array(List.of(wish("cafe", "near", 800, true), wish("cafe", "far", 500, false)))));
    assertThrows(IllegalArgumentException.class, () -> PlaceSearch.validatePending(wish("cafe", "near", 800, true)));
  }

  @Test void localModelMayInterpretAColloquialWishButNeverSupplyGeometry() {
    LocalPlacePlanner model = (message, current) -> Json.obj("updates", List.of(Json.obj(
        "query", "supermarket", "relation", "near", "action", "add", "quote", message)), "remainingText", "");
    var search = new PlaceSearch(snapshot(), model);
    JsonNode result = search.refine(trip(), "Утром забежать за продуктами поблизости");
    assertEquals("local_model", result.path("mode").asText());
    assertEquals("supermarket", result.path("locationWishes").get(0).path("query").asText());
    assertEquals("unknown", search.evaluate(hotel(), result, NOW).getFirst().path("status").asText());
  }

  @Test void rejectedModelOutputNeverPartiallyMutatesTheTrip() {
    LocalPlacePlanner model = (message, current) -> Json.obj("updates", List.of(
        Json.obj("query", "cafe", "relation", "near", "action", "add", "quote", message),
        Json.obj("query", "pharmacy", "relation", "near", "action", "add", "quote", "never requested")), "remainingText", "");
    var search = new PlaceSearch(snapshot(), model);
    JsonNode original = trip(wish("park", "near", 800, true));
    JsonNode result = search.refine(original, "Нестандартное пожелание");
    assertEquals(original.path("locationWishes"), result.path("locationWishes"));
    assertFalse(result.path("handled").asBoolean());
    assertFalse(result.path("warnings").isEmpty());
  }

  @Test void remoteModelEndpointsAreNeverUsed() {
    assertNull(LocalPlacePlanner.from(Map.of("ADVISOR_LOCAL_MODEL", "fixture", "ADVISOR_LOCAL_BASE_URL", "https://example.test/v1")));
    assertNull(LocalPlacePlanner.from(Map.of("ADVISOR_LOCAL_MODEL", "fixture", "ADVISOR_LOCAL_BASE_URL", "http://user:password@localhost:11434/v1")));
  }

  @Test void amenityOnlyMessagesNeverCallTheLocationModel() {
    var calls = new java.util.concurrent.atomic.AtomicInteger();
    LocalPlacePlanner model = (message,current) -> { calls.incrementAndGet(); throw new AssertionError("Unexpected place model call"); };
    var search = new PlaceSearch(snapshot(),model);
    for (String message : List.of("Обязательно посудомойка и стиральная машина", "Бассейн не нужен", "Нужна кухня",
        "Wi-Fi", "Кондиционер", "Обязательно парковка", "Балкон", "Завтрак", "Можно с питомцем", "dishwasher required")) {
      JsonNode result = search.refine(trip(),message);
      assertFalse(result.path("handled").asBoolean(),message);
      assertEquals(message.replace(" и ","; "),result.path("remainingText").asText(),message);
    }
    assertEquals(0,calls.get());
  }

  @Test void locationModelCannotWeakenExplicitImportanceOrInvertDistance() {
    for (String message : List.of("Обязательно музей поблизости", "Музей желательно поблизости", "Убери условие про музей", "Музей подальше")) {
      LocalPlacePlanner model = (text,current) -> Json.obj("updates",List.of(Json.obj(
          "query","музей","relation","near","action","add","quote",text)),"remainingText","");
      JsonNode result = new PlaceSearch(snapshot(),model).refine(trip(),message);
      assertFalse(result.path("handled").asBoolean(),message);
      assertTrue(result.path("locationWishes").isEmpty(),message);
      assertFalse(result.path("warnings").isEmpty(),message);
    }
  }
}
