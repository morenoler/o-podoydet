package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;

/** Captures the knowledge overlay once, before computing both results and advice. */
public interface SearchProjection {
  interface Snapshot {
    List<JsonNode> apply(List<JsonNode> matches, List<JsonNode> preferences, boolean conflict);
  }
  Snapshot snapshot(JsonNode trip, Instant now);
  SearchProjection NONE = (trip, now) -> (matches, preferences, conflict) -> matches;
}
