package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import ru.opodoydet.domain.Features;
import ru.opodoydet.domain.Matching;
import ru.opodoydet.shared.Json;

/** Captures one source of evidence before ranking results and counterfactual advice. */
public interface SearchProjection {
  @FunctionalInterface
  interface Snapshot extends Matching.CriterionSource {}

  Snapshot snapshot(JsonNode trip, Instant now);
  SearchProjection NONE = (trip, now) -> (hotel, room, feature) -> null;

  /** Per-request only. Returned trees are detached; UI/advisor projections cannot alter evidence.
   * Hotel-scoped criteria do not depend on a room, so candidate cards share the same calculation.
   */
  static Snapshot memoized(Snapshot source) {
    record Key(String hotelId, JsonNode room, String feature) {}
    Map<Key, Optional<ObjectNode>> cache = new HashMap<>();
    return (hotel, room, feature) -> {
      JsonNode scope = Features.get(feature).scope().equals("hotel") ? Json.obj() : room.deepCopy();
      Key key = new Key(Json.str(hotel, "id"), scope, feature);
      Optional<ObjectNode> stored = cache.computeIfAbsent(key,
          ignored -> Optional.ofNullable(source.evaluateCriterion(hotel, room, feature)).map(ObjectNode::deepCopy));
      return stored.map(ObjectNode::deepCopy).orElse(null);
    };
  }
}
