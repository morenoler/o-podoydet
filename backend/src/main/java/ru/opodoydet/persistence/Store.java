package ru.opodoydet.persistence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import ru.opodoydet.domain.Evidence;
import ru.opodoydet.domain.Features;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.shared.Json;

/**
 * One synchronized JDBC connection keeps each read/modify/write operation atomic in this local
 * demo.
 */
public final class Store implements AutoCloseable {
  final Connection connection;
  public final String region;
  private String evidencePolicy = "verified-only";

  public String evidencePolicy() {
    return evidencePolicy;
  }

  public Store(String path, JsonNode seed) throws SQLException, IOException {
    region = Validation.text(seed, "region", 1, 100);
    if (!path.equals(":memory:")) {
      Path parent = Path.of(path).toAbsolutePath().getParent();
      if (parent != null) Files.createDirectories(parent);
    }
    connection = DriverManager.getConnection("jdbc:sqlite:" + path);
    try (var input = Store.class.getResourceAsStream("/schema.sql")) {
      if (input == null) throw new IOException("schema.sql not found");
      for (String sql : new String(input.readAllBytes(), StandardCharsets.UTF_8).split(";"))
        if (!sql.isBlank()) execute(sql);
      importSeed(seed);
    } catch (SQLException | IOException | RuntimeException error) {
      connection.close();
      throw error;
    }
  }

  /**
   * Synchronizes source records atomically on startup. Catalog entries are upserted, never removed
   * merely because a partial/newer source snapshot omits them. Questions, drafts and host facts
   * stay untouched. Missing source facts become inactive so omitted evidence cannot remain a
   * current claim; their rows and any supersession history remain stored.
   */
  public synchronized void importSeed(JsonNode seed) throws SQLException {
    if (!region.equals(Json.str(seed, "region"))
        || !seed.path("hotels").isArray()
        || !seed.path("facts").isArray())
      throw new IllegalArgumentException("Некорректный набор данных региона");
    transaction(
        () -> {
          ObjectNode metadata = seed.deepCopy();
          metadata.remove(List.of("hotels", "facts"));
          execute(
              "INSERT INTO metadata(region,key,body) VALUES (?,?,?) ON CONFLICT(region,key) DO"
                  + " UPDATE SET body=excluded.body",
              region,
              "dataset",
              Json.write(metadata));
          execute(
              "INSERT INTO metadata(region,key,body) VALUES (?,?,?) ON CONFLICT(region,key) DO"
                  + " UPDATE SET body=excluded.body",
              region,
              "schemaVersion",
              "1");
          execute("UPDATE facts SET active=0 WHERE region=? AND seeded=1", region);
          for (JsonNode hotel : seed.path("hotels")) {
            String hotelId = Validation.text(hotel, "id", 1, 150);
            Validation.text(hotel, "name", 1, 500);
            if (!hotel.path("rooms").isArray() || hotel.path("rooms").isEmpty())
              throw new IllegalArgumentException(
                  "Отель должен иметь хотя бы одну категорию номера");
            ObjectNode body = hotel.deepCopy();
            body.remove("rooms");
            execute(
                "INSERT INTO hotels(region,id,body,active) VALUES (?,?,?,1) ON CONFLICT(region,id)"
                    + " DO UPDATE SET body=excluded.body,active=1",
                region,
                hotelId,
                Json.write(body));
            for (JsonNode room : hotel.path("rooms")) {
              String roomId = Validation.text(room, "id", 1, 150);
              if (room.hasNonNull("capacity")) Validation.integer(room, "capacity", 1, 20);
              execute(
                  "INSERT INTO rooms(region,hotel_id,id,body,active) VALUES (?,?,?,?,1) ON"
                      + " CONFLICT(region,hotel_id,id) DO UPDATE SET body=excluded.body,active=1",
                  region,
                  hotelId,
                  roomId,
                  Json.write(room));
            }
          }
          for (JsonNode fact : seed.path("facts")) {
            String id = Validation.text(fact, "id", 1, 200),
                hotelId = Validation.text(fact, "hotelId", 1, 150),
                feature = Validation.feature(fact, "feature");
            JsonNode hotel = rawHotel(hotelId);
            if (hotel == null)
              throw new IllegalArgumentException("Факт ссылается на неизвестный отель");
            String roomId =
                fact.hasNonNull("roomId") ? Validation.text(fact, "roomId", 1, 150) : null;
            if (roomId != null && room(hotel, roomId) == null)
              throw new IllegalArgumentException("Факт ссылается на неизвестную категорию");
            execute(
                "INSERT INTO facts(region,id,hotel_id,room_id,feature,seeded,active,body) VALUES"
                    + " (?,?,?,?,?,1,1,?) ON CONFLICT(region,id) DO UPDATE SET active=1,body=CASE"
                    + " WHEN facts.seeded=1 AND json_extract(facts.body,'$.supersededBy') IS NULL"
                    + " THEN excluded.body ELSE facts.body END",
                region,
                id,
                hotelId,
                roomId,
                feature,
                Json.write(fact));
          }
          return null;
        });
    evidencePolicy =
        Evidence.demoPolicy(Json.str(seed, "evidencePolicy")) ? "demo" : "verified-only";
  }

