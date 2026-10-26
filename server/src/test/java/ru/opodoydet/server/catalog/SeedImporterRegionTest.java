package ru.opodoydet.server.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

class SeedImporterRegionTest {
  private static ObjectNode hotel(String id) {
    return Json.obj("id", id, "name", "Synthetic " + id, "rooms",
        List.of(Json.obj("id", "room", "name", "Synthetic room", "capacity", 2)));
  }

  private static ObjectNode seed(String region, List<JsonNode> hotels, List<JsonNode> facts) {
    return Json.obj("region", region, "evidencePolicy", "demo", "hotels", hotels, "facts", facts);
  }

  @Test
  void aNewEvidenceIdCannotAttachToAnotherRegionsHotelAndFailureIsAtomic() throws Exception {
    JsonNode initial = seed("First", List.of(hotel("first-hotel")), List.of());
    try (var database = TestDatabases.create(initial)) {
      JsonNode invalid = seed("Second", List.of(hotel("second-hotel")), List.of(
          Json.obj("id", "brand-new-fact", "hotelId", "first-hotel", "feature", "family",
              "method", "demo", "value", true)));
      assertThatThrownBy(() -> database.importSeed(invalid))
          .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("неизвестный отель");
      assertThat(database.store().region()).isEqualTo("First");
      assertThat(database.jdbc().sql("SELECT id FROM hotel").query(String.class).list())
          .containsExactly("first-hotel");
      assertThat(database.jdbc().sql("SELECT region FROM dataset").query(String.class).list())
          .containsExactly("First");
      assertThat(database.store().facts()).isEmpty();
    }
  }

  @Test
  void partialSnapshotRetainsCurrentRegionsHotelsAndRoomsAndMayAddEvidenceForThem() throws Exception {
    JsonNode initial = seed("First", List.of(hotel("retained-hotel")), List.of());
    try (var database = TestDatabases.create(initial)) {
      JsonNode fact = Json.obj("id", "retained-fact", "hotelId", "retained-hotel", "roomId", "room",
          "feature", "family", "method", "demo", "value", true);
      database.importSeed(seed("First", List.of(hotel("added-hotel")), List.of(fact)));
      assertThat(database.store().hotels()).extracting(h -> h.path("id").asText())
          .containsExactly("retained-hotel", "added-hotel");
      assertThat(database.store().hotel("retained-hotel").path("rooms").get(0).path("id").asText())
          .isEqualTo("room");
      assertThat(database.store().facts()).containsExactly(fact);
    }
  }
}
