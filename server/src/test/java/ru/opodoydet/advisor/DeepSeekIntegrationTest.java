package ru.opodoydet.advisor;

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
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import ru.opodoydet.application.Agents;
import ru.opodoydet.application.places.PlaceSearch;
import ru.opodoydet.server.host.LlmAnswerExtractor;
import ru.opodoydet.server.knowledge.Characteristic;
import ru.opodoydet.server.llm.LlmClient;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

/** Actual Spring/PostgreSQL/Python bridge, with an entirely local provider fixture. */
class DeepSeekIntegrationTest {
  private static final String KEY = "synthetic-deepseek-key";
  private static final String HOST_REPLY = "Вымышленный ответ для теста: окна во двор.";

  private static ObjectNode trip() {
    return Json.obj("region", "Пусан", "checkIn", "2027-06-10", "checkOut", "2027-06-17",
        "adults", 2, "children", 0, "preferences", List.of(), "scenarios", List.of(), "text", "");
  }
  private static ObjectNode seed() {
    return Json.obj("region", "Пусан", "evidencePolicy", "demo", "hotels", List.of(Json.obj(
        "id", "synthetic-deepseek-hotel", "name", "Вымышленный тестовый отель", "demo", true,
        "lodgingType", "hotel", "rooms", List.of(Json.obj("id", "synthetic-room", "name", "Тестовая категория",
            "capacity", 4, "demo", true)), "route", Json.obj("meters", 500))), "facts", List.of(), "map", List.of());
  }

  private static final class Provider implements AutoCloseable {
    final HttpServer server;
    final List<JsonNode> requests = new CopyOnWriteArrayList<>();
    final List<String> authorizations = new CopyOnWriteArrayList<>();
    final AtomicInteger status = new AtomicInteger(200);
    Provider() throws Exception {
      server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      server.createContext("/", exchange -> {
        JsonNode request = Json.read(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        requests.add(request);
        authorizations.add(exchange.getRequestHeaders().getFirst("Authorization"));
        String system = request.at("/messages/0/content").asText();
        JsonNode schema = request.has("format") ? request.path("format")
            : request.at("/response_format/json_schema/schema").isObject()
                ? request.at("/response_format/json_schema/schema")
                : Json.read(system.substring(system.lastIndexOf('\n') + 1));
        JsonNode input = Json.read(request.at("/messages/1/content").asText());
        JsonNode output = answer(schema.path("properties"), input);
        ObjectNode envelope = Json.obj("choices", List.of(Json.obj("finish_reason", "stop", "message",
            Json.obj("role", "assistant", "content", Json.write(output)))),
            "usage", Json.obj("prompt_tokens", 20, "completion_tokens", 5));
        if (request.has("format")) envelope = Json.obj("done", true, "done_reason", "stop", "message",
            Json.obj("role", "assistant", "content", Json.write(output)));
        byte[] body = Json.write(envelope).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status.get(), body.length);
        exchange.getResponseBody().write(body); exchange.close();
      });
      server.start();
    }
    Map<String, String> env() {
      return Map.of("AI_PROVIDER", "deepseek", "DEEPSEEK_API_KEY", KEY,
          "DEEPSEEK_BASE_URL", "http://127.0.0.1:" + server.getAddress().getPort(),
          "DEEPSEEK_TIMEOUT_SECONDS", "5", "ADVISOR_LOCAL_MODEL", "must-not-call-local",
          "ADVISOR_ROOT", java.nio.file.Path.of(System.getProperty("basedir")).getParent().toString(),
          "ADVISOR_LOCAL_BASE_URL", "http://127.0.0.1:1/v1", "LLM_API_KEY", "must-not-use-legacy-key",
          "LLM_MODEL", "must-not-call-legacy", "LLM_BASE_URL", "http://127.0.0.1:1/v1");
    }
    private static JsonNode answer(JsonNode properties, JsonNode input) {
      if (properties.has("candidateIds")) return Json.obj("candidateIds", List.of(input.at("/candidates/0/id").asText()),
          "scenarioIds", List.of(), "questionId", null);
      if (properties.has("cautions")) {
        ObjectNode cautions = Json.obj();
        for (JsonNode candidate : input.path("candidates")) {
          List<String> risky = new ArrayList<>();
          for (JsonNode criterion : candidate.path("criteria"))
            if (criterion.path("assumed").asBoolean() || !Json.str(criterion, "status").equals("match")
                || !Json.str(criterion, "evidenceStatus").equals("match")) risky.add(Json.str(criterion, "id"));
          cautions.set(Json.str(candidate, "id"), Json.array(risky));
        }
        return Json.obj("cautions", cautions);
      }
      if (properties.has("remainingText")) return Json.obj("updates", List.of(Json.obj("query", "supermarket", "relation", "near",
          "action", "add", "quote", Json.str(input, "message"))), "remainingText", "");
      if (properties.has("preferences")) return Json.obj("preferences", List.of(Json.obj("feature", "wifi", "required", true)),
          "excluded", List.of(), "warnings", List.of());
      if (properties.has("updates")) return Json.obj("updates", List.of(Json.obj("feature", "wifi", "action", "required")), "unhandled", List.of());
      if (properties.has("warnings")) return Json.obj("extractions", List.of(), "warnings", List.of("Нужно уточнение."));
      return Json.obj("extractions", List.of(Json.obj("characteristic", "courtyard", "value", true,
          "quote", "окна во двор", "certainty", "high")));
    }
    public void close() { server.stop(0); }
  }

