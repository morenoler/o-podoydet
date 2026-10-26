package ru.opodoydet.server.catalog;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import ru.opodoydet.server.knowledge.FactResolver;

/**
 * Загружает набор данных региона и реестр характеристик при старте.
 *
 * <p>Повторяет правила старого {@code Store.importSeed}, чтобы ответы совпадали:
 *
 * <ul>
 *   <li>отели и категории только добавляются и обновляются, но не удаляются, если их нет в новом
 *       снимке;
 *   <li>доказательства из seed, которых больше нет в источнике, становятся неактивными, а история
 *       остаётся;
 *   <li>заменённое ({@code superseded_by}) доказательство повторный импорт не перезаписывает;
 *   <li>порядок записей — порядок первого появления (как rowid в SQLite).
 * </ul>
 *
 * Запись идёт через SQL, а не JPA: здесь нужен идемпотентный upsert с сохранением порядка.
 */
@Component
public class SeedImporter {

  public record Report(String region, int hotels, int rooms, int evidence, String policy) {}

  private static final Logger log = LoggerFactory.getLogger(SeedImporter.class);
  private static final Set<String> LEVELS = Set.of("low", "medium", "high");

  private final JdbcClient jdbc;
  private final ObjectMapper json;
  private final TransactionTemplate tx;
  private final FactResolver resolver;
  private final Clock clock;
  private final Path dataPath;
  private final boolean enabled;

  public SeedImporter(
      JdbcClient jdbc,
      ObjectMapper json,
      TransactionTemplate tx,
      FactResolver resolver,
      Clock clock,
      @Value("${catalog.data-path}") String dataPath,
      @Value("${catalog.import-on-startup:true}") boolean enabled) {
    this.jdbc = jdbc;
    this.json = json;
    this.tx = tx;
    this.resolver = resolver;
    this.clock = clock;
    this.dataPath = Path.of(dataPath);
    this.enabled = enabled;
  }

  /** Вызывается из {@link ru.opodoydet.server.config.StartupImports} до открытия HTTP-порта. */
  public void run() throws IOException {
    if (!enabled) return;
    Report report = importFile(dataPath);
    log.info("Импорт {}: {}", dataPath, report);
    log.info("Факты пересчитаны: {}", resolver.resolveAll());
  }

  public Report importFile(Path path) throws IOException {
    if (!Files.isRegularFile(path))
      throw new IllegalStateException(
          "Не найден набор данных "
              + path.toAbsolutePath()
              + ". Запускайте сервер из корня репозитория или задайте DATA_PATH.");
    return importSeed(json.readTree(path.toFile()));
  }

