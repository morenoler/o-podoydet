package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class LegacyJsonModelTest {
  private HttpServer server;
  private final AtomicReference<com.fasterxml.jackson.databind.JsonNode> request = new AtomicReference<>();

  private LegacyJsonModel client(LegacyJsonModel.Protocol protocol, String reply) throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(protocol == LegacyJsonModel.Protocol.RESPONSES ? "/responses" : "/chat/completions", exchange -> {
      request.set(Json.read(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
      byte[] bytes = reply.getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, bytes.length);
      try (var output = exchange.getResponseBody()) { output.write(bytes); }
      catch (IOException closedAfterLimit) { /* bounded client cancelled oversized response */ }
      exchange.close();
    });
    server.start();
    return new LegacyJsonModel("http://127.0.0.1:" + server.getAddress().getPort(), "fixture-key", "fixture-model", protocol);
  }

  @AfterEach void stop() { if (server != null) server.stop(0); }

  @Test void responsesRetainsNamedSchemaAndCompletedContract() throws Exception {
    var model = client(LegacyJsonModel.Protocol.RESPONSES, Json.write(Json.obj("status", "completed", "output", List.of(
        Json.obj("content", List.of(Json.obj("type", "output_text", "text", "{\"ok\":true}")))))));
    assertTrue(model.completeNamed("trip_preferences", "test", Json.obj("text", "synthetic"), Json.obj("type", "object")).path("ok").asBoolean());
    assertEquals("trip_preferences", request.get().path("text").path("format").path("name").asText());
    assertFalse(request.get().path("store").asBoolean());
  }

  @Test void chatRejectsTruncatedAndNonObjectResponses() throws Exception {
    var model = client(LegacyJsonModel.Protocol.CHAT_COMPLETIONS, Json.write(Json.obj("choices", List.of(
        Json.obj("finish_reason", "length", "message", Json.obj("content", "{}"))))));
    assertThrows(IOException.class, () -> model.complete("test", Json.obj(), Json.obj("type", "object")));
  }

  @Test void oversizedLegacyOutputIsBoundedBeforeParsing() throws Exception {
    var model = client(LegacyJsonModel.Protocol.CHAT_COMPLETIONS, " ".repeat(256_001));
    assertThrows(IOException.class, () -> model.complete("test", Json.obj(), Json.obj("type", "object")));
  }
}
