package ru.opodoydet.server.search;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import ru.opodoydet.domain.BinaryDecisionPolicy;

/** Shared evidence policy: absent or conflicting evidence cannot become a positive fact. */
final class DecisionPolicy {
  private DecisionPolicy() {}
  static ObjectNode decide(ObjectNode raw, JsonNode hotel) {
    return BinaryDecisionPolicy.decide(raw, hotel);
  }
}
