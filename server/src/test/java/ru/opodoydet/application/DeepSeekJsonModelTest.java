package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class DeepSeekJsonModelTest {
  static final String KEY = "synthetic-test-key";
  static final JsonNode SCHEMA = Json.obj("type", "object", "properties",
      Json.obj("answer", Json.obj("type", "string", "enum", List.of("Да"))),
      "required", List.of("answer"), "additionalProperties", false);

  static String envelope(String content, String reason) {
    return Json.write(Json.obj("choices", List.of(Json.obj("finish_reason", reason,
        "message", Json.obj("role", "assistant", "content", content)))));
  }

  static ProviderSettings config(int port) {
    return ProviderSettings.from(Map.of("AI_PROVIDER", "deepseek", "DEEPSEEK_API_KEY", KEY,
        "DEEPSEEK_BASE_URL", "http://127.0.0.1:" + port, "DEEPSEEK_TIMEOUT_SECONDS", "1"));
  }

  @Test void settingsAreExplicitValidatedAndDoNotExposeKey() {
    assertEquals("legacy", ProviderSettings.from(Map.of("DEEPSEEK_API_KEY", KEY)).provider());
    assertEquals("rules", ProviderSettings.from(Map.of("AI_PROVIDER", "rules", "DEEPSEEK_API_KEY", KEY)).provider());
    assertThrows(IllegalArgumentException.class, () -> ProviderSettings.from(Map.of("AI_PROVIDER", "deepseek")));
    assertFalse(config(1234).toString().contains(KEY));
    for (String base : List.of("https://example.org", "http://api.deepseek.com", "http://localhost:1234",
        "https://api.deepseek.com@evil.test", "https://api.deepseek.com/?key=x", "https://api.deepseek.com/beta")) {
      assertThrows(IllegalArgumentException.class, () -> ProviderSettings.from(Map.of(
          "AI_PROVIDER", "deepseek", "DEEPSEEK_API_KEY", KEY, "DEEPSEEK_BASE_URL", base)));
    }
    for (String key : List.of("DEEPSEEK_TIMEOUT_SECONDS", "DEEPSEEK_MAX_TOKENS"))
      for (String value : List.of("0", "-1", "NaN", "99999999999"))
        assertThrows(IllegalArgumentException.class, () -> ProviderSettings.from(Map.of(
            "AI_PROVIDER", "deepseek", "DEEPSEEK_API_KEY", KEY, key, value)));
  }

  @Test void protocolUsesJsonModeAndValidatesOutput() throws Exception {
    AtomicReference<JsonNode> sent = new AtomicReference<>();
    AtomicReference<String> authorization = new AtomicReference<>();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/chat/completions", exchange -> {
      sent.set(Json.read(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
      authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
      byte[] response = envelope("{\"answer\":\"Да\"}", "stop").getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
      exchange.sendResponseHeaders(200, response.length); exchange.getResponseBody().write(response); exchange.close();
    });
    server.start();
    try {
      JsonNode output = new DeepSeekJsonModel(config(server.getAddress().getPort())).complete("Test", Json.obj("text", "test"), SCHEMA);
      assertEquals("Да", output.path("answer").asText());
      assertEquals("Bearer " + KEY, authorization.get());
      assertEquals("json_object", sent.get().at("/response_format/type").asText());
      assertEquals("disabled", sent.get().at("/thinking/type").asText());
      assertEquals(1200, sent.get().path("max_tokens").asInt());
      assertFalse(sent.get().path("stream").asBoolean());
      assertTrue(sent.get().at("/messages/0/content").asText().contains("JSON schema"));
      assertFalse(sent.get().toString().contains(KEY));
    } finally { server.stop(0); }
  }

  @Test void failuresNeverRetryOrAcceptPartialWrongSchemaOrRedirects() throws Exception {
    AtomicInteger calls = new AtomicInteger();
    AtomicReference<String> body = new AtomicReference<>();
    AtomicInteger status = new AtomicInteger(200);
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", exchange -> {
      calls.incrementAndGet(); exchange.getRequestBody().readAllBytes();
      exchange.getResponseHeaders().set("Content-Type", "application/json");
      exchange.getResponseHeaders().set("Location", "/redirected");
      byte[] bytes = body.get().getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(status.get(), bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
    });
    server.start();
    try {
      DeepSeekJsonModel model = new DeepSeekJsonModel(config(server.getAddress().getPort()));
      for (String bad : List.of("[]", "null", "{}", "not JSON", envelope("{}", "stop"),
          envelope("{\"answer\":\"Да\"}", "length"), envelope("{\"answer\":\"invented\"}", "stop"),
          envelope("{\"answer\":\"Да\",\"extra\":true}", "stop"),
          envelope("{\"answer\":\"Да\",\"answer\":\"Да\"}", "stop"),
          envelope("{\"answer\":\"Да\"} {}", "stop"), " ".repeat(128 * 1024 + 1))) {
        body.set(bad); int before = calls.get();
        assertThrows(IOException.class, () -> model.complete("test", Json.obj(), SCHEMA));
        assertEquals(before + 1, calls.get());
      }
      for (int code : List.of(302, 307, 401, 402, 429, 500, 503)) {
        status.set(code); body.set(KEY); int before = calls.get();
        IOException error = assertThrows(IOException.class, () -> model.complete("test", Json.obj(), SCHEMA));
        assertFalse(error.toString().contains(KEY)); assertNull(error.getCause());
        assertEquals(before + 1, calls.get());
      }
      int before = calls.get();
      assertThrows(IllegalArgumentException.class, () -> model.complete("test", Json.obj(), Json.obj("type", "object", "patternProperties", Json.obj())));
      assertThrows(IOException.class, () -> model.complete("test", Json.obj("text", "x".repeat(24_001)), SCHEMA));
      assertEquals(before, calls.get());
    } finally { server.stop(0); }
  }

  @Test void schemaSupportsHostBooleansAndMetersWithoutWeakCoercion() {
    var schema = Json.obj("type", "object", "additionalProperties", false, "properties", Json.obj(
        "value", Json.obj("anyOf", List.of(Json.obj("type", "boolean"), Json.obj("type", "integer")))), "required", List.of("value"));
    var valid = ModelSchema.compile(schema);
    assertTrue(valid.test(Json.obj("value", true))); assertTrue(valid.test(Json.obj("value", 100)));
    assertFalse(valid.test(Json.obj("value", "true"))); assertFalse(valid.test(Json.obj("value", 1.5)));
    assertFalse(valid.test(Json.obj("value", true, "extra", "x")));
  }

  @Test void explicitRulesDisableEveryModelEvenWithLegacyAndRemoteKeys() {
    Map<String, String> env = Map.of("AI_PROVIDER", "rules", "DEEPSEEK_API_KEY", KEY,
        "LLM_API_KEY", KEY, "LLM_MODEL", "old", "ADVISOR_LOCAL_MODEL", "old");
    assertFalse(new Agents(Agents.Config.from(env)).enabled());
    assertNull(ProviderSettings.from(env).structured());
    assertFalse(new ru.opodoydet.server.llm.LlmClient(
        new ru.opodoydet.server.config.DomainConfig.RuntimeEnv(env), new com.fasterxml.jackson.databind.ObjectMapper()).enabled());
  }

  @Test void timeoutCoversAStalledResponseBody() throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    AtomicInteger calls = new AtomicInteger();
    server.createContext("/chat/completions", exchange -> {
      calls.incrementAndGet(); exchange.getRequestBody().readAllBytes();
      exchange.getResponseHeaders().set("Content-Type", "application/json");
      exchange.sendResponseHeaders(200, 0);
      exchange.getResponseBody().write('\n'); exchange.getResponseBody().flush();
      try { Thread.sleep(1600); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
      exchange.close();
    });
    server.start();
    try {
      long started = System.nanoTime();
      IOException error = assertThrows(IOException.class, () -> new DeepSeekJsonModel(config(server.getAddress().getPort()))
          .complete("test", Json.obj(), SCHEMA));
      assertTrue(error.getMessage().contains("timeout"));
      assertTrue(System.nanoTime() - started < java.time.Duration.ofSeconds(3).toNanos());
      assertEquals(1, calls.get());
    } finally { server.stop(0); }
  }
}
