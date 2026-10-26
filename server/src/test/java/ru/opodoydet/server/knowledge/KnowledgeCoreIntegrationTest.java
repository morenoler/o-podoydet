package ru.opodoydet.server.knowledge;

import org.springframework.test.context.ContextConfiguration;
import ru.opodoydet.server.support.IsolatedPostgresInitializer;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import ru.opodoydet.server.catalog.CatalogService;
import ru.opodoydet.server.catalog.SeedImporter;
import ru.opodoydet.server.support.FixedClockConfig;

/**
 * Ядро на настоящем наборе данных Пусана.
 */
@ContextConfiguration(initializers = IsolatedPostgresInitializer.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(FixedClockConfig.class)
class KnowledgeCoreIntegrationTest {

  static final Path DATA = Path.of("../data/verified-hotels.json");

  @Autowired SeedImporter importer;
  @Autowired FactResolver resolver;
  @Autowired CatalogService catalog;
  @Autowired JdbcClient jdbc;
  @Autowired ObjectMapper json;
  @LocalServerPort int port;

  @BeforeEach
  void importDataset() throws Exception {
    // Тесты делят одну БД: импорт идемпотентен, побочные записи каждый тест убирает сам.
    jdbc.sql("DELETE FROM conflict").update();
    jdbc.sql("DELETE FROM evidence WHERE origin <> 'seed'").update();
    importer.importFile(DATA);
    resolver.resolveAll();
  }

  @Test
  void importsWholeDatasetIntoEvidenceAndFacts() throws Exception {
    JsonNode source = json.readTree(DATA.toFile());
    Map<String, Scope> expected = new java.util.LinkedHashMap<>();
    for (JsonNode fact : source.path("facts")) {
      String id = fact.path("id").asText();
      Scope scope = new Scope(fact.path("hotelId").asText(),
          fact.path("roomId").asText(null), fact.path("feature").asText());
      assertThat(expected.put(id, scope)).as("Unique source evidence ID: %s", id).isNull();
    }
    assertThat(count("SELECT count(*) FROM hotel WHERE active")).isEqualTo(96);
    assertThat(jdbc.sql("SELECT id FROM hotel WHERE active").query(String.class).list())
        .containsExactlyInAnyOrderElementsOf(stream(source.path("hotels")).stream()
            .map(h -> h.path("id").asText()).toList());
    Map<String, Scope> actual = new java.util.LinkedHashMap<>();
    jdbc.sql("SELECT id, hotel_id, room_id, characteristic FROM evidence WHERE active")
        .query((rs, n) -> Map.entry(rs.getString(1),
            new Scope(rs.getString(2), rs.getString(3), rs.getString(4))))
        .list().forEach(entry -> actual.put(entry.getKey(), entry.getValue()));
    // An equal count alone would miss reassigning an existing ID to another hotel/room/feature.
    assertThat(actual).containsExactlyInAnyOrderEntriesOf(expected);
    assertThat(count("SELECT count(*) FROM characteristic")).isEqualTo(8);
    // Каждому предмету (отель/номер × характеристика) — ровно один факт.
    assertThat(jdbc.sql("SELECT hotel_id, room_id, characteristic FROM fact")
        .query((rs, n) -> new Scope(rs.getString(1), rs.getString(2), rs.getString(3))).list())
        .containsExactlyInAnyOrderElementsOf(new java.util.HashSet<>(expected.values()));
    assertThat(count("SELECT count(*) FROM fact WHERE status = 'confirmed'")).isPositive();
    assertThat(count("SELECT count(*) FROM fact WHERE status = 'unknown'")).isPositive();
  }

  private record Scope(String hotelId, String roomId, String feature) {}

  @Test
  void reimportIsIdempotentAndKeepsOrder() throws Exception {
    List<Long> before = jdbc.sql("SELECT ord FROM evidence ORDER BY id").query(Long.class).list();
    long facts = count("SELECT count(*) FROM fact");

    importer.importFile(DATA);
    resolver.resolveAll();

    assertThat(jdbc.sql("SELECT ord FROM evidence ORDER BY id").query(Long.class).list())
        .isEqualTo(before);
    assertThat(count("SELECT count(*) FROM fact")).isEqualTo(facts);
  }

  @Test
  void legacyCatalogShapeIsPreserved() {
    JsonNode result = catalog.catalog();

    assertThat(result.path("region").asText()).isEqualTo("Пусан");
    assertThat(result.path("evidencePolicy").asText()).isEqualTo("verified-only");
    assertThat(result.path("hotels")).hasSize(96);
    assertThat(result.path("map").size()).isGreaterThan(1000);
    // Неподтверждённые категории заменяются одной заглушкой, как в старом API.
    JsonNode unverified = find(result.path("hotels"), "node-368662694");
    assertThat(unverified.path("rooms")).hasSize(1);
    assertThat(unverified.path("rooms").path(0).path("evidenceStatus").asText()).isEqualTo("unknown");
  }

  @Test
  void conflictIsDetectedLoggedAndClosed() throws Exception {
    // Официальный сайт говорит «семейная категория», отельер — «нет».
    String hotel = "way-843161717", room = "way-843161717-real-kids-deluxe";
    jdbc.sql(
            """
            INSERT INTO evidence (id, hotel_id, room_id, characteristic, value, method, quote,
              confidence_level, obtained_at, demo, origin, raw)
            VALUES ('test-host-answer', ?, ?, 'family', 'false'::jsonb, 'host',
              'Детей в этой категории не размещаем', 'high', ?, FALSE, 'host', '{}')
            """)
        .params(hotel, room, java.sql.Timestamp.from(FixedClockConfig.NOW.minusSeconds(3600)))
        .update();

    FactResolver.Summary summary = resolver.resolveAll();

    assertThat(summary.conflictsOpened()).isEqualTo(1);
    Map<String, Object> fact =
        jdbc.sql(
                "SELECT status, value::text AS value FROM fact"
                    + " WHERE hotel_id = ? AND room_id = ? AND characteristic = 'family'")
            .params(hotel, room)
            .query()
            .singleRow();
    assertThat(fact.get("status")).isEqualTo("conflict");
    assertThat(count("SELECT count(*) FROM conflict WHERE resolved_at IS NULL")).isEqualTo(1);

    // Повторный пересчёт не плодит дубликаты.
    assertThat(resolver.resolveAll().conflictsOpened()).isZero();

    jdbc.sql("UPDATE evidence SET active = FALSE WHERE id = 'test-host-answer'").update();
    assertThat(resolver.resolveAll().conflictsClosed()).isEqualTo(1);
    assertThat(count("SELECT count(*) FROM conflict WHERE resolved_at IS NULL")).isZero();
    assertThat(count("SELECT count(*) FROM conflict")).isEqualTo(1); // история сохранена
  }

  @Test
  void knowledgeApiShowsFactsWithTheirEvidenceTrail() throws Exception {
    JsonNode body = get("/api/v2/hotels/way-843161717/knowledge");

    JsonNode family =
        stream(body.path("facts")).stream()
            .filter(f -> f.path("characteristic").asText().equals("family"))
            .findFirst()
            .orElseThrow();
    assertThat(family.path("status").asText()).isEqualTo("confirmed");
    assertThat(family.path("confidence").asDouble()).isBetween(0.5, 1.0);
    assertThat(family.path("evidence").path(0).path("sourceUrl").asText()).startsWith("https://");
    assertThat(family.path("evidence").path(0).path("quote").asText()).isNotBlank();
  }

  @Test
  void legacyHotelEndpointIsServedBySpring() throws Exception {
    HttpResponse<String> response = send("/api/hotels/way-843161717");
    JsonNode body = json.readTree(response.body());

    assertThat(response.headers().firstValue("X-Served-By")).contains("spring");
    assertThat(body.path("hotel").path("name").asText()).isEqualTo("Grand Josun Busan");
    assertThat(body.path("facts").size()).isPositive();
    assertThat(body.path("questions").isArray()).isTrue();
    assertThat(send("/api/hotels/no-such-hotel").statusCode()).isEqualTo(404);
  }

  private long count(String sql) {
    return jdbc.sql(sql).query(Long.class).single();
  }

  private JsonNode get(String path) throws Exception {
    HttpResponse<String> response = send(path);
    assertThat(response.statusCode()).isEqualTo(200);
    return json.readTree(response.body());
  }

  private HttpResponse<String> send(String path) throws Exception {
    return HttpClient.newBuilder()
        .proxy(HttpClient.Builder.NO_PROXY)
        .build()
        .send(
            HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  private static JsonNode find(JsonNode hotels, String id) {
    return stream(hotels).stream()
        .filter(h -> h.path("id").asText().equals(id))
        .findFirst()
        .orElseThrow();
  }

  private static List<JsonNode> stream(JsonNode array) {
    List<JsonNode> list = new java.util.ArrayList<>();
    array.forEach(list::add);
    return list;
  }
}