  public Report importSeed(JsonNode seed) {
    String region = text(seed, "region");
    if (!seed.path("hotels").isArray() || !seed.path("facts").isArray())
      throw new IllegalArgumentException("Некорректный набор данных региона");
    String policy = "demo".equals(seed.path("evidencePolicy").asText()) ? "demo" : "verified-only";

    return tx.execute(
        status -> {
          Instant now = clock.instant();
          upsertCharacteristics();
          ObjectNode metadata = seed.deepCopy();
          metadata.remove(List.of("hotels", "facts"));
          jdbc.sql(
                  """
                  INSERT INTO dataset (region, body, evidence_policy, imported_at) VALUES (?, ?, ?, ?)
                  ON CONFLICT (region) DO UPDATE
                    SET body = excluded.body, evidence_policy = excluded.evidence_policy,
                        imported_at = excluded.imported_at
                  """)
              .params(region, write(metadata), policy, java.sql.Timestamp.from(now))
              .update();

          jdbc.sql("UPDATE evidence SET active = FALSE WHERE origin = 'seed'").update();

          int rooms = 0;
          Set<String> roomKeys = new HashSet<>();
          for (JsonNode hotel : seed.path("hotels")) {
            String hotelId = text(hotel, "id");
            text(hotel, "name");
            if (!hotel.path("rooms").isArray() || hotel.path("rooms").isEmpty())
              throw new IllegalArgumentException(
                  "Отель " + hotelId + " должен иметь хотя бы одну категорию номера");
            ObjectNode body = hotel.deepCopy();
            body.remove("rooms");
            JsonNode coordinates = hotel.path("coordinates");
            jdbc.sql(
                    """
                    INSERT INTO hotel (id, region, name, lodging_type, lon, lat, body, active)
                    VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
                    ON CONFLICT (id) DO UPDATE
                      SET region = excluded.region, name = excluded.name,
                          lodging_type = excluded.lodging_type, lon = excluded.lon,
                          lat = excluded.lat, body = excluded.body, active = TRUE
                    """)
                .params(
                    hotelId,
                    region,
                    hotel.path("name").asText(),
                    hotel.path("lodgingType").asText(null),
                    coordinates.path(0).isNumber() ? coordinates.path(0).asDouble() : null,
                    coordinates.path(1).isNumber() ? coordinates.path(1).asDouble() : null,
                    write(body))
                .update();
            for (JsonNode room : hotel.path("rooms")) {
              String roomId = text(room, "id");
              Integer capacity = null;
              if (room.hasNonNull("capacity")) {
                if (!room.path("capacity").canConvertToInt()
                    || room.path("capacity").asInt() < 1
                    || room.path("capacity").asInt() > 20)
                  throw new IllegalArgumentException("Некорректная вместимость: " + roomId);
                capacity = room.path("capacity").asInt();
              }
              jdbc.sql(
                      """
                      INSERT INTO room (hotel_id, id, name, capacity, body, active)
                      VALUES (?, ?, ?, ?, ?, TRUE)
                      ON CONFLICT (hotel_id, id) DO UPDATE
                        SET name = excluded.name, capacity = excluded.capacity,
                            body = excluded.body, active = TRUE
                      """)
                  .params(hotelId, roomId, room.path("name").asText(null), capacity, write(room))
                  .update();
              roomKeys.add(hotelId + "\u0000" + roomId);
              rooms++;
            }
          }

          Set<String> characteristics =
              Set.copyOf(jdbc.sql("SELECT code FROM characteristic").query(String.class).list());
          Set<String> methods =
              Set.copyOf(jdbc.sql("SELECT method FROM source_method").query(String.class).list());
          Set<String> hotels =
              Set.copyOf(jdbc.sql("SELECT id FROM hotel").query(String.class).list());
          int evidence = 0;
          for (JsonNode fact : seed.path("facts")) {
            String id = text(fact, "id");
            String hotelId = text(fact, "hotelId");
            String feature = text(fact, "feature");
            if (!characteristics.contains(feature))
              throw new IllegalArgumentException("Неизвестная характеристика " + feature);
            if (!hotels.contains(hotelId))
              throw new IllegalArgumentException("Факт " + id + " ссылается на неизвестный отель");
            String roomId = fact.hasNonNull("roomId") ? text(fact, "roomId") : null;
            if (roomId != null && !roomKeys.contains(hotelId + "\u0000" + roomId))
              throw new IllegalArgumentException("Факт " + id + " ссылается на неизвестную категорию");
            String method = fact.path("method").asText();
            if (!methods.contains(method))
              throw new IllegalArgumentException("Неизвестный метод получения " + method + " у " + id);
            JsonNode value = fact.get("value");
            String level = fact.path("confidence").asText(null);
            jdbc.sql(
                    """
                    INSERT INTO evidence (id, hotel_id, room_id, characteristic, value, method,
                      source_name, source_url, quote, confidence_level, confidence_reason,
                      obtained_at, source_date, expires_at, demo, origin, active, raw)
                    VALUES (?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed', TRUE, ?)
                    ON CONFLICT (id) DO UPDATE SET
                      active = TRUE,
                      hotel_id = CASE WHEN evidence.superseded_by IS NULL THEN excluded.hotel_id ELSE evidence.hotel_id END,
                      room_id = CASE WHEN evidence.superseded_by IS NULL THEN excluded.room_id ELSE evidence.room_id END,
                      characteristic = CASE WHEN evidence.superseded_by IS NULL THEN excluded.characteristic ELSE evidence.characteristic END,
                      value = CASE WHEN evidence.superseded_by IS NULL THEN excluded.value ELSE evidence.value END,
                      method = CASE WHEN evidence.superseded_by IS NULL THEN excluded.method ELSE evidence.method END,
                      source_name = CASE WHEN evidence.superseded_by IS NULL THEN excluded.source_name ELSE evidence.source_name END,
                      source_url = CASE WHEN evidence.superseded_by IS NULL THEN excluded.source_url ELSE evidence.source_url END,
                      quote = CASE WHEN evidence.superseded_by IS NULL THEN excluded.quote ELSE evidence.quote END,
                      confidence_level = CASE WHEN evidence.superseded_by IS NULL THEN excluded.confidence_level ELSE evidence.confidence_level END,
                      confidence_reason = CASE WHEN evidence.superseded_by IS NULL THEN excluded.confidence_reason ELSE evidence.confidence_reason END,
                      obtained_at = CASE WHEN evidence.superseded_by IS NULL THEN excluded.obtained_at ELSE evidence.obtained_at END,
                      source_date = CASE WHEN evidence.superseded_by IS NULL THEN excluded.source_date ELSE evidence.source_date END,
                      expires_at = CASE WHEN evidence.superseded_by IS NULL THEN excluded.expires_at ELSE evidence.expires_at END,
                      demo = CASE WHEN evidence.superseded_by IS NULL THEN excluded.demo ELSE evidence.demo END,
                      raw = CASE WHEN evidence.superseded_by IS NULL THEN excluded.raw ELSE evidence.raw END
                    """)
                .params(
                    id,
                    hotelId,
                    roomId,
                    feature,
                    value == null || value.isNull() ? null : write(value),
                    method,
                    fact.path("source").asText(null),
                    fact.path("sourceUrl").asText(null),
                    fact.path("quote").asText(null),
                    LEVELS.contains(level) ? level : null,
                    fact.path("confidenceReason").asText(null),
                    timestamp(fact, "obtainedAt"),
                    timestamp(fact, "sourceDate"),
                    timestamp(fact, "expiresAt"),
                    // Как в старом коде: без явного demo=false запись считается демонстрационной.
                    !fact.path("demo").isBoolean() || fact.path("demo").asBoolean(),
                    write(fact))
                .update();
            evidence++;
          }
          return new Report(region, seed.path("hotels").size(), rooms, evidence, policy);
        });
  }

