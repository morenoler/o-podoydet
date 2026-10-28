package ru.opodoydet.server.catalog;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.server.knowledge.FactResolver;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

/** Synthetic fixtures exercise region boundaries on actual PostgreSQL and HTTP. */
class MultiRegionCatalogIntegrationTest {
  private static ObjectNode hotel(String id, boolean category) {
    return Json.obj("id", id, "name", "Synthetic fixture " + id, "coordinates", List.of(39.73, 43.60),
        "route", null, "noise", List.of(), "rooms", category ? List.of(Json.obj(
            "id", id + "-room", "name", "Synthetic category", "capacity", 2, "demo", false,
            "scope", "room_category", "evidenceStatus", "verified",
            "sourceUrl", "https://example.test/category", "quote", "Synthetic fixture for two guests",
            "obtainedAt", Instant.now().minusSeconds(60).toString())) : List.of());
  }

  private static ObjectNode seed(String region, String id, boolean category) {
    return Json.obj("region", region, "evidencePolicy", "verified-only", "hotels", List.of(hotel(id, category)), "facts", List.of());
  }

  private static ObjectNode trip(String region) {
    LocalDate start = LocalDate.now().plusDays(5);
    return Json.obj("region", region, "checkIn", start.toString(), "checkOut", start.plusDays(2).toString(),
        "adults", 2, "children", 0, "scenarios", List.of(), "preferences", List.of(), "text", "", "admissionMode", "explore");
  }

