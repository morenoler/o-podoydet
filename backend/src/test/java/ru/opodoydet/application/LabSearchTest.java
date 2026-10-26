package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;
import ru.opodoydet.web.Api;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

class LabSearchTest {
  @TempDir Path directory;

  private static ObjectNode seed() {
    List<JsonNode> hotels = new ArrayList<>(), facts = new ArrayList<>();
    for (int i = 0; i < 8; i++) {
      boolean synthetic = i < 6;
      String id = (synthetic ? "lab-demo-" : "real-") + i;
      hotels.add(
          Json.obj(
              "id",
              id,
              "name",
              id,
              "synthetic",
              synthetic,
              "rooms",
              List.of(Json.obj("id", id + "-room", "name", "Room", "capacity", 4, "demo", true))));
      for (String feature : List.of("family", "courtyard"))
        facts.add(
            Json.obj(
                "id",
                id + "-" + feature,
                "hotelId",
                id,
                "roomId",
                id + "-room",
                "feature",
                feature,
                "value",
                feature.equals("family") || !synthetic,
                "demo",
                true,
                "expiresAt",
                "2099-01-01T00:00:00Z"));
    }
    return Json.obj("region", "Пусан", "evidencePolicy", "demo", "hotels", hotels, "facts", facts);
  }

  private static ObjectNode trip() {
    return Json.obj(
        "region",
        "Пусан",
        "checkIn",
        "2027-06-10",
        "checkOut",
        "2027-06-17",
        "adults",
        2,
        "children",
        1,
        "text",
        "",
        "scenarios",
        List.of(),
        "preferences",
        List.of(
            Json.obj("feature", "family", "required", true),
            Json.obj("feature", "courtyard", "required", true)));
  }

  @Test
  void labSearchAndAdvisorScenariosRetainOnlySyntheticSnapshotWhileNormalSearchKeepsAll()
      throws Exception {
    try (Store store = new Store(":memory:", seed())) {
      SearchService search =
          new SearchService(
              store,
              new Agents(Agents.Config.from(Map.of())),
              new Environment(directory.resolve("air.json"), directory.resolve("noise.json")));
      ObjectNode normal = search.search(trip());
      assertEquals(2, normal.path("results").size());
      assertEquals(6, normal.path("excluded").size());
      ObjectNode result = search.searchLab(trip());
      assertTrue(result.path("results").isEmpty());
      assertEquals(6, result.path("excluded").size());
      assertTrue(
          Json.list(result.path("excluded")).stream()
              .allMatch(match -> match.path("hotel").path("synthetic").asBoolean()));
      String id = Json.str(result, "searchId");
      ObjectNode context = search.advisorContext(trip(), id);
      assertEquals(6, context.path("totalHotels").asInt());
      assertEquals(0, context.path("fitCount").asInt());
      assertEquals(6, context.path("testCases").size());
      assertTrue(
          Json.list(context.path("candidates")).stream()
              .allMatch(candidate -> Json.str(candidate, "hotelId").startsWith("lab-demo-")));
      JsonNode courtyardScenario =
          Json.list(context.path("scenarios")).stream()
              .filter(scenario -> Json.str(scenario, "feature").equals("courtyard"))
              .findFirst()
              .orElseThrow();
      assertEquals(6, courtyardScenario.path("count").asInt());
      assertEquals(6, courtyardScenario.path("gainedCount").asInt());
      ObjectNode changed = seed();
      for (JsonNode hotel : changed.path("hotels")) ((ObjectNode) hotel).put("synthetic", false);
      store.importSeed(changed);
      assertEquals(
          context,
          search.advisorContext(trip(), id),
          "Advisor must not reread the full hotel catalog");
      assertEquals(
          8,
          search.advisorContext(trip(), Json.str(normal, "searchId")).path("totalHotels").asInt());
    }
  }

  @Test
  void labSearchHttpRouteIsUnavailableUnlessExplicitlyEnabled() throws Exception {
    for (Map<String, String> settings :
        List.of(
            Map.<String, String>of(), Map.of("LAB_MODE", "false"), Map.of("LAB_MODE", "true"))) {
      try (Store store = new Store(":memory:", seed());
          Api api =
              new Api(
                  store,
                  new Agents(Agents.Config.from(Map.of())),
                  directory,
                  directory.resolve("air.json"),
                  directory.resolve("noise.json"),
                  directory.resolve("traffic.json"),
                  "",
                  0,
                  settings)) {
        api.start();
        HttpClient client = HttpClient.newHttpClient();
        String base = "http://127.0.0.1:" + api.port();
        HttpResponse<String> response =
            client.send(
                HttpRequest.newBuilder(URI.create(base + "/api/lab/search"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(Json.write(trip())))
                    .build(),
                HttpResponse.BodyHandlers.ofString());
        boolean enabled = "true".equals(settings.get("LAB_MODE"));
        assertEquals(enabled ? 200 : 404, response.statusCode());
        if (enabled) {
          JsonNode body = Json.read(response.body());
          assertEquals(6, body.path("excluded").size());
          assertFalse(Json.str(body, "searchId").isBlank());
        }
        HttpResponse<String> normal =
            client.send(
                HttpRequest.newBuilder(URI.create(base + "/api/search"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(Json.write(trip())))
                    .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, normal.statusCode());
        assertEquals(2, Json.read(normal.body()).path("results").size());
      }
    }
  }
}
