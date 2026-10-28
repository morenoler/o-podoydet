package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class OfflineSearchInterpretationTest {
  @Test
  void configuredModelOutageFallsBackWhileStructuredEditsAndKnownExtractionStayLocal() throws Exception {
    AtomicInteger requests = new AtomicInteger();
    HttpServer endpoint = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    endpoint.createContext("/responses", exchange -> {
      requests.incrementAndGet(); exchange.sendResponseHeaders(500, -1); exchange.close();
    });
    endpoint.start();
    try {
      Agents agents = new Agents(new Agents.Config("test-key", "test-model", "http://127.0.0.1:" + endpoint.getAddress().getPort(), Agents.Protocol.RESPONSES));
      var trip = Json.obj("text", "Тихо и бассейн", "preferences", List.of());
      var interpretation = agents.interpret(trip);
      assertEquals("rules", interpretation.path("mode").asText());
      assertEquals("low_noise", interpretation.path("preferences").path(0).path("feature").asText());
      assertEquals(2, interpretation.path("preferences").size());
      assertEquals("pool", interpretation.path("preferences").path(1).path("feature").asText());
      assertTrue(interpretation.path("warnings").toString().contains("недоступен"));
      for (String message : List.of("Окна во двор", "До пляжа 500 м", "Бассейн с горками", "Ищи «балкон»"))
        assertEquals("rules", new SearchConversation(agents).refine(trip, message, Json.array(List.of())).path("mode").asText());
      assertEquals("rules", agents.extract("Все окна во двор", "courtyard").path("mode").asText());
      assertEquals(2, requests.get(), "Only initial prose and ordinary criterion edits try the configured model; structured filters and known extraction remain local");
    } finally { endpoint.stop(0); }
  }
}