  private void upsertCharacteristics() {
    try (InputStream input = getClass().getResourceAsStream("/knowledge/characteristics.json")) {
      if (input == null) throw new IllegalStateException("knowledge/characteristics.json не найден");
      for (JsonNode c : json.readTree(input)) {
        jdbc.sql(
                """
                INSERT INTO characteristic (code, label, scope, tool, value_type, question,
                  positive, negative, threshold, ttl_days)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (code) DO UPDATE SET label = excluded.label, scope = excluded.scope,
                  tool = excluded.tool, value_type = excluded.value_type,
                  question = excluded.question, positive = excluded.positive,
                  negative = excluded.negative, threshold = excluded.threshold,
                  ttl_days = excluded.ttl_days
                """)
            .params(
                text(c, "code"),
                text(c, "label"),
                text(c, "scope"),
                text(c, "tool"),
                text(c, "valueType"),
                c.path("question").asText(null),
                c.path("positive").asText(null),
                c.path("negative").asText(null),
                c.hasNonNull("threshold") ? c.path("threshold").asInt() : null,
                c.path("ttlDays").asInt(30))
            .update();
      }
    } catch (IOException e) {
      throw new IllegalStateException("Не удалось прочитать реестр характеристик", e);
    }
  }

  private String write(JsonNode node) {
    try {
      return json.writeValueAsString(node);
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
  }

  private static String text(JsonNode node, String key) {
    String value = node.path(key).asText("");
    if (value.isBlank()) throw new IllegalArgumentException("Некорректное поле: " + key);
    return value;
  }

  private static java.sql.Timestamp timestamp(JsonNode node, String key) {
    try {
      return node.hasNonNull(key) ? java.sql.Timestamp.from(Instant.parse(node.get(key).asText())) : null;
    } catch (RuntimeException invalid) {
      return null;
    }
  }
}
