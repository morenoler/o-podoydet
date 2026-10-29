package ru.opodoydet.server.search;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

class SearchHttpContractTest {
  private static ObjectNode trip() {
    return Json.obj("region", "Пусан", "checkIn", "2027-06-10", "checkOut", "2027-06-17",
        "adults", 2, "children", 0, "scenarios", List.of(), "preferences", List.of(), "text", "");
  }

  private static HttpResponse<String> post(HttpClient client, String base, String path, String json) throws Exception {
    return client.send(HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(30))
        .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(json)).build(),
        HttpResponse.BodyHandlers.ofString());
  }

  @Test void typedSearchPreservesValidationLimitsAndOpenApiDescribesIt() throws Exception {
    ObjectNode seed = Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of());
    try (var db = TestDatabases.start(seed, Map.of()); var client = HttpClient.newHttpClient()) {
      String base = "http://127.0.0.1:" + db.port();
      assertEquals(200, post(client, base, "/api/search", Json.write(trip())).statusCode());
      assertEquals(400, post(client, base, "/api/search", Json.write(trip().put("adults", "2"))).statusCode());
      assertEquals(400, post(client, base, "/api/search", Json.write(trip().put("adults", 2.5))).statusCode());
      assertEquals(400, post(client, base, "/api/search", Json.write(trip().put("children", -1))).statusCode());
      var badDates = post(client, base, "/api/search", Json.write(trip().put("checkOut", "2027-06-09")));
      assertEquals(400, badDates.statusCode());
      assertEquals("Дата выезда должна быть позже даты заезда", Json.read(badDates.body()).path("error").asText());
      assertEquals(400, post(client, base, "/api/search", "{}").statusCode());
      var malformed = post(client, base, "/api/search", "{broken}");
      assertEquals(400, malformed.statusCode());
      assertEquals("Некорректный JSON", Json.read(malformed.body()).path("error").asText());
      var notObject = post(client, base, "/api/search", "[]");
      assertEquals(400, notObject.statusCode());
      assertEquals("Ожидается JSON-объект", Json.read(notObject.body()).path("error").asText());
      assertEquals(400, post(client, base, "/api/search", Json.write(trip().put("unused", "x".repeat(25 * 1024)))).statusCode());
      assertEquals(400, post(client, base, "/api/search?pageSize=101", Json.write(trip())).statusCode());
      for (String query : List.of("page=not-a-number&pageSize=10", "pageSize=2147483648", "includeExcluded=invalid")) {
        var invalidParameter = post(client, base, "/api/search?" + query, Json.write(trip()));
        assertEquals(400, invalidParameter.statusCode(), query);
        assertEquals("Некорректный запрос", Json.read(invalidParameter.body()).path("error").asText());
      }
      var compact = post(client, base, "/api/search?includeExcluded=false&page=0&pageSize=10", Json.write(trip()));
      assertEquals(200, compact.statusCode());
      assertEquals(0, Json.read(compact.body()).path("pagination").path("totals").path("excluded").asInt(-1));
      var spec = client.send(HttpRequest.newBuilder(URI.create(base + "/v3/api-docs")).GET().build(), HttpResponse.BodyHandlers.ofString());
      assertEquals(200, spec.statusCode());
      var document = Json.read(spec.body());
      assertTrue(document.path("paths").path("/api/search").path("post").has("requestBody"));
      assertTrue(document.path("components").path("schemas").path("SearchRequest").path("properties").has("region"));
    }
  }
}
