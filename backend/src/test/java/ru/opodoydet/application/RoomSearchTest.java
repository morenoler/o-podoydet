package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.domain.Evidence;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;

class RoomSearchTest {
  @TempDir Path directory;

  @Test
  void searchExposesConcreteAllCriterionRoomsAndDetailRetainsEachCategoryIdentity()
      throws Exception {
    Instant now = Instant.now();
    String observed = now.minusSeconds(60).toString();
    List<JsonNode> rooms = new ArrayList<>(), facts = new ArrayList<>();
    for (String roomId : List.of("family-only", "courtyard-only", "exact-a", "exact-b")) {
      rooms.add(
          Json.obj(
              "id",
              roomId,
              "name",
              "Category " + roomId,
              "capacity",
              2,
              "demo",
              false,
              "evidenceStatus",
              "verified",
              "sourceUrl",
              "https://example.org/rooms/" + roomId,
              "quote",
              "Official test category for two guests",
              "obtainedAt",
              observed));
      for (String feature : List.of("family", "courtyard")) {
        boolean value = roomId.startsWith("exact-") || roomId.equals(feature + "-only");
        facts.add(
            Json.obj(
                "id",
                roomId + ":" + feature,
                "hotelId",
                "hotel",
                "roomId",
                roomId,
                "feature",
                feature,
                "value",
                value,
                "demo",
                false,
                "method",
                "official",
                "sourceUrl",
                "https://example.org/rooms/" + roomId,
                "quote",
                "Synthetic test evidence of " + feature,
                "obtainedAt",
                observed,
                "expiresAt",
                now.plusSeconds(86400).toString()));
      }
    }
    ObjectNode hotel =
        Json.obj(
            "id",
            "hotel",
            "name",
            "Hotel with four categories",
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
    ObjectNode unknown =
        Json.obj(
            "id",
            "unknown-hotel",
            "name",
            "Unknown categories",
            "lodgingType",
            "hotel",
            "coordinates",
            List.of(129.17, 35.16),
            "rooms",
            List.of(Evidence.placeholder("unknown-hotel")),
            "route",
            null,
            "noise",
            List.of());
    ObjectNode catalog =
        Json.obj(
            "region",
            "Пусан",
            "evidencePolicy",
            "verified-only",
            "hotels",
            List.of(hotel, unknown),
            "facts",
            facts);
    ObjectNode trip =
        Json.obj(
            "region",
            "Пусан",
            "checkIn",
            "2027-06-10",
            "checkOut",
            "2027-06-17",
            "adults",
            2,
            "children",
            0,
            "scenarios",
            List.of(),
            "text",
            "",
            "preferences",
            List.of(
                Json.obj("feature", "family", "required", false),
                Json.obj("feature", "courtyard", "required", false)));
    try (Store store = new Store(":memory:", catalog)) {
      SearchService service =
          new SearchService(
              store,
              new Agents(Agents.Config.from(Map.of())),
              new Environment(directory.resolve("air.json"), directory.resolve("noise.json")),
              Clock.fixed(now, ZoneOffset.UTC));
      JsonNode result = service.search(trip);
      assertEquals(2, result.path("roomRecommendations").size());
      assertEquals(2, result.path("roomAlternatives").size());
      assertEquals(1, result.path("unverifiedHotelCount").asInt());
      assertEquals(
          List.of("hotel::exact-a", "hotel::exact-b"),
          Json.list(result.path("roomRecommendations")).stream()
              .map(item -> Json.str(item, "id"))
              .toList());
      JsonNode detail = service.detail("hotel", trip);
      for (JsonNode recommendation : result.path("roomRecommendations")) {
        String roomId = Json.str(recommendation.path("room").path("room"), "id");
        JsonNode detailRoom =
            Json.list(detail.path("rooms")).stream()
                .filter(value -> Json.str(value.path("room"), "id").equals(roomId))
                .findFirst()
                .orElseThrow();
        assertEquals(recommendation.path("room").path("room"), detailRoom.path("room"));
        for (String feature : List.of("family", "courtyard")) {
          JsonNode criterion =
              Json.list(detailRoom.path("criteria")).stream()
                  .filter(value -> Json.str(value, "feature").equals(feature))
                  .findFirst()
                  .orElseThrow();
          assertEquals("match", Json.str(criterion, "status"));
          assertEquals("match", Json.str(criterion, "evidenceStatus"));
        }
      }
      trip.set(
          "preferences",
          Json.array(
              List.of(
                  Json.obj("feature", "family", "required", true),
                  Json.obj("feature", "courtyard", "required", true))));
      JsonNode strict = service.search(trip);
      assertEquals(2, strict.path("roomRecommendations").size());
      assertTrue(strict.path("roomAlternatives").isEmpty());
    }
  }
}
