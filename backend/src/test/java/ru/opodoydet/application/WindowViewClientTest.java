package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;
import ru.opodoydet.web.Api;

class WindowViewClientTest {
  private static ObjectNode request() {
    return Json.obj(
        "hotel", Json.obj("id", "osm:way:42", "lat", 35.16, "lon", 129.16),
        "floor", 7, "date", "2026-10-24", "utc_offset_minutes", 540,
        "data_mode", "cached", "scene_id", "busan-haeundae");
  }

  private static ObjectNode response() {
    return Json.obj(
        "schema_version", "1.0", "actual_visibility_confirmed", false,
        "is_demo", false, "room_resolution", Json.obj("scope", "hotel_floor_scenarios"),
        "assessments", List.of(Json.obj("status", "unknown", "visible_in_model", null)),
        "sources", List.of(Json.obj("id", "open-source")),
        "limitations", List.of("Window direction unknown"));
  }

  private static final class Upstream implements AutoCloseable {
    final HttpServer server;
    final java.util.concurrent.ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    final AtomicInteger calls = new AtomicInteger();
    final AtomicReference<JsonNode> received = new AtomicReference<>();

    Upstream(int status, String type, String body, long delayMs) throws Exception {
      server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      server.setExecutor(executor);
      server.createContext("/", exchange -> {
        calls.incrementAndGet();
        assertEquals("/v1/views/estimate", exchange.getRequestURI().getPath());
        assertEquals("POST", exchange.getRequestMethod());
        received.set(Json.MAPPER.readTree(exchange.getRequestBody()));
        exchange.getResponseHeaders().set("Content-Type", type);
        exchange.getResponseHeaders().set("Location", "/redirect-must-not-follow");
        exchange.sendResponseHeaders(status, 0); // Exercise streaming without a known length.
        try {
          if (delayMs > 0) {
            exchange.getResponseBody().write(' ');
            exchange.getResponseBody().flush();
            Thread.sleep(delayMs);
          }
          exchange.getResponseBody().write(body.getBytes(StandardCharsets.UTF_8));
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
        } finally {
          exchange.close();
        }
      });
      server.start();
    }

    WindowViewClient client(Duration timeout, int limit) {
      return new WindowViewClient(origin(), timeout, limit);
    }

    String origin() {
      return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @Override public void close() {
      server.stop(0);
      executor.shutdownNow();
    }
  }

  @Test void passesFullPayloadAndUnknownEvidenceWithoutChangingIt() throws Exception {
    ObjectNode input = request();
    input.set("room", Json.obj("id", "user-room", "window", Json.obj("bearing_deg", 180)));
    try (Upstream upstream = new Upstream(200, "application/json; charset=utf-8", Json.write(response()), 0);
         WindowViewClient client = upstream.client(Duration.ofSeconds(3), 4096)) {
      WindowViewClient.Result result = client.estimate(input);
      assertEquals(200, result.status());
      assertEquals(response(), result.body());
      assertEquals(input, upstream.received.get());
      assertTrue(result.body().path("assessments").get(0).path("visible_in_model").isNull());
    }
  }

  @Test void requiresAnExplicitIntegralFloorAndRejectsInvalidGroundNumber() throws Exception {
    try (Upstream upstream = new Upstream(200, "application/json", Json.write(response()), 0);
         WindowViewClient client = upstream.client(Duration.ofSeconds(3), 4096)) {
      for (JsonNode invalid : List.of(Json.obj(), Json.obj("floor", true), Json.obj("floor", "7"),
          Json.obj("floor", 1.5), Json.obj("floor", 101), Json.obj("floor", 0),
          Json.obj("floor", 1, "ground_floor_number", false),
          Json.obj("floor", 1, "ground_floor_number", 0.5)))
        assertThrows(IllegalArgumentException.class, () -> client.estimate(invalid));
      assertEquals(0, upstream.calls.get());
      assertEquals(200, client.estimate(request().put("floor", 0).put("ground_floor_number", 0)).status());
    }
  }

  @Test void doesNotContactUpstreamForAnOversizedRequest() throws Exception {
    try (Upstream upstream = new Upstream(200, "application/json", Json.write(response()), 0);
         WindowViewClient client = upstream.client(Duration.ofSeconds(3), 4096)) {
      assertEquals(413, client.estimate(request().put("padding", "а".repeat(17000))).status());
      assertEquals(0, upstream.calls.get());
    }
  }

  @Test void preservesUsefulUpstreamErrors() throws Exception {
    for (int status : List.of(403, 422, 429, 502, 503)) {
      ObjectNode error = Json.obj("error", "source_cache_missing", "detail", "Use a packaged scene");
      try (Upstream upstream = new Upstream(status, "application/json", Json.write(error), 0);
           WindowViewClient client = upstream.client(Duration.ofSeconds(3), 4096)) {
        WindowViewClient.Result result = client.estimate(request());
        assertEquals(status, result.status());
        assertEquals(error, result.body());
      }
    }
  }

  @Test void rejectsUnsupportedAndMalformedResponses() throws Exception {
    for (String body : List.of("not json", "null", "[]", Json.write(response()) + " {}",
        Json.write(response().put("actual_visibility_confirmed", true)),
        Json.write(response().put("schema_version", "2.0")),
        Json.write(response().put("is_demo", "false")))) {
      try (Upstream upstream = new Upstream(200, "application/json", body, 0);
           WindowViewClient client = upstream.client(Duration.ofSeconds(3), 4096)) {
        assertEquals(502, client.estimate(request()).status(), body);
      }
    }
  }

