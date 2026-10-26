package ru.opodoydet.server.migration;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;
import ru.opodoydet.server.knowledge.FactResolver;
import ru.opodoydet.shared.Json;

/**
 * Однократный перенос данных старого бэкенда из SQLite в PostgreSQL.
 *
 * <p>Если задан {@code LEGACY_DB_PATH} (npm-скрипты подставляют туда прежний {@code DB_PATH}) и
 * файл существует, при старте копируются: аккаунты и сессии, объявления и закрытые анкеты,
 * заявки, вопросы по объявлениям, загруженные фото, история помощника, демонстрационные вопросы
 * и ответы отельеров. Каталог отелей не копируется — он всегда загружается из набора данных.
 *
 * <p>Импорт идемпотентен: уже существующие строки не перезаписываются, а выполненный импорт
 * конкретного файла (путь + размер + время изменения) запоминается и не повторяется.
 */
@Component
public class SqliteImporter {

  private static final Logger log = LoggerFactory.getLogger(SqliteImporter.class);

  /** Таблица SQLite → таблица PostgreSQL и колонки, которые переносим (если есть в источнике). */
  private record Copy(String from, String to, List<String> columns, String order) {}

  private static final List<Copy> TABLES =
      List.of(
          new Copy(
              "account_users",
              "account_users",
              List.of("id", "email", "password_hash", "role", "name", "phone", "about", "created_at"),
              "created_at"),
          new Copy("account_sessions", "account_sessions", List.of("token_hash", "user_id", "expires_at"), "expires_at"),
          new Copy(
              "account_listings",
              "account_listings",
              List.of(
                  "id", "host_id", "title", "description", "city", "address", "room_type", "capacity",
                  "price_per_night", "amenities", "status", "created_at", "updated_at", "floor",
                  "window_directions", "photos"),
              "created_at"),
          new Copy(
              "account_listing_search_profiles",
              "account_listing_search_profiles",
              List.of("listing_id", "notes", "floor", "window_directions"),
              "listing_id"),
          new Copy(
              "account_bookings",
              "account_bookings",
              List.of(
                  "id", "listing_id", "user_id", "check_in", "check_out", "guests", "nights",
                  "price_per_night", "total_price", "status", "note", "listing_title", "city",
                  "address", "created_at", "updated_at"),
              "created_at"),
          new Copy(
              "account_questions",
              "account_questions",
              List.of("id", "listing_id", "user_id", "text", "answer", "created_at", "answered_at"),
              "created_at"),
          new Copy(
              "account_uploaded_photos",
              "account_uploaded_photos",
              List.of("url", "owner_id", "mime", "width", "height", "byte_size", "created_at"),
              "created_at"),
          new Copy("advisor_runs", "advisor_run", List.of("id", "created_at", "body"), "created_at"),
          new Copy(
              "questions", "catalog_question", List.of("id", "hotel_id", "room_id", "feature", "body"), "rowid"),
          new Copy("drafts", "catalog_draft", List.of("id", "question_id", "body"), "rowid"));

  private final JdbcClient jdbc;
  private final TransactionTemplate tx;
  private final FactResolver resolver;
  private final String path;

