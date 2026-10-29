package ru.opodoydet.server.search;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class SearchPageTest {
  private static ObjectNode response() {
    var hotel = Json.obj("id", "hotel", "name", "Hotel", "accountListingId", "listing", "rooms", List.of("large"), "route", List.of(1, 2));
    var excluded = Json.obj("hotel", hotel, "best", Json.obj("status", "excluded", "criteria", List.of("reason")), "rooms", List.of("large"));
    return Json.obj("results", List.of(1, 2, 3), "excluded", List.of(excluded),
        "roomRecommendations", List.of(4, 5, 6), "roomAlternatives", List.of(), "hotelCandidates", List.of(7), "searchId", "private-snapshot");
  }

  @Test void legacyResponseIsUnchangedWithoutOptions() {
    var original = response();
    assertEquals(original.deepCopy(), SearchPage.apply(original, null, null, true));
  }

  @Test void compactResponsePreservesExclusionReasonsAndTotalsWithoutFullHotels() {
    var original = response();
    var compact = SearchPage.apply(original.deepCopy(), null, null, false);
    assertTrue(compact.path("excluded").isEmpty());
    assertEquals(original.path("excluded").get(0).path("best"), compact.path("excludedSummary").get(0).path("best"));
    assertFalse(compact.path("excludedSummary").get(0).path("hotel").has("route"));
    assertFalse(compact.path("excludedSummary").get(0).path("hotel").has("rooms"));
    assertEquals("listing", compact.path("excludedSummary").get(0).path("hotel").path("accountListingId").asText());
    assertEquals(1, compact.path("pagination").path("totals").path("excluded").asInt());
    assertEquals(original.path("roomRecommendations"), compact.path("roomRecommendations"));
  }

  @Test void pagesHaveTotalCountsAndDoNotChangeRankingOrSnapshotId() {
    var page = SearchPage.apply(response(), 1, 2, true);
    assertEquals(List.of(3), Json.MAPPER.convertValue(page.path("results"), List.class));
    assertEquals(3, page.path("pagination").path("totals").path("results").asInt());
    assertEquals("private-snapshot", page.path("searchId").asText());
    assertTrue(SearchPage.apply(response(), Integer.MAX_VALUE, 100, true).path("results").isEmpty());
    assertThrows(IllegalArgumentException.class, () -> SearchPage.apply(response(), 1, null, true));
    assertThrows(IllegalArgumentException.class, () -> SearchPage.apply(response(), -1, 10, true));
    assertThrows(IllegalArgumentException.class, () -> SearchPage.apply(response(), 0, 101, true));
  }
}