  @Test void rejectsHtmlAndRedirectsWithoutFollowingThem() throws Exception {
    for (int status : List.of(200, 302, 500)) {
      try (Upstream upstream = new Upstream(status, status == 200 ? "text/html" : "application/json",
          Json.write(response()), 0);
           WindowViewClient client = upstream.client(Duration.ofSeconds(3), 4096)) {
        assertEquals(502, client.estimate(request()).status());
        assertEquals(1, upstream.calls.get());
      }
    }
  }

  @Test void boundsChunkedUpstreamBody() throws Exception {
    try (Upstream upstream = new Upstream(200, "application/json", Json.write(response()), 0);
         WindowViewClient client = upstream.client(Duration.ofSeconds(3), 64)) {
      assertEquals(502, client.estimate(request()).status());
    }
  }

  @Test void deadlineIncludesSlowResponseBodyAfterHeaders() throws Exception {
    try (Upstream upstream = new Upstream(200, "application/json", Json.write(response()), 2500);
         WindowViewClient client = upstream.client(Duration.ofMillis(300), 4096)) {
      long start = System.nanoTime();
      assertEquals(504, client.estimate(request()).status());
      assertTrue(Duration.ofNanos(System.nanoTime() - start).toMillis() < 2000);
    }
  }

  @Test void connectionFailureIsAServiceErrorAndLeaksNoEndpoint() throws Exception {
    int closedPort;
    try (java.net.ServerSocket temporary = new java.net.ServerSocket(0)) {
      closedPort = temporary.getLocalPort();
    }
    try (WindowViewClient client = new WindowViewClient("http://127.0.0.1:" + closedPort,
        Duration.ofSeconds(1), 4096)) {
      WindowViewClient.Result result = client.estimate(request());
      assertEquals(503, result.status());
      assertFalse(Json.write(result.body()).contains("127.0.0.1"));
    }
  }

  @Test void rejectsConfigurationWithCredentialsPathsAndUnsupportedSchemes() {
    for (String url : List.of("file:///tmp/x", "http://user:secret@example.test", "http://example.test/x",
        "http://example.test?q=x", "http://example.test/#x", "/relative"))
      assertThrows(IllegalArgumentException.class,
          () -> new WindowViewClient(url, Duration.ofSeconds(1), 4096));
  }

  private static HttpResponse<String> post(HttpClient client, Api api, String body, String type) throws Exception {
    return client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + api.port() + "/api/views/estimate"))
        .header("Content-Type", type).POST(HttpRequest.BodyPublishers.ofString(body)).build(),
        HttpResponse.BodyHandlers.ofString());
  }

  @Test void backendRouteWorksAndEnforcesInputContract() throws Exception {
    try (Upstream upstream = new Upstream(200, "application/json", Json.write(response()), 0);
         Store store = new Store(":memory:", Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of()));
         Api api = new Api(store, new Agents(Agents.Config.from(Map.of())), Path.of("missing-dist"),
             Path.of("missing-area.json"), Path.of("missing-noise.json"),
             Path.of("missing-traffic.json"), "", 0, Map.of("WINDOW_VIEW_URL", upstream.origin()));
         HttpClient http = HttpClient.newHttpClient()) {
      api.start();
      HttpResponse<String> result = post(http, api, Json.write(request()), "application/json");
      assertEquals(200, result.statusCode());
      assertEquals(response(), Json.read(result.body()));
      assertEquals("no-store", result.headers().firstValue("Cache-Control").orElse(""));
      for (String body : List.of("{}", "[]", "null", "not json", Json.write(request()) + " {}"))
        assertEquals(400, post(http, api, body, "application/json").statusCode());
      assertEquals(415, post(http, api, Json.write(request()), "text/plain").statusCode());
      assertEquals(413, post(http, api, " ".repeat(32769), "application/json").statusCode());
      assertEquals(1, upstream.calls.get());
      assertEquals(405, http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + api.port()
          + "/api/views/estimate")).GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode());
      var account = http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + api.port()
          + "/api/auth/me")).GET().build(), HttpResponse.BodyHandlers.ofString());
      assertEquals(200, account.statusCode());
      assertTrue(Json.read(account.body()).path("user").isNull());
      assertEquals(403, http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + api.port()
          + "/api/questions")).GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode());
    }
  }

  @Test void backendOriginCheckAlsoAppliesToViewRequests() throws Exception {
    try (Upstream upstream = new Upstream(200, "application/json", Json.write(response()), 0);
         Store store = new Store(":memory:", Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of()));
         Api api = new Api(store, new Agents(Agents.Config.from(Map.of())), Path.of("missing-dist"),
             Path.of("missing-area.json"), Path.of("missing-noise.json"),
             Path.of("missing-traffic.json"), "", 0, Map.of("WINDOW_VIEW_URL", upstream.origin()));
         HttpClient http = HttpClient.newHttpClient()) {
      api.start();
      var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + api.port() + "/api/views/estimate"))
          .header("Content-Type", "application/json").header("Origin", "https://untrusted.example")
          .POST(HttpRequest.BodyPublishers.ofString(Json.write(request()))).build();
      assertEquals(403, http.send(request, HttpResponse.BodyHandlers.ofString()).statusCode());
      assertEquals(0, upstream.calls.get());
    }
  }
}
