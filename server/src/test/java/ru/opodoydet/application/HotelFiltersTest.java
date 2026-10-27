package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.shared.Json;

class HotelFiltersTest {
  private final ObjectNode suite = Json.obj("id", "suite", "name", "Ocean Suite", "demo", false,
      "quote", "A balcony overlooking the ocean", "sourceUrl", "https://example.org/suite");
  private final ObjectNode twin = Json.obj("id", "twin", "name", "Garden Twin", "demo", false,
      "quote", "Two beds and a kitchenette");
  private final ObjectNode hotel = Json.obj("id", "test", "name", "Park Test Hotel",
      "address", "Пусан, 해운대, Haeundae 10", "lodgingType", "hotel",
      "pricePerNight", 80_000, "currency", "KRW", "route", Json.obj("meters", 500),
      "rooms", List.of(suite, twin));

  @Test void omittedFiltersLeaveTheOriginalRankingUntouched() {
    List<JsonNode> ranked = List.of(Json.obj("hotel", hotel));
    assertSame(ranked, HotelFilters.apply(ranked, List.of(), Json.obj().path("missing")));
    assertFalse(HotelFilters.active(Json.obj("query", "   ", "lodgingTypes", List.of())));
  }

  @Test void limitsAreInclusiveAndUnknownIsNeverZeroOrFree() {
    ObjectNode filters = Json.obj("maxPricePerNight", 80_000, "maxBeachMeters", 500);
    assertTrue(HotelFilters.matches(hotel, suite, List.of(), filters));
    assertFalse(HotelFilters.matches(hotel, suite, List.of(), Json.obj("maxPricePerNight", 79_999)));
    assertFalse(HotelFilters.matches(hotel, suite, List.of(), Json.obj("maxBeachMeters", 499)));
    for (Object price : new Object[] { null, 0, -1, "80000" }) {
      ObjectNode missing = hotel.deepCopy();
      missing.set("pricePerNight", Json.MAPPER.valueToTree(price));
      assertFalse(HotelFilters.matches(missing, suite, List.of(), filters));
    }
    assertFalse(HotelFilters.matches(hotel.deepCopy().put("currency", "USD"), suite, List.of(), filters));
    assertFalse(HotelFilters.matches(hotel.deepCopy().putNull("route"), suite, List.of(), filters));
    assertFalse(HotelFilters.matches(hotel.deepCopy().putNull("lodgingType"), suite, List.of(), Json.obj("lodgingTypes", List.of("hotel"))));
  }

  @Test void unicodeAliasesAndAllTermsMatchInOneRoomOnly() {
    assertTrue(HotelFilters.matches(hotel, suite, List.of(), Json.obj("query", "ＰＡＲＫ люкс с балконом")));
    assertTrue(HotelFilters.matches(hotel, twin, List.of(), Json.obj("query", "ТВИН с кухней")));
    assertTrue(HotelFilters.matches(hotel, suite, List.of(), Json.obj("query", "Haeun 해운대")));
    assertFalse(HotelFilters.matches(hotel, suite, List.of(), Json.obj("query", "люкс кухня")));
    assertFalse(HotelFilters.matches(hotel, twin, List.of(), Json.obj("query", "балкон")));
    assertFalse(HotelFilters.matches(hotel, suite, List.of(), Json.obj("query", "!!!")));
  }

  @Test void quotesPreserveNegativeEvidenceScopeAndProvenance() {
    ObjectNode fact = Json.obj("id", "negative", "hotelId", "test", "roomId", "suite",
        "quote", "No pool is available", "value", false, "demo", false,
        "sourceUrl", "https://example.org/suite", "obtainedAt", "2026-10-20T00:00:00Z", "expiresAt", "2026-11-20T00:00:00Z");
    ObjectNode filters = Json.obj("query", "бассейн");
    assertTrue(HotelFilters.matches(hotel, suite, List.of(fact), filters));
    assertFalse(HotelFilters.matches(hotel, twin, List.of(fact), filters));
    assertFalse(HotelFilters.matches(hotel, suite, List.of(fact.deepCopy().put("hotelId", "other")), filters));
    assertFalse(HotelFilters.matches(hotel, suite, List.of(fact.deepCopy().put("demo", true)), filters));
    JsonNode snippet = HotelFilters.snippets(hotel, suite, List.of(fact), filters).getFirst();
    assertEquals("negative", snippet.path("factId").asText());
    assertEquals("No pool is available", snippet.path("text").asText());
    assertEquals("2026-10-20T00:00:00Z", snippet.path("obtainedAt").asText());
    assertEquals("2026-11-20T00:00:00Z", snippet.path("expiresAt").asText());
    assertFalse(snippet.has("sourceDate"));
    assertFalse(fact.path("value").asBoolean());
  }

  @Test void filteringSelectsAnotherBestRoomWithoutMutatingEvidenceOrInput() {
    ObjectNode suiteMatch = Json.obj("room", suite, "status", "fits", "score", 80,
        "criteria", List.of(Json.obj("feature", "family", "evidenceStatus", "unknown")));
    ObjectNode twinMatch = Json.obj("room", twin, "status", "fits", "score", 40,
        "criteria", List.of(Json.obj("feature", "family", "evidenceStatus", "unknown")));
    ObjectNode match = Json.obj("hotel", hotel, "best", suiteMatch, "rooms", List.of(suiteMatch, twinMatch));
    List<JsonNode> filtered = HotelFilters.apply(List.of(match), List.of(), Json.obj("query", "кухня"));
    assertEquals(1, filtered.size());
    JsonNode best = filtered.getFirst().path("best");
    assertEquals("twin", best.path("room").path("id").asText());
    assertEquals(1, filtered.getFirst().path("rooms").size());
    assertEquals("unknown", best.path("criteria").get(0).path("evidenceStatus").asText());
    assertFalse(best.path("catalogMatches").isEmpty());
    assertEquals(2, match.path("rooms").size());
    assertEquals("suite", match.path("best").path("room").path("id").asText());
  }

  @Test void validationRejectsCoercionUnknownFieldsDuplicatesAndInvalidLimits() {
    for (String value : List.of("null", "{\"maxPricePerNight\":\"1000\"}", "{\"maxPricePerNight\":0}",
        "{\"maxPricePerNight\":100000001}", "{\"maxBeachMeters\":null}", "{\"maxBeachMeters\":-2}",
        "{\"lodgingTypes\":[\"hotel\",\"hotel\"]}", "{\"lodgingTypes\":[\"villa\"]}", "{\"maxPrice\":10}"))
      assertThrows(IllegalArgumentException.class, () -> Validation.hotelFilters(Json.read(value)), value);
    assertThrows(IllegalArgumentException.class, () -> Validation.hotelFilters(Json.obj("query", "x".repeat(241))));
    assertDoesNotThrow(() -> Validation.hotelFilters(Json.obj("query", "Park", "maxBeachMeters", 500.5)));
  }

  @Test void sharedCrossLanguageFixtureKeepsJavaAlignedWithTypeScriptPreview() throws Exception {
    Path fixture = Path.of("tests", "catalog-filter-cases.json");
    if (!Files.exists(fixture)) fixture = Path.of("..", "tests", "catalog-filter-cases.json");
    for (JsonNode value : Json.read(Files.readString(fixture))) {
      ObjectNode room = value.path("roomId").asText().equals("suite") ? suite.deepCopy() : twin.deepCopy();
      if (value.has("quote")) room.put("quote", value.path("quote").asText());
      assertEquals(value.path("expected").asBoolean(),
          HotelFilters.matches(hotel, room, List.of(), Json.obj("query", value.path("query").asText())), value.toString());
    }
  }
}