  public synchronized ObjectNode dataset() throws SQLException {
    JsonNode saved = one("SELECT body FROM metadata WHERE region=? AND key='dataset'", region);
    ObjectNode result = saved == null ? Json.obj("region", region) : saved.deepCopy();
    result.set("hotels", Json.array(hotels()));
    result.put("evidencePolicy", evidencePolicy);
    return result;
  }

  public synchronized List<JsonNode> hotels() throws SQLException {
    List<JsonNode> hotels =
        rows("SELECT body FROM hotels WHERE region=? AND active=1 ORDER BY rowid", region);
    for (JsonNode hotel : hotels)
      ((ObjectNode) hotel)
          .set(
              "rooms",
              Json.array(
                  rows(
                      "SELECT body FROM rooms WHERE region=? AND hotel_id=? AND active=1 ORDER BY"
                          + " rowid",
                      region,
                      Json.str(hotel, "id"))));
    for (JsonNode hotel : hotels)
      ((ObjectNode) hotel)
          .set("rooms", Json.array(Evidence.rooms(hotel, Instant.now(), evidencePolicy)));
    return hotels;
  }

  public synchronized JsonNode hotel(String id) throws SQLException {
    ObjectNode hotel = (ObjectNode) rawHotel(id);
    if (hotel != null)
      hotel.set("rooms", Json.array(Evidence.rooms(hotel, Instant.now(), evidencePolicy)));
    return hotel;
  }

  private JsonNode rawHotel(String id) throws SQLException {
    ObjectNode hotel =
        (ObjectNode)
            one("SELECT body FROM hotels WHERE region=? AND id=? AND active=1", region, id);
    if (hotel != null)
      hotel.set(
          "rooms",
          Json.array(
              rows(
                  "SELECT body FROM rooms WHERE region=? AND hotel_id=? AND active=1 ORDER BY"
                      + " rowid",
                  region,
                  id)));
    return hotel;
  }

  public static JsonNode room(JsonNode hotel, String id) {
    return Json.list(hotel.path("rooms")).stream()
        .filter(r -> Json.str(r, "id").equals(id))
        .findFirst()
        .orElse(null);
  }

  public synchronized List<JsonNode> facts() throws SQLException {
    return rows("SELECT body FROM facts WHERE region=? AND active=1 ORDER BY rowid", region);
  }

  public synchronized List<JsonNode> matchingFacts() throws SQLException {
    return Evidence.demoPolicy(evidencePolicy)
        ? facts()
        : facts().stream().filter(f -> Evidence.fact(f, Instant.now())).toList();
  }

  public synchronized List<JsonNode> questions() throws SQLException {
    return rows("SELECT body FROM questions WHERE region=? ORDER BY rowid DESC", region);
  }

  public synchronized JsonNode question(String id) throws SQLException {
    return one("SELECT body FROM questions WHERE region=? AND id=?", region, id);
  }

  public synchronized JsonNode draft(String id) throws SQLException {
    return one("SELECT body FROM drafts WHERE region=? AND id=?", region, id);
  }

