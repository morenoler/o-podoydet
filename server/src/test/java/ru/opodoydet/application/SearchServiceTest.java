package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.server.support.TestDatabases.Database;
import ru.opodoydet.shared.Json;

class SearchServiceTest {
  @TempDir Path directory;

  @Test
  void detailKeepsSearchBestRoomAndScoreWhenUnselectedCriteriaFavorAnotherRoom() throws Exception {
    String timestamp = Instant.now().minusSeconds(60).toString();
    List<JsonNode> rooms = new ArrayList<>(), facts = new ArrayList<>();
    for (String id : List.of("chosen", "other")) {
      rooms.add(
          Json.obj(
              "id",
              id,
              "name",
              id,
              "capacity",
              2,
              "demo",
              false,
              "evidenceStatus",
              "verified",
              "sourceUrl",
              "https://example.org/rooms",
              "quote",
              "Test category",
              "obtainedAt",
              timestamp));
      for (String feature : List.of("family", "courtyard", "step_free_access")) {
        boolean value = feature.equals("family") == id.equals("chosen");
        facts.add(
            Json.obj(
                "id",
                id + feature,
                "hotelId",
                "hotel",
                "roomId",
                id,
                "feature",
                feature,
                "value",
                value,
                "method",
                "official",
                "demo",
                false,
                "sourceUrl",
                "https://example.org/rooms",
                "quote",
                "Synthetic test evidence",
                "obtainedAt",
                timestamp,
                "expiresAt",
                "2030-01-01T00:00:00Z"));
      }
    }
    ObjectNode hotel =
        Json.obj(
            "id",
            "hotel",
            "name",
            "Test",
            "lodgingType",
            "hotel",
            "coordinates",
            List.of(129.16, 35.16),
            "rooms",
            rooms,
            "route",
            null,
            "noise",
            List.of());
    ObjectNode seed = Json.obj("region", "Пусан", "hotels", List.of(hotel), "facts", facts);
    ObjectNode trip =
        Json.obj(
            "region",
            "Пусан",
            "checkIn",
            "2027-01-01",
            "checkOut",
            "2027-01-02",
            "adults",
            2,
            "children",
            0,
            "scenarios",
            List.of(),
            "text",
            "",
            "preferences",
            List.of(Json.obj("feature", "family", "required", false)));
    try (var database = TestDatabases.create(seed)) {
      Store store = database.store();
      SearchService service =
          new SearchService(
              store,
              new Agents(Agents.Config.from(Map.of())),
              new Environment(directory.resolve("air.json"), directory.resolve("noise.json")));
      JsonNode searched = service.search(trip).path("results").get(0);
      JsonNode detailed = service.detail("hotel", trip);
      assertEquals("chosen", Json.str(searched.path("best").path("room"), "id"));
      assertEquals(searched.path("best").path("room"), detailed.path("best").path("room"));
      assertEquals(searched.path("best").path("score"), detailed.path("best").path("score"));
      assertEquals(1, searched.path("best").path("criteria").size());
      assertEquals(ru.opodoydet.domain.Features.ids().size(), detailed.path("best").path("criteria").size());
      assertEquals("fits", Json.str(detailed.path("best"), "status"));
    }
  }
}
