package ru.opodoydet.persistence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;
import ru.opodoydet.domain.Evidence;
import ru.opodoydet.domain.Features;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.server.catalog.CatalogService;
import ru.opodoydet.server.catalog.Dataset;
import ru.opodoydet.shared.Json;

/**
 * Хранилище, через которое работают перенесённые подбор, помощник и демонстрационные вопросы.
 *
 * <p>Раньше это был отдельный файл SQLite; теперь те же операции идут в PostgreSQL: каталог и
 * факты — из ядра знаний (таблицы hotel/room/evidence), история помощника и демонстрационные
 * вопросы — из своих таблиц. Публичные методы и их смысл сохранены, поэтому код подбора и
 * помощника перенесён без изменений.
 */
public final class Store {
  private final JdbcClient jdbc;
  private final CatalogService catalog;
  private final TransactionTemplate tx;
  private final Clock clock;

  public Store(JdbcClient jdbc, CatalogService catalog, TransactionTemplate tx) {
    this(jdbc, catalog, tx, Clock.systemUTC());
  }

  public Store(JdbcClient jdbc, CatalogService catalog, TransactionTemplate tx, Clock clock) {
    this.jdbc = jdbc;
    this.catalog = catalog;
    this.tx = tx;
    this.clock = clock;
  }

  public String region() {
    return catalog.dataset().map(Dataset::getRegion).orElse("");
  }

  public String evidencePolicy() {
    return catalog.dataset().map(Dataset::getEvidencePolicy).orElse("verified-only");
  }

  public ObjectNode dataset() {
    return catalog.catalog();
  }

  public List<JsonNode> hotels() {
    return catalog.legacyHotels();
  }

  public JsonNode hotel(String id) {
    return catalog.legacyHotel(id, false).orElse(null);
  }

  private JsonNode rawHotel(String id) {
    return catalog.legacyHotel(id, true).orElse(null);
  }

  public static JsonNode room(JsonNode hotel, String id) {
    return Json.list(hotel.path("rooms")).stream()
        .filter(r -> Json.str(r, "id").equals(id))
        .findFirst()
        .orElse(null);
  }

  /** Все действующие записи фактов в исходном виде, в порядке появления. */
  public List<JsonNode> facts() {
    return jdbc.sql("SELECT e.raw FROM evidence e JOIN hotel h ON h.id = e.hotel_id WHERE e.active AND h.region = ? ORDER BY e.ord")
        .param(region())
        .query(String.class)
        .list()
        .stream()
        .map(Json::read)
        .toList();
  }

  /** Факты, допустимые для подбора по старой политике (официальные и геоданные). */
  public List<JsonNode> matchingFacts() {
    List<JsonNode> facts = facts();
    Instant now = clock.instant();
    return Evidence.demoPolicy(evidencePolicy())
        ? facts
        : facts.stream().filter(f -> Evidence.fact(f, now)).toList();
  }

  // ---- Демонстрационные вопросы по каталогу (только при ACCOUNT_MODE=false) ----

  public List<JsonNode> questions() {
    return jdbc.sql("SELECT body FROM catalog_question WHERE region = ? ORDER BY ord DESC")
        .param(region())
        .query(String.class)
        .list()
        .stream()
        .map(Json::read)
        .toList();
  }

  public JsonNode question(String id) {
    return jdbc.sql("SELECT body FROM catalog_question WHERE id = ? AND region = ?")
        .params(id, region())
        .query(String.class)
        .optional()
        .map(Json::read)
        .orElse(null);
  }

  public JsonNode draft(String id) {
    return jdbc.sql("SELECT body FROM catalog_draft WHERE id = ? AND region = ?")
        .params(id, region())
        .query(String.class)
        .optional()
        .map(Json::read)
        .orElse(null);
  }

