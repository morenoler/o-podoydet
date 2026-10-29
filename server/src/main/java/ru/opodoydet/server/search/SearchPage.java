package ru.opodoydet.server.search;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import ru.opodoydet.shared.Json;

/** Optional transport projection; ranking and private advisor snapshots always retain all matches. */
final class SearchPage {
  private static final List<String> LISTS = List.of(
      "results", "excluded", "roomRecommendations", "roomAlternatives", "hotelCandidates");

  private SearchPage() {}

  static ObjectNode apply(ObjectNode response, Integer page, Integer size, boolean excluded) {
    if (page != null && page < 0) throw new IllegalArgumentException("page должен быть неотрицательным");
    if (size != null && (size < 1 || size > 100)) throw new IllegalArgumentException("pageSize должен быть от 1 до 100");
    if (page != null && size == null) throw new IllegalArgumentException("Для page нужен pageSize");
    if (page == null && size == null && excluded) return response;
    int current = page == null ? 0 : page;
    ObjectNode totals = Json.obj();
    for (String name : LISTS) {
      JsonNode values = response.path(name);
      totals.put(name, values.size());
      if (name.equals("excluded") && !excluded) {
        ArrayNode summaries = Json.array(List.of());
        long start = size == null ? 0 : (long) current * size;
        long end = size == null ? values.size() : Math.min(start + size, values.size());
        for (long i = start; i < end; i++) {
          JsonNode match = values.get((int) i);
          ObjectNode hotel = Json.obj("id", match.path("hotel").path("id"), "name", match.path("hotel").path("name"));
          if (match.path("hotel").has("accountListingId"))
            hotel.set("accountListingId", match.path("hotel").path("accountListingId"));
          summaries.add(Json.obj("hotel", hotel, "best", match.path("best"),
              "ownerCriteria", match.path("ownerCriteria").isArray() ? match.path("ownerCriteria") : Json.array(List.of())));
        }
        response.set("excludedSummary", summaries);
        response.set(name, Json.array(List.of()));
      }
      else if (size != null) {
        ArrayNode slice = Json.array(List.of());
        long start = (long) current * size;
        for (long i = start; i < Math.min(start + size, values.size()); i++) slice.add(values.get((int) i));
        response.set(name, slice);
      }
    }
    response.set("pagination", Json.obj("page", current, "pageSize", size, "includeExcluded", excluded, "totals", totals));
    return response;
  }
}
