package ru.opodoydet.server.host;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import ru.opodoydet.server.knowledge.Characteristic;
import ru.opodoydet.server.llm.LlmClient;

/** LLM подменена локальным сервером: проверяем протокол и защиту от выдумок. */
class LlmAnswerExtractorTest {

  static final List<Characteristic> CANDIDATES =
      List.of(
          Characteristic.of("courtyard", "room", "host", "boolean"),
          Characteristic.of("beach_walk", "hotel", "route", "meters"));
  static final String ANSWER = "Все окна этой категории во двор. До пляжа минут пять.";

  final ObjectMapper json = new ObjectMapper();
  final AtomicReference<String> request = new AtomicReference<>();
  HttpServer server;

  LlmAnswerExtractor extractorReplying(String content) throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/v1/chat/completions",
        exchange -> {
          request.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
          byte[] body =
              json.writeValueAsBytes(
                  json.createObjectNode()
                      .set(
                          "choices",
                          json.createArrayNode()
                              .add(
                                  json.createObjectNode()
                                      .set("message", json.createObjectNode().put("content", content)))));
          exchange.sendResponseHeaders(200, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    server.start();
    String base = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";
    return new LlmAnswerExtractor(new LlmClient(base, "test-key", "test-model", json));
  }

  @AfterEach
  void stop() {
    if (server != null) server.stop(0);
  }

  @Test
  void acceptsOnlyQuotedAndWellTypedExtractions() throws Exception {
    var extractor =
        extractorReplying(
            """
            {"extractions":[
              {"characteristic":"courtyard","value":true,"quote":"Все окна этой категории во двор","certainty":"high"},
              {"characteristic":"beach_walk","value":400,"quote":"До пляжа минут пять","certainty":"low"},
              {"characteristic":"courtyard","value":false,"quote":"выдуманная цитата","certainty":"high"},
              {"characteristic":"family","value":true,"quote":"Все окна","certainty":"high"},
              {"characteristic":"beach_walk","value":"близко","quote":"До пляжа минут пять","certainty":"low"}
            ]}
            """);

    var found = extractor.extract(ANSWER, CANDIDATES);

    assertThat(found).hasSize(2);
    assertThat(found.get(0).characteristic()).isEqualTo("courtyard");
    assertThat(found.get(0).value().asBoolean()).isTrue();
    assertThat(found.get(0).confidenceLevel()).isEqualTo("high");
    assertThat(found.get(1).value().asLong()).isEqualTo(400);
    // В запросе модели есть и коды характеристик, и сам ответ.
    assertThat(request.get()).contains("courtyard").contains("test-model").contains("минут пять");
  }

  @Test
  void brokenModelOutputGivesNothing() throws Exception {
    assertThat(extractorReplying("это не JSON").extract(ANSWER, CANDIDATES)).isEmpty();
  }

  @Test
  void withoutKeyTheExtractorIsDisabled() {
    var disabled = new LlmAnswerExtractor(new LlmClient("http://127.0.0.1:1", "", "", json));
    assertThat(disabled.enabled()).isFalse();
  }
}