  public JsonNode ask(ObjectNode requested) {
    String hotelId = Json.str(requested, "hotelId"),
        roomId = Json.str(requested, "roomId"),
        feature = Validation.feature(requested, "feature");
    if (!Features.get(feature).tool().equals("host"))
      throw new IllegalArgumentException(
          "Это условие проверяется по независимым источникам, а не ответом отельера");
    JsonNode hotel = rawHotel(hotelId);
    if (hotel == null || room(hotel, roomId) == null)
      throw new IllegalArgumentException("Категория номера не найдена");
    return tx.execute(
        status -> {
          JsonNode existing =
              jdbc.sql(
                      "SELECT body FROM catalog_question WHERE hotel_id = ? AND room_id = ? AND"
                          + " feature = ? AND region = ?")
                  .params(hotelId, roomId, feature, region())
                  .query(String.class)
                  .optional()
                  .map(Json::read)
                  .orElse(null);
          if (existing != null && Json.str(existing, "status").equals("open")) return existing;
          ObjectNode question = requested.deepCopy();
          String id = existing == null ? UUID.randomUUID().toString() : Json.str(existing, "id");
          question.put("id", id).put("createdAt", clock.instant().toString()).put("status", "open");
          question.remove("answer");
          jdbc.sql("DELETE FROM catalog_draft WHERE question_id = ?").param(id).update();
          jdbc.sql(
                  "INSERT INTO catalog_question (id, hotel_id, room_id, feature, body, region)"
                      + " VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body")
              .params(id, hotelId, roomId, feature, Json.write(question), region())
              .update();
          return question;
        });
  }

  public void saveDraft(ObjectNode draft, String expectedRevision) {
    JsonNode question = question(Json.str(draft, "questionId"));
    if (question == null || !Json.str(question, "status").equals("open"))
      throw new IllegalArgumentException("Открытый вопрос не найден");
    if (!Json.str(question, "createdAt").equals(expectedRevision))
      throw new IllegalArgumentException(
          "Вопрос был обновлён во время разбора. Откройте его заново.");
    Validation.extraction(
        draft, Json.str(question, "feature"), Validation.text(draft, "text", 3, 1500));
    jdbc.sql("INSERT INTO catalog_draft (id, question_id, body, region) VALUES (?, ?, ?, ?)")
        .params(Validation.text(draft, "id", 1, 150), Json.str(draft, "questionId"), Json.write(draft), region())
        .update();
  }

  /** Подтверждение ответа из демонстрационного кабинета: факт пишется как демо-доказательство. */
  public List<JsonNode> confirm(String draftId, boolean resolve) {
    return tx.execute(
        status -> {
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
          Instant now = clock.instant();
          List<JsonNode> output = new ArrayList<>();
          for (JsonNode extraction : draft.path("extractions")) {
            ObjectNode fact =
                Json.obj(
                    "id", UUID.randomUUID().toString(),
                    "hotelId", question.path("hotelId"),
                    "roomId", question.path("roomId"),
                    "feature", extraction.path("feature"),
                    "value", extraction.path("value"),
                    "source", "Ответ в демонстрационном кабинете отельера",
                    "quote", extraction.path("quote"),
                    "method", "host",
                    "confidence", "low",
                    "confidenceReason",
                        "Имитированный ответ, подтверждённый оператором демонстрации. Не"
                            + " подтверждение реального отеля.",
                    "obtainedAt", now.toString(),
                    "expiresAt", now.plus(30, ChronoUnit.DAYS).toString(),
                    "demo", true);
            insertDemoFact(fact);
            if (resolve)
              for (JsonNode old : facts())
                if (!old.hasNonNull("supersededBy")
                    && old.path("demo").asBoolean(false)
                    && old.path("hotelId").equals(fact.path("hotelId"))
                    && old.path("roomId").equals(fact.path("roomId"))
                    && old.path("feature").equals(fact.path("feature"))
                    && !Json.str(old, "id").equals(Json.str(fact, "id"))) {
                  ((ObjectNode) old).put("supersededBy", Json.str(fact, "id"));
                  jdbc.sql("UPDATE evidence SET raw = ?, superseded_by = ? WHERE id = ?")
                      .params(Json.write(old), Json.str(fact, "id"), Json.str(old, "id"))
                      .update();
                }
            output.add(fact);
          }
          ObjectNode answered = question.deepCopy();
          answered.put("status", "answered").put("answer", text);
          jdbc.sql("UPDATE catalog_question SET body = ? WHERE id = ?")
              .params(Json.write(answered), Json.str(question, "id"))
              .update();
          jdbc.sql("DELETE FROM catalog_draft WHERE question_id = ?")
              .param(Json.str(question, "id"))
              .update();
          return output;
        });
  }