  public synchronized JsonNode ask(ObjectNode requested) throws SQLException {
    String hotelId = Json.str(requested, "hotelId"),
        roomId = Json.str(requested, "roomId"),
        feature = Validation.feature(requested, "feature");
    if (!Features.get(feature).tool().equals("host"))
      throw new IllegalArgumentException(
          "Это условие проверяется по независимым источникам, а не ответом отельера");
    JsonNode hotel = rawHotel(hotelId);
    if (hotel == null || room(hotel, roomId) == null)
      throw new IllegalArgumentException("Категория номера не найдена");
    return transaction(
        () -> {
          JsonNode existing =
              one(
                  "SELECT body FROM questions WHERE region=? AND hotel_id=? AND room_id=? AND"
                      + " feature=?",
                  region,
                  hotelId,
                  roomId,
                  feature);
          if (existing != null && Json.str(existing, "status").equals("open")) return existing;
          ObjectNode question = requested.deepCopy();
          String id = existing == null ? UUID.randomUUID().toString() : Json.str(existing, "id");
          question.put("id", id).put("createdAt", Instant.now().toString()).put("status", "open");
          question.remove("answer");
          execute("DELETE FROM drafts WHERE region=? AND question_id=?", region, id);
          execute(
              "INSERT INTO questions(region,id,hotel_id,room_id,feature,body) VALUES (?,?,?,?,?,?)"
                  + " ON CONFLICT(region,id) DO UPDATE SET body=excluded.body",
              region,
              id,
              hotelId,
              roomId,
              feature,
              Json.write(question));
          return question;
        });
  }

  public synchronized void saveDraft(ObjectNode draft, String expectedRevision)
      throws SQLException {
    JsonNode question = question(Json.str(draft, "questionId"));
    if (question == null || !Json.str(question, "status").equals("open"))
      throw new IllegalArgumentException("Открытый вопрос не найден");
    if (!Json.str(question, "createdAt").equals(expectedRevision))
      throw new IllegalArgumentException(
          "Вопрос был обновлён во время разбора. Откройте его заново.");
    Validation.extraction(
        draft, Json.str(question, "feature"), Validation.text(draft, "text", 3, 1500));
    execute(
        "INSERT INTO drafts(region,id,question_id,body) VALUES (?,?,?,?)",
        region,
        Validation.text(draft, "id", 1, 150),
        Json.str(draft, "questionId"),
        Json.write(draft));
  }

  public synchronized List<JsonNode> confirm(String draftId, boolean resolve) throws SQLException {
    return transaction(
        () -> {
          JsonNode draft = draft(draftId);
          if (draft == null)
            throw new IllegalArgumentException("Черновик уже сохранён или не найден.");
          JsonNode question = question(Json.str(draft, "questionId"));
          if (question == null || !Json.str(question, "status").equals("open"))
            throw new IllegalArgumentException("Вопрос уже закрыт. Создайте новое уточнение.");
          String text = Validation.text(draft, "text", 3, 1500);
          Validation.extraction(draft, Json.str(question, "feature"), text);
          if (draft.path("extractions").isEmpty())
            throw new IllegalArgumentException(
                "Сначала уточните ответ, чтобы получить однозначный факт.");
          Instant now = Instant.now();
          List<JsonNode> output = new ArrayList<>();
          for (JsonNode extraction : draft.path("extractions")) {
            ObjectNode fact =
                Json.obj(
                    "id",
                    UUID.randomUUID().toString(),
                    "hotelId",
                    question.path("hotelId"),
                    "roomId",
                    question.path("roomId"),
                    "feature",
                    extraction.path("feature"),
                    "value",
                    extraction.path("value"),
                    "source",
                    "Ответ в демонстрационном кабинете отельера",
                    "quote",
                    extraction.path("quote"),
                    "method",
                    "host",
                    "confidence",
                    "low",
                    "confidenceReason",
                    "Имитированный ответ, подтверждённый оператором демонстрации. Не подтверждение"
                        + " реального отеля.",
                    "obtainedAt",
                    now.toString(),
                    "expiresAt",
                    now.plus(30, ChronoUnit.DAYS).toString(),
                    "demo",
                    true);
            if (resolve)
              for (JsonNode old : facts())
                if (!old.hasNonNull("supersededBy")
                    && old.path("demo").asBoolean(false)
                    && old.path("hotelId").equals(fact.path("hotelId"))
                    && old.path("roomId").equals(fact.path("roomId"))
                    && old.path("feature").equals(fact.path("feature"))) {
                  ((ObjectNode) old).put("supersededBy", Json.str(fact, "id"));
                  execute(
                      "UPDATE facts SET body=? WHERE region=? AND id=?",
                      Json.write(old),
                      region,
                      Json.str(old, "id"));
                }
            execute(
                "INSERT INTO facts(region,id,hotel_id,room_id,feature,seeded,body) VALUES"
                    + " (?,?,?,?,?,0,?)",
                region,
                Json.str(fact, "id"),
                Json.str(fact, "hotelId"),
                Json.str(fact, "roomId"),
                Json.str(fact, "feature"),
                Json.write(fact));
            output.add(fact);
          }
          ObjectNode answered = question.deepCopy();
          answered.put("status", "answered").put("answer", text);
          execute(
              "UPDATE questions SET body=? WHERE region=? AND id=?",
              Json.write(answered),
              region,
              Json.str(question, "id"));
          execute(
              "DELETE FROM drafts WHERE region=? AND question_id=?",
              region,
              Json.str(question, "id"));
          return output;
        });
  }

