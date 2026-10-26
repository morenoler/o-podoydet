package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.SQLException;
import java.util.List;

/** Optional feature-module projection; a snapshot never exposes its private source material. */
public interface SearchExtension {
  Snapshot snapshot(JsonNode trip) throws SQLException;

  interface Snapshot {
    List<JsonNode> apply(List<JsonNode> baseline, List<JsonNode> preferences);

    int additionalHotels();

    /** Generated query constraints only: no raw user text or private owner data. */
    default List<JsonNode> personalCriteria() {
      return List.of();
    }
  }

  Snapshot EMPTY =
      new Snapshot() {
        public List<JsonNode> apply(List<JsonNode> baseline, List<JsonNode> preferences) {
          return baseline;
        }

        public int additionalHotels() {
          return 0;
        }
      };
}