  private void insertDemoFact(ObjectNode fact) {
    Instant now = Instant.parse(Json.str(fact, "obtainedAt"));
    jdbc.sql(
            """
            INSERT INTO evidence (id, hotel_id, room_id, characteristic, value, method, source_name,
              quote, confidence_level, confidence_reason, obtained_at, expires_at, demo, origin,
              active, raw)
            VALUES (?, ?, ?, ?, CAST(? AS jsonb), 'host', ?, ?, 'low', ?, ?, ?, TRUE, 'host', TRUE, ?)
            """)
        .params(
            Json.str(fact, "id"),
            Json.str(fact, "hotelId"),
            Json.str(fact, "roomId"),
            Json.str(fact, "feature"),
            Json.write(fact.path("value")),
            Json.str(fact, "source"),
            Json.str(fact, "quote"),
            Json.str(fact, "confidenceReason"),
            Timestamp.from(now),
            Timestamp.from(Instant.parse(Json.str(fact, "expiresAt"))),
            Json.write(fact))
        .update();
  }

  // ---- История помощника подбора ----

  /** Записи помощника никогда не попадают в факты или категории, по которым идёт подбор. */
  public void saveAdvisorRun(ObjectNode run) throws SQLException {
    int changed = jdbc.sql(
            "INSERT INTO advisor_run (id, created_at, body, region) VALUES (?, ?, ?, ?)"
                + " ON CONFLICT (id) DO UPDATE SET body = excluded.body WHERE advisor_run.region = excluded.region")
        .params(Json.str(run, "id"), Json.str(run, "createdAt"), Json.write(run), region()).update();
    if (changed != 1)
      throw new IllegalArgumentException("Идентификатор запуска уже принадлежит другому региону.");
  }

  /** Ownership never enters the model-visible JSON and is immutable after insertion. */
  public void createAdvisorRun(ObjectNode run, String owner) throws SQLException {
    requireAdvisorOwner(owner);
    jdbc.sql("INSERT INTO advisor_run (id, created_at, body, owner_key, region) VALUES (?, ?, ?, ?, ?)")
        .params(Json.str(run, "id"), Json.str(run, "createdAt"), Json.write(run), owner, region()).update();
  }

  public JsonNode advisorRun(String id, String owner) throws SQLException {
    requireAdvisorOwner(owner);
    return jdbc.sql("SELECT body FROM advisor_run WHERE id = ? AND owner_key = ? AND region = ?")
        .params(id, owner, region()).query(String.class).optional().map(Json::read).orElse(null);
  }

  public List<JsonNode> advisorRuns(String owner) throws SQLException {
    requireAdvisorOwner(owner);
    return jdbc.sql("SELECT body FROM advisor_run WHERE owner_key = ? AND region = ? ORDER BY created_at DESC LIMIT 50")
        .params(owner, region()).query(String.class).list().stream().map(Json::read).toList();
  }

  private static void requireAdvisorOwner(String owner) {
    if (owner == null || owner.isBlank() || owner.length() > 160)
      throw new IllegalArgumentException("Не задан владелец истории помощника.");
  }

  public JsonNode advisorRun(String id) throws SQLException {
    return jdbc.sql("SELECT body FROM advisor_run WHERE id = ? AND region = ?")
        .params(id, region())
        .query(String.class)
        .optional()
        .map(Json::read)
        .orElse(null);
  }

  public List<JsonNode> advisorRuns() throws SQLException {
    return jdbc.sql("SELECT body FROM advisor_run WHERE region = ? ORDER BY created_at DESC LIMIT 50")
        .param(region())
        .query(String.class)
        .list()
        .stream()
        .map(Json::read)
        .toList();
  }

  /** Прерванное задание после перезапуска сервера не продолжается (и не тратит модель). */
  public void recoverAdvisorRuns() throws SQLException {
    tx.executeWithoutResult(
        status -> {
          for (String body : jdbc.sql("SELECT body FROM advisor_run").query(String.class).list()) {
            ObjectNode run = (ObjectNode) Json.read(body);
            String state = Json.str(run, "status");
            if (!state.equals("queued") && !state.equals("running")) continue;
            run.put("status", "failed")
                .put("error", "Сервер был перезапущен. Запустите подбор с помощником заново.")
                .put("updatedAt", clock.instant().toString());
            jdbc.sql("UPDATE advisor_run SET body = ? WHERE id = ?")
                .params(Json.write(run), Json.str(run, "id"))
                .update();
          }
        });
  }
}