  private static JsonNode call(HttpClient client, int port, String path, JsonNode input, int expected) throws Exception {
    var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
    if (input != null) builder.header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(Json.write(input), StandardCharsets.UTF_8));
    var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(response.statusCode()).withFailMessage("%s: %s", path, response.body()).isEqualTo(expected);
    return Json.read(response.body());
  }

  @Test void parallelHttpSelectionDoesNotChangeDefaultOrMixHotelsAndUnknownCategoriesStayCandidates() throws Exception {
    var busan = seed("Пусан", "fixture-busan", true);
    var sochi = seed("Сочи", "fixture-sochi", false);
    try (var db = TestDatabases.start(busan, Map.of()); var client = HttpClient.newHttpClient()) {
      db.context().getBean(SeedImporter.class).importCatalog(List.of(busan, sochi));
      JsonNode metadata = call(client, db.port(), "/api/regions", null, 200);
      assertThat(metadata.path("defaultRegion").asText()).isEqualTo("Пусан");
      assertThat(Json.list(metadata.path("regions"))).extracting(r -> r.path("region").asText()).containsExactly("Пусан", "Сочи");
      try (var executor = Executors.newFixedThreadPool(4)) {
        var futures = java.util.stream.IntStream.range(0, 16).mapToObj(i -> executor.submit(() -> {
          String region = i % 2 == 0 ? "Сочи" : "Пусан";
          String id = i % 2 == 0 ? "fixture-sochi" : "fixture-busan";
          JsonNode catalog = call(client, db.port(), "/api/catalog?region=" + URLEncoder.encode(region, StandardCharsets.UTF_8), null, 200);
          assertThat(catalog.path("region").asText()).isEqualTo(region);
          assertThat(Json.list(catalog.path("hotels"))).extracting(h -> h.path("id").asText()).containsExactly(id);
          JsonNode result = call(client, db.port(), "/api/search", trip(region), 200);
          for (String key : List.of("results", "excluded", "hotelCandidates"))
            assertThat(Json.list(result.path(key))).allSatisfy(value -> assertThat(value.path("hotel").path("id").asText()).isEqualTo(id));
          if (region.equals("Сочи")) {
            assertThat(result.path("hotelCandidates").size()).isEqualTo(1);
            assertThat(result.path("hotelCandidates").get(0).path("hotel").path("rooms")).isEmpty();
            assertThat(result.path("roomRecommendations")).isEmpty();
          }
          return null;
        })).toList();
        for (var future : futures) future.get();
      }
      assertThat(call(client, db.port(), "/api/catalog", null, 200).path("region").asText()).isEqualTo("Пусан");
      assertThat(call(client, db.port(), "/api/hotels/fixture-sochi", null, 200).path("region").asText()).isEqualTo("Сочи");
      call(client, db.port(), "/api/catalog?region=missing", null, 400);
      call(client, db.port(), "/api/search", trip("missing"), 400);
      call(client, db.port(), "/api/hotels/fixture-busan/evaluate", trip("Сочи"), 404);
      JsonNode conversation = call(client, db.port(), "/api/search/conversation", Json.obj("trip", trip("Сочи"), "message", "Нужен семейный номер"), 200);
      assertThat(conversation).isNotNull();
      assertThat(db.store().region()).isEqualTo("Пусан");
    }
  }

  @Test void multiImportIsAtomicAndExplicitDataPathPublishesOnlyItsDataset() throws Exception {
    var busan = seed("Пусан", "fixture-busan", true);
    var sochi = seed("Сочи", "fixture-sochi", true);
    try (var db = TestDatabases.create(busan)) {
      var importer = db.context().getBean(SeedImporter.class);
      importer.importCatalog(List.of(busan, sochi));
      var invalid = seed("Broken", "fixture-broken", true);
      invalid.withArray("facts").add(Json.obj("id", "bad", "hotelId", "fixture-busan", "feature", "family", "method", "official", "value", true));
      assertThatThrownBy(() -> importer.importCatalog(List.of(sochi, invalid))).isInstanceOf(IllegalArgumentException.class);
      assertThat(db.context().getBean(CatalogService.class).regions()).containsExactly("Пусан", "Сочи");
      assertThat(db.jdbc().sql("SELECT count(*) FROM hotel WHERE id = 'fixture-broken'").query(Long.class).single()).isZero();
      var file = db.directory().resolve("explicit-seed.json");
      Files.writeString(file, Json.write(sochi));
      new SeedImporter(db.jdbc(), Json.MAPPER, db.tx(), db.context().getBean(FactResolver.class),
          java.time.Clock.systemUTC(), file.toString(), true).run();
      assertThat(db.context().getBean(CatalogService.class).regions()).containsExactly("Сочи");
      assertThat(db.store().hotel("fixture-busan")).isNull();
      assertThatThrownBy(() -> db.store().forRegion("Пусан")).isInstanceOf(IllegalArgumentException.class);
      assertThat(db.store().hotel("fixture-sochi")).isNotNull();
    }
  }

  @Test void hotelFactsQuestionsAndAdvisorHistoryKeepTheirRegionAndEnvironmentDoesNotCrossIt() throws Exception {
    var busan = seed("Пусан", "fixture-busan", true);
    var sochi = seed("Сочи", "fixture-sochi", true);
    busan.withArray("facts").add(Json.obj("id", "fixture-busan-family", "hotelId", "fixture-busan", "roomId", "fixture-busan-room",
        "feature", "family", "value", true, "method", "official", "source", "Synthetic fixture", "sourceUrl", "https://example.test/fact",
        "quote", "Synthetic positive statement", "demo", false, "obtainedAt", Instant.now().minusSeconds(60).toString(), "expiresAt", Instant.now().plusSeconds(86400).toString()));
    try (var db = TestDatabases.start(busan, Map.of()); var client = HttpClient.newHttpClient()) {
      db.context().getBean(SeedImporter.class).importCatalog(List.of(busan, sochi));
      db.context().getBean(FactResolver.class).resolveAll();
      Files.writeString(db.directory().resolve("areas.json"), Json.write(Json.obj("region", "Пусан", "assessments", List.of(
          Json.obj("hotelId", "fixture-sochi", "coordinates", List.of(39.73, 43.60), "airQuality", Json.obj("status", "available", "usAqi", 1))))));
      assertThat(call(client, db.port(), "/api/areas/fixture-sochi", null, 200).path("assessment").isNull()).isTrue();
      JsonNode detail = call(client, db.port(), "/api/hotels/fixture-sochi/evaluate", trip("Сочи"), 200);
      for (JsonNode criterion : detail.path("best").path("criteria")) {
        assertThat(criterion.path("facts")).isEmpty();
        if (List.of("family", "clean_air", "area_safety", "low_noise").contains(criterion.path("feature").asText()))
          assertThat(criterion.path("evidenceStatus").asText()).isEqualTo("unknown");
      }
      var question = call(client, db.port(), "/api/questions", Json.obj("hotelId", "fixture-sochi", "roomId", "fixture-sochi-room", "feature", "family", "trip", trip("Сочи")), 200).path("question");
      assertThat(db.jdbc().sql("SELECT region FROM catalog_question WHERE id = ?").param(question.path("id").asText()).query(String.class).single()).isEqualTo("Сочи");
      assertThat(call(client, db.port(), "/api/hotels/fixture-sochi", null, 200).path("questions").size()).isEqualTo(1);
      assertThat(call(client, db.port(), "/api/hotels/fixture-busan", null, 200).path("questions")).isEmpty();
      call(client, db.port(), "/api/questions", Json.obj("hotelId", "fixture-sochi", "roomId", "fixture-sochi-room", "feature", "family", "trip", trip("Пусан")), 404);
      var run = Json.obj("id", "sochi-run", "createdAt", Instant.now().toString(), "status", "completed", "context", Json.obj("trip", trip("Сочи")));
      db.store().createAdvisorRun(run, "actor-a");
      assertThat(db.jdbc().sql("SELECT region FROM advisor_run WHERE id = 'sochi-run'").query(String.class).single()).isEqualTo("Сочи");
      assertThat(db.store().advisorRun("sochi-run", "actor-a")).isEqualTo(run);
      assertThat(db.store().forRegion("Пусан").advisorRun("sochi-run", "actor-a")).isNull();
      assertThat(db.store().forRegion("Сочи").advisorRun("sochi-run", "actor-a")).isEqualTo(run);
      assertThat(db.store().advisorRun("sochi-run", "actor-b")).isNull();
      ObjectNode result = db.context().getBean(SearchService.class).search(trip("Сочи"), "actor-a");
      assertThatThrownBy(() -> db.context().getBean(SearchService.class).advisorContext(trip("Пусан"), result.path("searchId").asText(), "actor-a"))
          .isInstanceOf(IllegalArgumentException.class);
      call(client, db.port(), "/api/v2/hotels/fixture-busan/knowledge", null, 200);
      db.importSeed(sochi);
      call(client, db.port(), "/api/v2/hotels/fixture-busan/knowledge", null, 404);
      assertThat(db.store().forRegion("Сочи").question(question.path("id").asText())).isNotNull();
    }
  }
}