  /** Advisor records never enter the facts or rooms tables used by matching. */
  public synchronized void saveAdvisorRun(ObjectNode run) throws SQLException {
    execute(
        "INSERT INTO advisor_runs(region,id,created_at,body) VALUES (?,?,?,?)"
            + " ON CONFLICT(region,id) DO UPDATE SET body=excluded.body",
        region,
        Json.str(run, "id"),
        Json.str(run, "createdAt"),
        Json.write(run));
  }

  public synchronized JsonNode advisorRun(String id) throws SQLException {
    return one("SELECT body FROM advisor_runs WHERE region=? AND id=?", region, id);
  }

  public synchronized List<JsonNode> advisorRuns() throws SQLException {
    return rows(
        "SELECT body FROM advisor_runs WHERE region=? ORDER BY created_at DESC LIMIT 50", region);
  }

  /** An interrupted task must never resume billable model work after a server restart. */
  public synchronized void recoverAdvisorRuns() throws SQLException {
    transaction(
        () -> {
          for (JsonNode item :
              rows(
                  "SELECT body FROM advisor_runs WHERE region=?"
                      + " AND json_extract(body,'$.status') IN ('queued','running')",
                  region)) {
            ObjectNode run = item.deepCopy();
            run.put("status", "failed")
                .put("error", "Сервер был перезапущен. Запустите подбор с помощником заново.")
                .put("updatedAt", Instant.now().toString());
            saveAdvisorRun(run);
          }
          return null;
        });
  }

  private <T> T transaction(SqlWork<T> work) throws SQLException {
    connection.setAutoCommit(false);
    try {
      T result = work.run();
      connection.commit();
      return result;
    } catch (SQLException | RuntimeException error) {
      try {
        connection.rollback();
      } catch (SQLException rollback) {
        error.addSuppressed(rollback);
      }
      throw error;
    } finally {
      connection.setAutoCommit(true);
    }
  }

  @FunctionalInterface
  private interface SqlWork<T> {
    T run() throws SQLException;
  }

  void execute(String sql, Object... arguments) throws SQLException {
    try (PreparedStatement statement = prepare(sql, arguments)) {
      statement.execute();
    }
  }

  private PreparedStatement prepare(String sql, Object... arguments) throws SQLException {
    PreparedStatement statement = connection.prepareStatement(sql);
    for (int i = 0; i < arguments.length; i++) statement.setObject(i + 1, arguments[i]);
    return statement;
  }

  private JsonNode one(String sql, Object... arguments) throws SQLException {
    List<JsonNode> found = rows(sql, arguments);
    return found.isEmpty() ? null : found.getFirst();
  }

  private List<JsonNode> rows(String sql, Object... arguments) throws SQLException {
    List<JsonNode> result = new ArrayList<>();
    try (PreparedStatement statement = prepare(sql, arguments);
        ResultSet rows = statement.executeQuery()) {
      while (rows.next()) result.add(Json.read(rows.getString(1)));
    }
    return result;
  }

  @Override
  public synchronized void close() throws SQLException {
    connection.close();
  }
}