  private static JsonNode request(HttpClient client, String base, String path, JsonNode body) throws Exception {
    var builder = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(20));
    if (body == null) builder.GET();
    else builder.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(Json.write(body)));
    var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    assertEquals(body != null && path.equals("/api/advisor/runs") ? 202 : 200, response.statusCode(), response.body());
    return Json.read(response.body());
  }
  private static JsonNode waitForRun(HttpClient client, String base, String id) throws Exception {
    long deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos();
    JsonNode run;
    do {
      run = request(client, base, "/api/advisor/runs/" + id, null);
      if (!List.of("queued", "running").contains(Json.str(run, "status"))) return run;
      Thread.sleep(20);
    } while (System.nanoTime() < deadline);
    fail("Advisor did not finish: " + run); return run;
  }

  @Test void oneSettingSelectsDeepSeekForAllPathsAndKeepsOwnedHistoryAndFallback() throws Exception {
    try (Provider provider = new Provider(); var database = TestDatabases.start(seed(), provider.env())) {
      var context = database.context();
      Agents agents = context.getBean(Agents.class);
      assertEquals("deepseek", agents.mode());
      assertEquals("deepseek", Json.str(agents.interpret(trip().put("text", "Обязательно Wi-Fi")), "mode"));
      assertEquals("deepseek", Json.str(agents.extract("Synthetic ambiguous public answer", "family"), "mode"));
      var places = context.getBean(PlaceSearch.class).refine(trip(), "Утром забежать за продуктами поблизости");
      assertEquals("deepseek", Json.str(places, "mode"));
      assertEquals("supermarket", places.at("/locationWishes/0/query").asText());
      assertTrue(context.getBean(LlmClient.class).enabled());
      assertEquals("deepseek-flash", context.getBean(LlmClient.class).model());
      var facts = context.getBean(LlmAnswerExtractor.class).extract(HOST_REPLY,
          List.of(Characteristic.of("courtyard", "room", "host", "boolean")));
      assertEquals(1, facts.size());
      assertEquals("окна во двор", facts.getFirst().quote());

      String base = "http://127.0.0.1:" + database.port();
      HttpClient client = HttpClient.newBuilder().cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();
      JsonNode config = request(client, base, "/api/advisor/config", null);
      assertEquals("deepseek", Json.str(config, "defaultMode"));
      assertEquals(Json.array(List.of("rules", "local", "deepseek")), config.path("modes"));
      assertFalse(config.toString().contains(KEY));
      var conversation = request(client, base, "/api/search/conversation",
          Json.obj("trip", trip(), "message", "Обязательно Wi-Fi", "focusFeatures", List.of()));
      assertEquals("deepseek", Json.str(conversation, "mode"));

      JsonNode trip = trip();
      String searchId = Json.str(request(client, base, "/api/search", trip), "searchId");
      int before = provider.requests.size();
      JsonNode started = request(client, base, "/api/advisor/runs", Json.obj("trip", trip, "searchId", searchId, "mode", "deepseek"));
      String id = Json.str(started, "id");
      JsonNode run = waitForRun(client, base, id);
      assertEquals("completed", Json.str(run, "status"), run.toString());
      assertEquals("deepseek", Json.str(run, "execution"), run.toString());
      assertEquals(2, run.path("modelCalls").asInt());
      assertEquals(40, run.path("inputTokens").asInt());
      assertEquals(10, run.path("outputTokens").asInt());
      assertEquals(before + 2, provider.requests.size());
      assertEquals("deepseek", database.store().advisorRun(id).path("mode").asText());
      assertFalse(run.toString().contains(KEY));
      assertFalse(provider.requests.toString().contains(searchId));
      assertTrue(provider.authorizations.stream().allMatch(v -> v.equals("Bearer " + KEY)));
      var foreign = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(base + "/api/advisor/runs/" + id)).GET().build(), HttpResponse.BodyHandlers.ofString());
      assertTrue(foreign.statusCode() == 403 || foreign.statusCode() == 404);

      provider.status.set(429);
      assertEquals("rules", Json.str(agents.interpret(trip().put("text", "Обязательно Wi-Fi")), "mode"));
      before = provider.requests.size();
      started = request(client, base, "/api/advisor/runs", Json.obj("trip", trip, "searchId", searchId, "mode", "deepseek"));
      run = waitForRun(client, base, Json.str(started, "id"));
      assertEquals("rules_fallback", Json.str(run, "execution"), run.toString());
      assertEquals(1, run.path("modelCalls").asInt());
      assertEquals(before + 1, provider.requests.size());
      before = provider.requests.size();
      started = request(client, base, "/api/advisor/runs", Json.obj("trip", trip, "searchId", searchId, "mode", "rules"));
      run = waitForRun(client, base, Json.str(started, "id"));
      assertEquals("rules", Json.str(run, "execution"));
      assertEquals(before, provider.requests.size());
    }
  }

  @Test void browserChoiceRoutesJavaAndPythonIndependentlyWithoutLeakingRemoteCredentials() throws Exception {
    try (Provider remote = new Provider(); Provider local = new Provider()) {
      var env = new java.util.HashMap<>(remote.env());
      env.put("AI_PROVIDER", "local");
      env.put("ADVISOR_LOCAL_MODEL", "synthetic-local");
      env.put("ADVISOR_LOCAL_BASE_URL", "http://127.0.0.1:" + local.server.getAddress().getPort() + "/v1");
      try (var database = TestDatabases.start(seed(), env)) {
        String base = "http://127.0.0.1:" + database.port();
        HttpClient client = HttpClient.newBuilder().cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build();
        var config = request(client, base, "/api/ai/config", null);
        assertEquals("local", config.path("defaultProvider").asText());
        assertTrue(config.path("providers").get(0).path("available").asBoolean());
        assertTrue(config.path("providers").get(1).path("available").asBoolean());
        assertFalse(config.toString().contains(KEY));
        // Two concurrent HTTP requests hit the same singleton services with distinct provider scopes.
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
          var futures = List.of("local", "deepseek").stream().map(mode -> executor.submit(() -> {
            var response = client.send(HttpRequest.newBuilder(URI.create(base + "/api/search/conversation"))
                .header("X-AI-Provider", mode).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(Json.write(Json.obj("trip", trip(),
                    "message", "Обязательно Wi-Fi", "focusFeatures", List.of())))).build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, response.statusCode(), response.body());
            assertEquals(mode.equals("local") ? "local_model" : "deepseek", Json.read(response.body()).path("mode").asText());
            return true;
          })).toList();
          for (var future : futures) assertTrue(future.get(20, java.util.concurrent.TimeUnit.SECONDS));
        }
        assertFalse(remote.requests.isEmpty());
        assertFalse(local.requests.isEmpty());
        var selection = database.context().getBean(ru.opodoydet.application.ProviderSelection.class);
        for (String mode : List.of("deepseek", "local")) {
          try (var scope = selection.select(mode)) {
            var places = database.context().getBean(PlaceSearch.class).refine(trip(), "Утром забежать за продуктами поблизости");
            assertEquals(mode.equals("local") ? "local_model" : mode, places.path("mode").asText());
            var facts = database.context().getBean(LlmAnswerExtractor.class).extract(HOST_REPLY,
                List.of(Characteristic.of("courtyard", "room", "host", "boolean")));
            assertEquals(1, facts.size());
          }
          var selectedConfig = client.send(HttpRequest.newBuilder(URI.create(base + "/api/advisor/config"))
              .header("X-AI-Provider", mode).GET().build(), HttpResponse.BodyHandlers.ofString());
          assertEquals(mode, Json.read(selectedConfig.body()).path("defaultMode").asText());
        }
        var defaultConfig = request(client, base, "/api/advisor/config", null);
        assertEquals("local", defaultConfig.path("defaultMode").asText());
        String searchId = request(client, base, "/api/search", trip()).path("searchId").asText();
        for (String mode : List.of("deepseek", "local")) {
          int remoteBefore = remote.requests.size(), localBefore = local.requests.size();
          var started = request(client, base, "/api/advisor/runs", Json.obj("trip", trip(), "searchId", searchId, "mode", mode));
          var run = waitForRun(client, base, started.path("id").asText());
          assertEquals("completed", run.path("status").asText(), run.toString());
          assertEquals(mode, run.path("execution").asText(), run.toString());
          assertEquals(mode.equals("local") ? "synthetic-local" : "deepseek-flash", run.path("model").asText());
          assertEquals(2, run.path("modelCalls").asInt());
          assertEquals(remoteBefore + (mode.equals("deepseek") ? 2 : 0), remote.requests.size());
          assertEquals(localBefore + (mode.equals("local") ? 2 : 0), local.requests.size());
          assertFalse(run.toString().contains(KEY));
        }
        assertTrue(local.authorizations.stream().allMatch(java.util.Objects::isNull));
        assertFalse(local.requests.toString().contains(KEY));
        assertTrue(remote.authorizations.stream().allMatch(value -> ("Bearer " + KEY).equals(value)));
        int calls = remote.requests.size() + local.requests.size();
        var invalid = client.send(HttpRequest.newBuilder(URI.create(base + "/api/search/conversation"))
            .header("X-AI-Provider", "invalid").header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString("{}")).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(400, invalid.statusCode());
        assertEquals(calls, remote.requests.size() + local.requests.size());
      }
    }
  }
}
