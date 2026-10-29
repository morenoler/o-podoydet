package ru.opodoydet.server.search;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.opodoydet.application.SearchProjection;
import ru.opodoydet.server.catalog.CatalogService;
import ru.opodoydet.server.knowledge.Characteristic;
import ru.opodoydet.server.knowledge.KnowledgeQueries;

/** Supplies captured knowledge to the single Matching pipeline before criteria are ranked.
 * The historical bean name is retained for configuration compatibility; no overlay reranks results.
 */
@Service
@Transactional(readOnly = true)
public class SearchOverlay implements SearchProjection {
  private final KnowledgeQueries knowledge;
  private final CatalogService catalog;
  private final ObjectMapper json;

  SearchOverlay(KnowledgeQueries knowledge, CatalogService catalog, ObjectMapper json) {
    this.knowledge = knowledge;
    this.catalog = catalog;
    this.json = json;
  }

  /** Used synchronously while planning all variants; stored advisor snapshots contain only JSON. */
  @Override
  public SearchProjection.Snapshot snapshot(JsonNode trip, Instant now) {
    String region = trip.path("region").asText();
    boolean demo = catalog.requireDataset(region).isDemoPolicy();
    Map<String, Characteristic> characteristics = knowledge.characteristics().stream()
        .collect(Collectors.toMap(Characteristic::getCode, Function.identity()));
    var hotelIds = java.util.Set.copyOf(catalog.hotelIds(region));
    var evaluator = new CriterionEvaluator(characteristics, knowledge.activeEvidenceByHotel(hotelIds),
        knowledge.confidenceByHotel(hotelIds), now, demo, json);
    JsonNode capturedTrip = trip.deepCopy();
    return (hotel, room, feature) -> {
      String hotelId = hotel.path("id").asText("");
      if (!hotelIds.contains(hotelId) || !evaluator.handles(feature)) return null;
      return evaluator.evaluate(hotelId, feature, false, room, capturedTrip);
    };
  }
}
