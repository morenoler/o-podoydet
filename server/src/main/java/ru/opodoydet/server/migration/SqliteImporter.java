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
import java.util.Objects;
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
 * <p>Если явно задан {@code LEGACY_DB_PATH} и
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
  private static final String SYNTHETIC_DEMO_KIND = "opodoydet-synthetic-demo-v1";

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
                  "window_directions", "photos", "longitude", "latitude", "sleeping_places", "beds", "demo", "currency"),
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
                  "address", "created_at", "updated_at", "currency"),
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
          new Copy("account_listing_scopes", "account_listing_scopes", List.of("listing_id", "generation"), "listing_id"),
          new Copy("account_clarifications", "account_clarifications",
              List.of("id", "listing_id", "user_id", "feature", "question_text", "note", "trip", "context",
                  "scope_fingerprint", "created_at", "version", "request_key", "payload_hash"), "created_at"),
          new Copy("account_clarification_answers", "account_clarification_answers",
              List.of("id", "clarification_id", "host_id", "version", "value", "answer_text", "observed_on",
                  "recorded_at", "valid_from", "valid_to", "recheck_at", "scope_fingerprint", "supersedes",
                  "superseded_by", "request_key", "payload_hash", "time_zone"), "recorded_at"),
          new Copy("advisor_runs", "advisor_run", List.of("id", "created_at", "body", "owner_key", "region"), "created_at"),
          new Copy(
              "questions", "catalog_question", List.of("id", "hotel_id", "room_id", "feature", "body", "region"), "rowid"),
          new Copy("drafts", "catalog_draft", List.of("id", "question_id", "body", "region"), "rowid"));

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
    try {
      Class.forName("org.sqlite.JDBC");
    } catch (ClassNotFoundException absent) {
      throw new IllegalStateException(
          "LEGACY_DB_PATH требует отдельной сборки Maven с -Plegacy-import. Для учебных кабинетов используйте DEMO_SEED_PATH.", absent);
    }
    Path file = Path.of(path).toAbsolutePath().normalize();
    if (!Files.isRegularFile(file)) throw new IllegalArgumentException("Не найден явный источник LEGACY_DB_PATH: " + file);
    String identity = file + ":" + Files.size(file) + ":" + Files.getLastModifiedTime(file).toMillis();
    String marker = "sqlite-import:v3:" + identity;
    if (completed(marker)) return;
    if (completed("sqlite-import:v2:" + identity)) {
      try {
        restoreLegacyDemoProvenance(file);
        completedMarker(marker);
      } catch (RuntimeException | SQLException failure) {
        log.warn("Не удалось восстановить происхождение демо-образца {}: {}", file, failure.getMessage());
      }
      return;
    }

    Map<String, Integer> copied;
    try {
      copied = importFile(file);
    } catch (RuntimeException | SQLException failure) {
      // Сервер должен стартовать и без переноса; попытка повторится при следующем запуске.
      log.warn("Не удалось перенести данные из {}: {}", file, failure.getMessage());
      return;
    }
    completedMarker(marker);
    log.info("Перенесено из {}: {}", file, copied);
    if (copied.getOrDefault("evidence", 0) > 0) resolver.resolveAll();
  }

  public Map<String, Integer> importFile(Path file) throws SQLException {
    Map<String, Integer> copied = new LinkedHashMap<>();
    try (Connection sqlite = DriverManager.getConnection("jdbc:sqlite:" + file, sqliteProps())) {
      // A live SQLite source must be one read snapshot across all related tables.
      sqlite.setAutoCommit(false);
      Set<String> tables = tables(sqlite);
      boolean syntheticDemo = syntheticDemo(sqlite, tables);
      tx.executeWithoutResult(
          status -> {
            try {
              for (Copy copy : TABLES)
                if (tables.contains(copy.from())) copied.put(copy.to(), copyTable(sqlite, copy, syntheticDemo));
              if (tables.contains("facts")) copied.put("evidence", copyHostFacts(sqlite));
            } catch (SQLException e) {
              throw new IllegalStateException("Не удалось перенести " + file + ": " + e.getMessage(), e);
            }
          });
    }
    return copied;
  }

  private static java.util.Properties sqliteProps() {
    java.util.Properties properties = new java.util.Properties();
    properties.setProperty("open_mode", "1"); // SQLITE_OPEN_READONLY, without a compile-time driver dependency.
    return properties;
  }

  private boolean completed(String marker) {
    return jdbc.sql("SELECT count(*) FROM migration_marker WHERE name = ?")
        .param(marker).query(Long.class).single() > 0;
  }

  private void completedMarker(String marker) {
    jdbc.sql("INSERT INTO migration_marker (name, applied_at) VALUES (?, ?) ON CONFLICT DO NOTHING")
        .params(marker, Timestamp.from(Instant.now())).update();
  }

  private static boolean syntheticDemo(Connection sqlite, Set<String> tables) throws SQLException {
    if (!tables.contains("demo_seed_metadata")
        || !columns(sqlite, "demo_seed_metadata").containsAll(Set.of("key", "value"))) return false;
    try (var statement = sqlite.prepareStatement("SELECT value FROM demo_seed_metadata WHERE key='kind'");
        var row = statement.executeQuery()) {
      return row.next() && SYNTHETIC_DEMO_KIND.equals(row.getString(1)) && !row.next();
    }
  }

  /** Only an explicit completed v2 source with the same recorded path, size and mtime permits repair.
   * New v3 imports do not revisit collisions that they deliberately left untouched. */
  private void restoreLegacyDemoProvenance(Path file) throws SQLException {
    try (Connection sqlite = DriverManager.getConnection("jdbc:sqlite:" + file, sqliteProps())) {
      sqlite.setAutoCommit(false);
      Set<String> tables = tables(sqlite);
      if (!tables.contains("account_listings") || !syntheticDemo(sqlite, tables)) return;
      tx.executeWithoutResult(status -> {
        try (var statement = sqlite.createStatement();
            var rows = statement.executeQuery("SELECT id,host_id FROM account_listings")) {
          while (rows.next())
            jdbc.sql("UPDATE account_listings SET demo=TRUE WHERE id=? AND host_id=? AND NOT demo")
                .params(rows.getString(1), rows.getString(2)).update();
        } catch (SQLException failure) {
          throw new IllegalStateException("Не удалось прочитать происхождение объявлений", failure);
        }
      });
    }
  }

  private int copyTable(Connection sqlite, Copy copy, boolean syntheticDemo) throws SQLException {
    Set<String> available = columns(sqlite, copy.from());
    List<String> columns = new ArrayList<>(copy.columns().stream().filter(available::contains).toList());
    List<String> expressions = new ArrayList<>(columns);
    if (copy.from().equals("account_listings") && syntheticDemo) {
      int index = columns.indexOf("demo");
      if (index < 0) { columns.add("demo"); expressions.add("1"); }
      else expressions.set(index, "1");
    }
    // Main stored ownership separately, keyed by BOTH region and run id.
    if (copy.from().equals("advisor_runs") && !available.contains("owner_key")
        && available.contains("region") && tables(sqlite).contains("advisor_run_owners")) {
      columns.add("owner_key");
      expressions.add("COALESCE((SELECT o.owner_key FROM advisor_run_owners o WHERE o.region=advisor_runs.region AND o.run_id=advisor_runs.id),'legacy-unowned')");
    }
    if (copy.from().equals("account_listings") && tables(sqlite).contains("account_listing_search_profiles")) {
      Set<String> profileColumns = columns(sqlite, "account_listing_search_profiles");
      for (String name : List.of("floor", "window_directions")) {
        if (!available.contains(name) && profileColumns.contains(name)) {
          columns.add(name);
          String value = "(SELECT p." + name + " FROM account_listing_search_profiles p WHERE p.listing_id=account_listings.id)";
          expressions.add(name.equals("window_directions") ? "COALESCE(" + value + ",'[]')" : value);
        }
      }
    }
    String select =
        "SELECT " + String.join(",", expressions) + " FROM " + copy.from() + " ORDER BY " + copy.order();
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
        for (int i = 0; i < values.length; i++) {
          values[i] = rows.getObject(i + 1);
          if (copy.from().equals("account_listings") && columns.get(i).equals("demo")) {
            Object value = values[i];
            if (value instanceof Number number && (number.doubleValue() == 0 || number.doubleValue() == 1))
              values[i] = number.intValue() == 1;
            else if (!(value instanceof Boolean))
              throw new SQLException("Invalid explicit listing demo marker");
          }
        }
        verifyRegionIdentity(copy, columns, values);
        count += jdbc.sql(insert).params(values).update();
        // Also check after INSERT: a concurrent import may have won the unique id.
        verifyRegionIdentity(copy, columns, values);
      }
    }
    return count;
  }

  /** PostgreSQL uses global ids; SQLite used (region,id). Never silently lose a colliding region. */
  private void verifyRegionIdentity(Copy copy, List<String> columns, Object[] values) throws SQLException {
    if (!copy.columns().contains("region")) return;
    String id = Objects.toString(values[columns.indexOf("id")], "");
    int regionIndex = columns.indexOf("region");
    String region = regionIndex < 0 ? "" : Objects.toString(values[regionIndex], "");
    var existing = jdbc.sql("SELECT region FROM " + copy.to() + " WHERE id = ?")
        .param(id).query(String.class).optional();
    if (existing.isPresent() && !existing.get().equals(region))
      throw new SQLException("Region/id collision in " + copy.to() + ": " + id);
    if (copy.to().equals("catalog_question")) {
      String hotel = Objects.toString(values[columns.indexOf("hotel_id")], "");
      var hotelRegion = jdbc.sql("SELECT region FROM hotel WHERE id = ?")
          .param(hotel).query(String.class).optional();
      if (hotelRegion.isPresent() && !hotelRegion.get().equals(region))
        throw new SQLException("Question/hotel region collision: " + id);
    }
    if (copy.to().equals("catalog_draft")) {
      String question = Objects.toString(values[columns.indexOf("question_id")], "");
      var questionRegion = jdbc.sql("SELECT region FROM catalog_question WHERE id = ?")
          .param(question).query(String.class).optional();
      if (questionRegion.isPresent() && !questionRegion.get().equals(region))
        throw new SQLException("Draft/question region collision: " + id);
    }
  }

  private record HostFact(JsonNode raw, String region, boolean active) {
    String id() { return Json.str(raw, "id"); }
    String hotel() { return Json.str(raw, "hotelId"); }
    String room() { return raw.hasNonNull("roomId") ? Json.str(raw, "roomId") : null; }
    String feature() { return Json.str(raw, "feature"); }
  }

  /** Non-seed SQLite assertions retain their region and exact subject during migration. */
  private int copyHostFacts(Connection sqlite) throws SQLException {
    Map<String, String> hotels = new LinkedHashMap<>();
    jdbc.sql("SELECT id, region FROM hotel").query((row, number) -> {
      hotels.put(row.getString("id"), row.getString("region"));
      return row.getString("id");
    }).list();
    Set<String> characteristics =
        new HashSet<>(jdbc.sql("SELECT code FROM characteristic").query(String.class).list());
    Set<String> available = columns(sqlite, "facts");
    List<HostFact> facts = new ArrayList<>();
    try (var statement = sqlite.createStatement();
        ResultSet rows = statement.executeQuery("SELECT * FROM facts WHERE seeded = 0 ORDER BY rowid")) {
      while (rows.next()) {
        JsonNode raw = Json.read(rows.getString("body"));
        if (!raw.isObject() || Json.str(raw, "id").isBlank())
          throw new SQLException("Invalid SQLite fact identity");
        String region = available.contains("region") ? Objects.toString(rows.getString("region"), "") : "";
        HostFact fact = new HostFact(raw, region, rows.getInt("active") == 1);
        // The JSON body cannot override the source table's identity or subject.
        for (String column : List.of("id", "hotel_id", "room_id", "feature")) {
          String expected = switch (column) {
            case "id" -> fact.id(); case "hotel_id" -> fact.hotel();
            case "room_id" -> fact.room(); default -> fact.feature();
          };
          if (available.contains(column) && !Objects.equals(rows.getString(column), expected))
            throw new SQLException("SQLite fact column/body mismatch: " + fact.id() + "/" + column);
        }
        facts.add(fact);
      }
    }
    List<HostFact> inserted = new ArrayList<>();
    for (HostFact fact : facts) {
      verifyEvidenceIdentity(fact.id(), fact);
      String hotel = fact.hotel(), feature = fact.feature(), room = fact.room();
      if (!hotels.containsKey(hotel)) continue;
      if (!hotels.get(hotel).equals(fact.region()))
        throw new SQLException("Fact/hotel region collision: " + fact.id());
      if (!characteristics.contains(feature)) continue;
      if (room != null
          && jdbc.sql("SELECT count(*) FROM room WHERE hotel_id = ? AND id = ?")
                  .params(hotel, room).query(Long.class).single() == 0) continue;
      JsonNode raw = fact.raw();
      int added = jdbc.sql(
                  """
                  INSERT INTO evidence (id, hotel_id, room_id, characteristic, value, method, source_name,
                    source_url, quote, confidence_level, confidence_reason, obtained_at, source_date,
                    expires_at, demo, origin, active, raw)
                  VALUES (?, ?, ?, ?, CAST(? AS jsonb), 'host', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'host', ?, ?)
                  ON CONFLICT DO NOTHING
                  """)
              .params(fact.id(), hotel, room, feature,
                  raw.hasNonNull("value") ? Json.write(raw.get("value")) : null,
                  raw.path("source").asText(null), raw.path("sourceUrl").asText(null), raw.path("quote").asText(null),
                  Set.of("low", "medium", "high").contains(Json.str(raw, "confidence"))
                      ? Json.str(raw, "confidence") : null,
                  raw.path("confidenceReason").asText(null),
                  timestamp(Json.str(raw, "obtainedAt")), timestamp(Json.str(raw, "sourceDate")),
                  timestamp(Json.str(raw, "expiresAt")),
                  !raw.path("demo").isBoolean() || raw.path("demo").asBoolean(),
                  fact.active(), Json.write(raw)).update();
      verifyEvidenceIdentity(fact.id(), fact);
      if (added == 1) inserted.add(fact);
    }
    // Only rows inserted by this import may be changed. Existing PostgreSQL corrections win.
    for (HostFact fact : inserted) {
      if (!fact.raw().hasNonNull("supersededBy")) continue;
      String replacement = Json.str(fact.raw(), "supersededBy");
      if (replacement.equals(fact.id()) || !verifyEvidenceIdentity(replacement, fact))
        throw new SQLException("Invalid fact replacement: " + fact.id());
      jdbc.sql("UPDATE evidence SET superseded_by = ? WHERE id = ?")
          .params(replacement, fact.id()).update();
    }
    return inserted.size();
  }

  /** Returns false for absent evidence; a collision must abort the entire import transaction. */
  private boolean verifyEvidenceIdentity(String id, HostFact expected) throws SQLException {
    var found = jdbc.sql("SELECT e.hotel_id, e.room_id, e.characteristic, h.region FROM evidence e"
            + " JOIN hotel h ON h.id=e.hotel_id WHERE e.id=?")
        .param(id).query((row, number) ->
            row.getString("hotel_id").equals(expected.hotel())
                && Objects.equals(row.getString("room_id"), expected.room())
                && row.getString("characteristic").equals(expected.feature())
                && row.getString("region").equals(expected.region())).optional();
    if (found.isPresent() && !found.get())
      throw new SQLException("Evidence subject/region collision: " + id);
    return found.isPresent();
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
