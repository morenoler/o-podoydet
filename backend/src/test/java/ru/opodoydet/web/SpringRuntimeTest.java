package ru.opodoydet.web;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import ru.opodoydet.application.Agents;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.JsonNode;

/** Exercises the real embedded servlet runtime, including behavior outside controller methods. */
class SpringRuntimeTest {
  @TempDir Path directory;

  private static final HttpClient CLIENT =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

  private Store store() throws Exception {
    return new Store(
        directory.resolve("runtime.sqlite3").toString(),
        Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of()));
  }

  private Api server(Store store, String frontendOrigin) throws Exception {
    return new Api(
        store,
        new Agents(Agents.Config.from(Map.of())),
        directory.resolve("dist"),
        directory.resolve("areas.json"),
        directory.resolve("noise.json"),
        directory.resolve("traffic.json"),
        frontendOrigin,
        0,
        Map.of("ACCOUNT_MODE", "false"));
  }

  private static String base(Api server) {
    return "http://127.0.0.1:" + server.port();
  }

  private static HttpResponse<String> request(
      Api server, String method, String path, String body, String origin) throws Exception {
    var builder =
        HttpRequest.newBuilder(URI.create(base(server) + path)).timeout(Duration.ofSeconds(10));
    if (origin != null) builder.header("Origin", origin);
    if (body != null) builder.header("Content-Type", "application/json");
    return CLIENT.send(
        builder
            .method(
                method,
                body == null
                    ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(body))
            .build(),
        HttpResponse.BodyHandlers.ofString());
  }

  private static void jsonError(HttpResponse<String> response, int status) {
    assertEquals(status, response.statusCode(), response.body());
    assertTrue(
        response.headers().firstValue("Content-Type").orElse("").startsWith("application/json"));
    assertTrue(Json.read(response.body()).path("error").isTextual(), response.body());
    assertEquals("nosniff", response.headers().firstValue("X-Content-Type-Options").orElse(""));
  }

  private static String trip() {
    return Json.write(
        Json.obj(
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
            "scenarios",
            List.of(),
            "preferences",
            List.of(),
            "text",
            ""));
  }

  @Test
  void realSpringContextOwnsAnnotatedRoutesAndShutsDown() throws Exception {
    try (Store store = store();
        Api server = server(store, "")) {
      server.start();
      var context = server.context();
      assertTrue(context.isActive());
      assertSame(store, context.getBean(Store.class));
      var mapping = context.getBean(RequestMappingHandlerMapping.class);
      Set<String> controllers =
          mapping.getHandlerMethods().values().stream()
              .filter(handler -> handler.getBeanType().isAnnotationPresent(RestController.class))
              .map(handler -> handler.getBeanType().getSimpleName())
              .collect(Collectors.toSet());
      assertTrue(
          controllers.containsAll(
              Set.of("CatalogController", "SearchController", "AdvisorController")),
          controllers.toString());
      HttpResponse<String> response = request(server, "GET", "/api/health", null, null);
      assertEquals(200, response.statusCode());
      JsonNode health = Json.read(response.body());
      assertTrue(health.path("ok").asBoolean());
      assertFalse(health.path("accountsEnabled").asBoolean());
      assertEquals("Пусан", health.path("region").asText());
      assertEquals("no-store", response.headers().firstValue("Cache-Control").orElse(""));
      server.close();
      assertFalse(context.isActive());
    }
  }

  @Test
  void spaFallbackNeverMasksMissingApiOrAssets() throws Exception {
    Path dist = Files.createDirectories(directory.resolve("dist"));
    Files.writeString(dist.resolve("index.html"), "<!doctype html><div id=\"root\">preview</div>");
    Path assets = Files.createDirectories(dist.resolve("assets"));
    Files.writeString(assets.resolve("app.js"), "window.preview = true;");
    try (Store store = store();
        Api server = server(store, "")) {
      server.start();
      HttpResponse<String> page = request(server, "GET", "/results", null, null);
      assertEquals(200, page.statusCode());
      assertTrue(page.body().contains("preview"));
      assertTrue(page.headers().firstValue("Content-Type").orElse("").startsWith("text/html"));
      assertEquals("no-cache", page.headers().firstValue("Cache-Control").orElse(""));
      HttpResponse<String> head = request(server, "HEAD", "/results", null, null);
      assertEquals(200, head.statusCode());
      assertEquals("", head.body());
      HttpResponse<String> script = request(server, "GET", "/assets/app.js", null, null);
      assertEquals(200, script.statusCode());
      assertEquals("window.preview = true;", script.body());
      assertEquals("nosniff", script.headers().firstValue("X-Content-Type-Options").orElse(""));
      jsonError(request(server, "GET", "/api/does-not-exist", null, null), 404);
      jsonError(request(server, "GET", "/assets/missing.js", null, null), 404);
      jsonError(request(server, "POST", "/api/health", "{}", null), 404);
    }
  }

  @Test
  void malformedScalarAndOversizedBodiesAreRejectedBeforeSearch() throws Exception {
    try (Store store = store();
        Api server = server(store, "")) {
      server.start();
      for (String body : List.of("{broken", "[]", "null", ""))
        jsonError(request(server, "POST", "/api/search", body, null), 400);
      String oversized = "{\"text\":\"" + "x".repeat(24 * 1024) + "\"}";
      jsonError(request(server, "POST", "/api/search", oversized, null), 400);
      // Rejected requests must not leave the server unusable for a valid search.
      HttpResponse<String> valid = request(server, "POST", "/api/search", trip(), null);
      assertEquals(200, valid.statusCode(), valid.body());
      assertTrue(Json.read(valid.body()).path("roomRecommendations").isArray());
    }
  }

  @Test
  void mutationOriginPolicyAllowsApplicationAndConfiguredFrontendOnly() throws Exception {
    String frontend = "http://127.0.0.1:3000";
    try (Store store = store();
        Api server = server(store, frontend)) {
      server.start();
      for (String origin : List.of(base(server), frontend)) {
        HttpResponse<String> response = request(server, "POST", "/api/search", trip(), origin);
        assertEquals(200, response.statusCode(), response.body());
      }
      for (String origin : List.of("https://evil.example", "null", base(server) + "@evil.example"))
        jsonError(request(server, "POST", "/api/search", trip(), origin), 403);
      jsonError(request(server, "POST", "/%61pi/search", trip(), "https://evil.example"), 403);
      assertEquals(200, request(server, "GET", "/api/health", null, null).statusCode());
    }
  }
}