  SqliteImporter(JdbcClient jdbc, TransactionTemplate tx, FactResolver resolver, RuntimeEnv env) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.resolver = resolver;
    this.path = env.get("LEGACY_DB_PATH", "");
  }

  /** Вызывается после импорта каталога: ответы отельеров ссылаются на его отели. */
  public void run() throws Exception {
    if (path.isBlank()) return;
    Path file = Path.of(path).toAbsolutePath().normalize();
    if (!Files.isRegularFile(file)) return;
    String marker =
        "sqlite-import:" + file + ":" + Files.size(file) + ":" + Files.getLastModifiedTime(file).toMillis();
    boolean done =
        jdbc.sql("SELECT count(*) FROM migration_marker WHERE name = ?").param(marker).query(Long.class).single() > 0;
    if (done) return;

    Map<String, Integer> copied;
    try {
      copied = importFile(file);
    } catch (RuntimeException | SQLException failure) {
      // Сервер должен стартовать и без переноса; попытка повторится при следующем запуске.
      log.warn("Не удалось перенести данные из {}: {}", file, failure.getMessage());
      return;
    }
    jdbc.sql("INSERT INTO migration_marker (name, applied_at) VALUES (?, ?)")
        .params(marker, Timestamp.from(Instant.now()))
        .update();
    log.info("Перенесено из {}: {}", file, copied);
    if (copied.getOrDefault("evidence", 0) > 0) resolver.resolveAll();
  }

  Map<String, Integer> importFile(Path file) throws SQLException {
    Map<String, Integer> copied = new LinkedHashMap<>();
    try (Connection sqlite = DriverManager.getConnection("jdbc:sqlite:" + file, sqliteProps())) {
      Set<String> tables = tables(sqlite);
      tx.executeWithoutResult(
          status -> {
            try {
              for (Copy copy : TABLES)
                if (tables.contains(copy.from())) copied.put(copy.to(), copyTable(sqlite, copy));
              if (tables.contains("facts")) copied.put("evidence", copyHostFacts(sqlite));
            } catch (SQLException e) {
              throw new IllegalStateException("Не удалось перенести " + file + ": " + e.getMessage(), e);
            }
          });
    }
    return copied;
  }

  private static java.util.Properties sqliteProps() {
    org.sqlite.SQLiteConfig config = new org.sqlite.SQLiteConfig();
    config.setReadOnly(true); // исходная база не меняется
    return config.toProperties();
  }

  private int copyTable(Connection sqlite, Copy copy) throws SQLException {
    Set<String> available = columns(sqlite, copy.from());
    List<String> columns = copy.columns().stream().filter(available::contains).toList();
    String select =
        "SELECT " + String.join(",", columns) + " FROM " + copy.from() + " ORDER BY " + copy.order();
    String insert =
        "INSERT INTO "
            + copy.to()
            + " ("
            + String.join(",", columns)
            + ") VALUES ("
            + String.join(",", columns.stream().map(c -> "?").toList())
            + ") ON CONFLICT DO NOTHING";
    int count = 0;
    try (var statement = sqlite.createStatement();
        ResultSet rows = statement.executeQuery(select)) {
      while (rows.next()) {
        Object[] values = new Object[columns.size()];
        for (int i = 0; i < values.length; i++) values[i] = rows.getObject(i + 1);
        count += jdbc.sql(insert).params(values).update();
      }
    }
    return count;
  }

  /** Ответы из демонстрационного кабинета (не из набора данных) — как доказательства с методом host. */
  private int copyHostFacts(Connection sqlite) throws SQLException {
    Set<String> hotels = new HashSet<>(jdbc.sql("SELECT id FROM hotel").query(String.class).list());
    Set<String> characteristics =
        new HashSet<>(jdbc.sql("SELECT code FROM characteristic").query(String.class).list());
    List<JsonNode> facts = new ArrayList<>();
    try (var statement = sqlite.createStatement();
        ResultSet rows = statement.executeQuery("SELECT body, active FROM facts WHERE seeded = 0 ORDER BY rowid")) {
      while (rows.next()) {
        com.fasterxml.jackson.databind.node.ObjectNode fact =
            (com.fasterxml.jackson.databind.node.ObjectNode) Json.read(rows.getString(1));
        fact.put("__active", rows.getInt(2) == 1);
        facts.add(fact);
      }
    }
    int count = 0;
    for (JsonNode fact : facts) {
      String hotel = Json.str(fact, "hotelId"), feature = Json.str(fact, "feature");
      if (!hotels.contains(hotel) || !characteristics.contains(feature)) continue;
      String room = fact.hasNonNull("roomId") ? Json.str(fact, "roomId") : null;
      if (room != null
          && jdbc.sql("SELECT count(*) FROM room WHERE hotel_id = ? AND id = ?")
                  .params(hotel, room)
                  .query(Long.class)
                  .single()
              == 0) continue;
      com.fasterxml.jackson.databind.node.ObjectNode raw = fact.deepCopy();
      boolean active = raw.path("__active").asBoolean(true);
      raw.remove("__active");
      count +=
          jdbc.sql(
                  """
                  INSERT INTO evidence (id, hotel_id, room_id, characteristic, value, method, source_name,
                    quote, confidence_level, confidence_reason, obtained_at, expires_at, demo, origin,
                    active, raw)
                  VALUES (?, ?, ?, ?, CAST(? AS jsonb), 'host', ?, ?, ?, ?, ?, ?, ?, 'host', ?, ?)
                  ON CONFLICT DO NOTHING
                  """)
              .params(
                  Json.str(raw, "id"),
                  hotel,
                  room,
                  feature,
                  raw.hasNonNull("value") ? Json.write(raw.get("value")) : null,
                  raw.path("source").asText(null),
                  raw.path("quote").asText(null),
                  Set.of("low", "medium", "high").contains(Json.str(raw, "confidence"))
                      ? Json.str(raw, "confidence")
                      : null,
                  raw.path("confidenceReason").asText(null),
                  timestamp(Json.str(raw, "obtainedAt")),
                  timestamp(Json.str(raw, "expiresAt")),
                  !raw.path("demo").isBoolean() || raw.path("demo").asBoolean(),
                  active,
                  Json.write(raw))
              .update();
    }
    // Замены внутри перенесённых ответов (supersededBy) восстанавливаем вторым проходом.
    for (JsonNode fact : facts)
      if (fact.hasNonNull("supersededBy"))
        jdbc.sql(
                "UPDATE evidence SET superseded_by = ? WHERE id = ? AND EXISTS (SELECT 1 FROM evidence"
                    + " WHERE id = ?)")
            .params(Json.str(fact, "supersededBy"), Json.str(fact, "id"), Json.str(fact, "supersededBy"))
            .update();
    return count;
  }

  private static Timestamp timestamp(String value) {
    try {
      return Timestamp.from(Instant.parse(value));
    } catch (RuntimeException invalid) {
      return null;
    }
  }

  private static Set<String> tables(Connection sqlite) throws SQLException {
    Set<String> result = new HashSet<>();
    try (var statement = sqlite.createStatement();
        ResultSet rows = statement.executeQuery("SELECT name FROM sqlite_master WHERE type = 'table'")) {
      while (rows.next()) result.add(rows.getString(1));
    }
    return result;
  }

  private static Set<String> columns(Connection sqlite, String table) throws SQLException {
    Set<String> result = new HashSet<>();
    try (var statement = sqlite.createStatement();
        ResultSet rows = statement.executeQuery("PRAGMA table_info(" + table + ")")) {
      while (rows.next()) result.add(rows.getString("name"));
    }
    return result;
  }
}
