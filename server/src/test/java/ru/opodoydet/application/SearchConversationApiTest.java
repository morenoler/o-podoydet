package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.server.support.TestDatabases.Database;
import ru.opodoydet.shared.Json;

class SearchConversationApiTest {
  @TempDir Path directory;

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
        0,
        "preferences",
        List.of(),
        "scenarios",
        List.of(),
        "text",
        "");
  }

  private static ObjectNode catalog() {
    String observed = Instant.now().minusSeconds(60).toString();
    String expires = Instant.now().plusSeconds(365L * 24 * 3600).toString();
    List<JsonNode> hotels = new ArrayList<>(), facts = new ArrayList<>();
    for (String id : List.of("courtyard", "street")) {
      hotels.add(
          Json.obj(
              "id",
              id,
              "name",
              id,
              "lodgingType",
              "hotel",
              "coordinates",
              List.of(129.16, 35.16),
              "rooms",
              List.of(
                  Json.obj(
                      "id",
                      id + "-room",
                      "name",
                      "Test room",
                      "capacity",
                      2,
                      "demo",
                      false,
                      "evidenceStatus",
                      "verified",
                      "sourceUrl",
                      "https://example.org/test-rooms",
                      "quote",
                      "Synthetic test room category",
                      "obtainedAt",
                      observed)),
              "route",
              null,
              "noise",
              List.of()));
      facts.add(
          Json.obj(
              "id",
              id + "-fact",
              "hotelId",
              id,
              "roomId",
              id + "-room",
              "feature",
              "courtyard",
              "value",
              id.equals("courtyard"),
              "method",
              "official",
              "demo",
              false,
              "sourceUrl",
              "https://example.org/test-rooms",
              "quote",
              "Synthetic test evidence",
              "obtainedAt",
              observed,
              "expiresAt",
              expires));
    }
    return Json.obj(
        "region", "Пусан", "evidencePolicy", "verified-only", "hotels", hotels, "facts", facts);
  }

  private final HttpClient client =
      HttpClient.newBuilder()
          .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL))
          .build();

  private HttpResponse<String> post(Database api, String path, JsonNode payload) throws Exception {
    return client.send(
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + api.port() + path))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(Json.write(payload)))
            .build(),
        HttpResponse.BodyHandlers.ofString());
  }

  private JsonNode success(Database api, String path, JsonNode payload) throws Exception {
    HttpResponse<String> response = post(api, path, payload);
    assertEquals(200, response.statusCode(), response.body());
    return Json.read(response.body());
  }

  private JsonNode say(Database api, JsonNode trip, String message) throws Exception {
    return success(api, "/api/search/conversation", Json.obj("trip", trip, "message", message));
  }

  @Test
  void conversationChangesTheRealSearchAndRemovalSurvivesAnotherSearch() throws Exception {
    try (Database api =
        TestDatabases.start(catalog(), Map.of("LLM_MODEL", "", "LLM_API_KEY", ""))) {
      ObjectNode initial = trip();
      assertEquals(2, success(api, "/api/search", initial).path("results").size());

      JsonNode required = say(api, initial, "Обязательно окна во двор").path("trip");
      JsonNode narrowed = success(api, "/api/search", required);
      assertEquals(1, narrowed.path("results").size());
      assertEquals("courtyard", narrowed.path("results").path(0).path("hotel").path("id").asText());
      assertEquals(1, narrowed.path("excluded").size());

      JsonNode optional = say(api, required, "Окна во двор не обязательны").path("trip");
      JsonNode relaxed = success(api, "/api/search", optional);
      assertEquals(2, relaxed.path("results").size());
      assertFalse(relaxed.path("preferences").path(0).path("required").asBoolean());

      ObjectNode withOldText = (ObjectNode) required.deepCopy();
      withOldText.put("text", "Обязательно окна во двор");
      JsonNode removed = say(api, withOldText, "Убери условие про двор").path("trip");
      for (int repeat = 0; repeat < 2; repeat++) {
        JsonNode restored = success(api, "/api/search", removed);
        assertEquals(2, restored.path("results").size());
        assertTrue(restored.path("preferences").isEmpty());
        assertTrue(restored.path("conflicts").isEmpty());
      }
      assertEquals("Обязательно окна во двор", removed.path("text").asText());
      for (String field : List.of("region", "checkIn", "checkOut", "adults", "children"))
        assertEquals(initial.path(field), removed.path(field));
    }
  }

  @Test
  void endpointAcceptsPreDateWishesButRejectsMalformedContextAndEmptyMessages() throws Exception {
    try (Database api =
        TestDatabases.start(catalog(), Map.of("LLM_MODEL", "", "LLM_API_KEY", ""))) {
      ObjectNode draft = trip().put("checkIn", "").put("checkOut", "");
      JsonNode accepted = say(api, draft, "Окна во двор");
      assertTrue(accepted.path("changed").asBoolean());
      assertTrue(accepted.path("trip").path("checkIn").asText().isEmpty());
      assertEquals(400, post(api, "/api/search", accepted.path("trip")).statusCode());
      assertEquals(
          400,
          post(api, "/api/search/conversation", Json.obj("trip", draft, "message", "  "))
              .statusCode());
      assertEquals(
          400,
          post(
                  api,
                  "/api/search/conversation",
                  Json.obj("trip", draft, "message", "x".repeat(1501)))
              .statusCode());
      assertEquals(
          400,
          post(
                  api,
                  "/api/search/conversation",
                  Json.obj(
                      "trip",
                      draft,
                      "message",
                      "Это обязательно",
                      "focusFeatures",
                      List.of("pool")))
              .statusCode());
      draft.set(
          "preferenceOverrides",
          Json.array(
              List.of(Json.obj("feature", "courtyard", "required", false, "enabled", "yes"))));
      assertEquals(
          400,
          post(api, "/api/search/conversation", Json.obj("trip", draft, "message", "Окна во двор"))
              .statusCode());
    }
  }

  @Test
  void exploreKeepsUnknownRoomsAsAlternativesAndChatStillExcludesConfirmedMismatches()
      throws Exception {
    try (Database api =
        TestDatabases.start(catalog(), Map.of("LLM_MODEL", "", "LLM_API_KEY", ""))) {
      ObjectNode initial = trip().put("admissionMode", "explore");
      JsonNode family = say(api, initial, "Обязательно семейный номер").path("trip");
      JsonNode provisional = success(api, "/api/search", family);
      assertEquals("explore", provisional.path("admissionMode").asText());
      assertTrue(provisional.path("roomRecommendations").isEmpty());
      assertEquals(2, provisional.path("roomAlternatives").size());
      for (JsonNode item : provisional.path("roomAlternatives")) {
        assertTrue(item.path("room").path("provisional").asBoolean());
        assertEquals(
            "unknown", item.path("room").path("criteria").get(0).path("evidenceStatus").asText());
      }
      JsonNode courtyard = say(api, family, "И обязательно окна во двор").path("trip");
      JsonNode narrowed = success(api, "/api/search", courtyard);
      assertTrue(narrowed.path("roomRecommendations").isEmpty());
      assertEquals(1, narrowed.path("roomAlternatives").size());
      assertEquals(
          "courtyard", narrowed.path("roomAlternatives").get(0).path("hotel").path("id").asText());

      ObjectNode verified = courtyard.deepCopy();
      verified.put("admissionMode", "verified");
      JsonNode strict = success(api, "/api/search", verified);
      assertTrue(strict.path("roomRecommendations").isEmpty());
      assertTrue(strict.path("roomAlternatives").isEmpty());
    }
  }

  private static String modelEnvelope(String text) {
    return Json.write(
        Json.obj(
            "status",
            "completed",
            "output",
            List.of(Json.obj("content", List.of(Json.obj("type", "output_text", "text", text))))));
  }

  @Test
  void validatedModelEditsUseCurrentPreferencesAndDoNotChangeTripDetails() throws Exception {
    AtomicReference<JsonNode> request = new AtomicReference<>();
    AtomicInteger calls = new AtomicInteger();
    HttpServer model = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    model.createContext(
        "/responses",
        exchange -> {
          calls.incrementAndGet();
          request.set(
              Json.read(
                  new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
          byte[] body =
              modelEnvelope(
                      Json.write(
                          Json.obj(
                              "updates",
                              List.of(Json.obj("feature", "courtyard", "action", "required")),
                              "unhandled",
                              List.of())))
                  .getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    model.start();
    try {
      Agents configured =
          new Agents(
              new Agents.Config(
                  "test-key", "test-model", "http://127.0.0.1:" + model.getAddress().getPort()));
      ObjectNode initial = trip();
      initial.set(
          "preferences", Json.array(List.of(Json.obj("feature", "family", "required", true))));
      JsonNode response =
          new SearchConversation(configured)
              .refine(initial, "И окна непременно во внутренний двор", Json.array(List.of()));
      assertEquals("llm", response.path("mode").asText());
      assertTrue(response.path("warnings").isEmpty());
      assertEquals(2, response.path("trip").path("preferences").size());
      assertTrue(response.path("trip").path("preferences").path(0).path("required").asBoolean());
      assertEquals("courtyard", response.path("focusFeatures").path(0).asText());
      for (String field : List.of("region", "checkIn", "checkOut", "adults", "children", "text"))
        assertEquals(initial.path(field), response.path("trip").path(field));
      JsonNode modelInput = Json.read(request.get().path("input").asText());
      assertEquals(initial.path("preferences"), modelInput.path("preferences"));
      assertEquals(
          "search_conversation", request.get().path("text").path("format").path("name").asText());
      assertEquals(1, calls.get());
    } finally {
      model.stop(0);
    }
  }

  @Test
  void malformedUnknownDuplicateOrInvalidModelEditsFallBackExplicitly() throws Exception {
    AtomicReference<String> output = new AtomicReference<>();
    AtomicInteger calls = new AtomicInteger();
    HttpServer model = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    model.createContext(
        "/responses",
        exchange -> {
          calls.incrementAndGet();
          exchange.getRequestBody().readAllBytes();
          byte[] body = modelEnvelope(output.get()).getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    model.start();
    try {
      SearchConversation chat =
          new SearchConversation(
              new Agents(
                  new Agents.Config(
                      "test-key",
                      "test-model",
                      "http://127.0.0.1:" + model.getAddress().getPort())));
      List<String> badOutputs =
          List.of(
              "broken-json",
              Json.write(
                  Json.obj(
                      "updates",
                      List.of(Json.obj("feature", "pool", "action", "add")),
                      "unhandled",
                      List.of())),
              Json.write(
                  Json.obj(
                      "updates",
                      List.of(Json.obj("feature", "courtyard", "action", "replace")),
                      "unhandled",
                      List.of())),
              Json.write(
                  Json.obj(
                      "updates",
                      List.of(
                          Json.obj("feature", "courtyard", "action", "add"),
                          Json.obj("feature", "courtyard", "action", "remove")),
                      "unhandled",
                      List.of())));
      for (String invalid : badOutputs) {
        output.set(invalid);
        JsonNode response = chat.refine(trip(), "Хочу окна во двор", Json.array(List.of()));
        assertEquals("rules", response.path("mode").asText(), invalid);
        assertTrue(response.path("changed").asBoolean());
        assertFalse(response.path("warnings").isEmpty());
        assertEquals(1, response.path("trip").path("preferences").size());
        assertEquals(
            "courtyard",
            response.path("trip").path("preferences").path(0).path("feature").asText());
      }
      assertEquals(badOutputs.size(), calls.get());
    } finally {
      model.stop(0);
    }
  }
}
