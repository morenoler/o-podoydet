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
  void configuredProviderReceivesNoOrdinarySearchChatOrKnownExtractionRequests() throws Exception {
    AtomicInteger requests = new AtomicInteger();
    HttpServer endpoint = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    endpoint.createContext("/responses", exchange -> {
      requests.incrementAndGet(); exchange.sendResponseHeaders(500, -1); exchange.close();
    });
    endpoint.start();
    try {
      Agents agents = new Agents(new Agents.Config("test-key", "test-model", "http://127.0.0.1:" + endpoint.getAddress().getPort()));
      var trip = Json.obj("text", "Тихо и бассейн", "preferences", List.of());
      var interpretation = agents.interpret(trip);
      assertEquals("rules", interpretation.path("mode").asText());
      assertEquals("low_noise", interpretation.path("preferences").path(0).path("feature").asText());
      assertEquals(1, interpretation.path("preferences").size());
      for (String message : List.of("Окна во двор", "До пляжа 500 м", "Бассейн с горками", "Ищи «балкон»"))
        assertEquals("rules", new SearchConversation(agents).refine(trip, message, Json.array(List.of())).path("mode").asText());
      assertEquals("rules", agents.extract("Все окна во двор", "courtyard").path("mode").asText());
      assertEquals(0, requests.get());
    } finally { endpoint.stop(0); }
  }
}
