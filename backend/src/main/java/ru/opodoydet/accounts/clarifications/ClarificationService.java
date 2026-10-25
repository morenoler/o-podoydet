package ru.opodoydet.accounts.clarifications;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.time.*;
import java.util.*;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.Inputs;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.accounts.search.OwnerNotesExtractor;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.shared.Json;

/** Private, explicit owner statements. Ordinary public Q&A is never parsed into evidence. */
public final class ClarificationService {
  public static final Set<String> FEATURES = Set.of("family", "courtyard", "step_free_access");
  private static final ZoneId ZONE = ZoneId.of("Asia/Seoul");
  private final AccountDatabase db;
  private final ListingService listings;
  private final ClarificationRepository repository;
  private final Clock clock;

  public ClarificationService(AccountDatabase db, ListingService listings) {
    this(db, listings, Clock.systemUTC());
  }
  public ClarificationService(AccountDatabase db, ListingService listings, Clock clock) {
    this.db = db;
    this.listings = listings;
    this.repository = new ClarificationRepository(db);
    this.clock = clock;
  }

  public List<ObjectNode> user(String user) throws SQLException {
    return db.transaction(() -> dtos(repository.user(user), false));
  }
  public List<ObjectNode> host(String host) throws SQLException {
    return db.transaction(() -> dtos(repository.host(host), true));
  }

  public ObjectNode ask(String user, String listingId, JsonNode input) throws SQLException {
    fields(input, Set.of("feature", "trip", "note", "requestKey"));
    String feature = Inputs.text(input, "feature", "Условие", 1, 40);
    if (!FEATURES.contains(feature)) throw new AccountProblem(400, "Это условие нельзя подтвердить ответом владельца.");
    String key = key(input), note = Inputs.optional(input, "note", "Уточнение", 1000);
    JsonNode trip = input.path("trip");
    fields(trip, Set.of("region", "checkIn", "checkOut", "adults", "children", "scenarios", "preferences", "text", "admissionMode"));
    try { Validation.trip(trip, "Пусан"); }
    catch (IllegalArgumentException invalid) { throw new AccountProblem(400, invalid.getMessage()); }
    ObjectNode payload = Json.obj("listingId", listingId, "feature", feature, "trip", trip, "note", note);
    String hash = hash(payload);
    return db.transaction(() -> {
      ObjectNode replay = repository.askReplay(user, key);
      if (replay != null) {
        replay(hash, replay);
        return dto(replay, false);
      }
      ObjectNode listing = listings.published(listingId);
      if (!Json.str(listing, "city").equalsIgnoreCase(Json.str(trip, "region")))
        throw new AccountProblem(400, "Объявление находится в другом регионе поездки.");
      String id = UUID.randomUUID().toString();
      ObjectNode context = Json.obj("checkIn", trip.path("checkIn"), "checkOut", trip.path("checkOut"),
          "adults", trip.path("adults"), "children", trip.path("children"));
      db.execute("INSERT INTO account_clarifications(id,listing_id,user_id,feature,question_text,note,trip,context,scope_fingerprint,created_at,request_key,payload_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          id, listingId, user, feature, question(feature), note, Json.write(trip), Json.write(context),
          ClarificationScope.fingerprint(listing, db), clock.instant().toString(), key, hash);
      return dto(repository.find(id), false);
    });
  }

  public ObjectNode answer(String host, String id, JsonNode input) throws SQLException {
    fields(input, Set.of("expectedVersion", "requestKey", "value", "text", "observedOn", "validFrom", "validTo", "validForDays", "supersedes"));
    String key = key(input), text = Inputs.text(input, "text", "Ответ", 2, 3000);
    int expected = Inputs.integer(input, "expectedVersion", "Версия", 0, 1000000);
    int days = Inputs.integer(input, "validForDays", "Срок перепроверки", 1, 90);
    JsonNode value = input.path("value");
    if (!value.isBoolean() && !value.isNull()) throw new AccountProblem(400, "Укажите да, нет или неизвестно.");
    LocalDate observed = nullableDate(input, "observedOn"), from = nullableDate(input, "validFrom"), to = nullableDate(input, "validTo");
    LocalDate today = LocalDate.now(clock.withZone(ZONE));
    if (observed != null && observed.isAfter(today)) throw new AccountProblem(400, "Дата сведений не может быть в будущем.");
    if ((from == null) != (to == null) || (from != null && to.isBefore(from)))
      throw new AccountProblem(400, "Укажите обе даты периода применимости в правильном порядке.");
    JsonNode requestedSupersedes = input.path("supersedes");
    if (!requestedSupersedes.isArray() || requestedSupersedes.size() > 30)
      throw new AccountProblem(400, "Некорректный список исправляемых ответов.");
    Set<String> supersedes = new LinkedHashSet<>();
    for (JsonNode old : requestedSupersedes) {
      if (!old.isTextual() || !old.asText().matches("[A-Za-z0-9_-]{1,100}") || !supersedes.add(old.asText()))
        throw new AccountProblem(400, "Некорректный или повторный идентификатор ответа.");
    }
    ObjectNode payload = Json.obj("id", id, "expectedVersion", expected, "value", value, "text", text,
        "observedOn", string(observed), "validFrom", string(from), "validTo", string(to),
        "validForDays", days, "supersedes", supersedes.stream().sorted().toList());
    String hash = hash(payload);
    return db.transaction(() -> {
      ObjectNode question = repository.find(id);
      if (question == null) throw new AccountProblem(404, "Уточнение не найдено.");
      String listingId = Json.str(question, "listing_id");
      ObjectNode listing = listings.owned(listingId, host);
      // This bounded grammar catches known explicit contradictions, not arbitrary prose.
      // The owner still explicitly supplies the structured statement; text is not auto-published as fact.
      if (value.isBoolean()) {
        String feature = Json.str(question, "feature");
        StatementTextGuard.check(feature, value.asBoolean(), text);
      }
      ObjectNode replay = repository.answerReplay(host, key);
      if (replay != null) {
        replay(hash, replay);
        return dto(question, true);
      }
      if (question.path("version").asInt() != expected)
        throw new AccountProblem(409, "Ответ уже изменился. Обновите уточнения перед сохранением.");
      String fingerprint = ClarificationScope.fingerprint(listing, db);
      if (!fingerprint.equals(Json.str(question, "scope_fingerprint")))
        throw new AccountProblem(409, "Параметры размещения изменились. Для нового варианта нужен новый вопрос.");
      for (String previous : supersedes) {
        ObjectNode old = repository.answer(previous);
        if (old == null || !Json.str(old, "listing_id").equals(listingId)
            || !Json.str(old, "feature").equals(Json.str(question, "feature"))
            || !Json.str(old, "host_id").equals(host)
            || old.hasNonNull("superseded_by") || old.path("version").asInt() != old.path("current_version").asInt())
          throw new AccountProblem(409, "Исправлять можно только действующую версию своего ответа об этом же размещении и условии.");
      }
      String answerId = UUID.randomUUID().toString(), now = clock.instant().toString();
      String recheckAt = (observed == null ? today : observed).plusDays(days).atStartOfDay(ZONE).toInstant().toString();
      db.execute("INSERT INTO account_clarification_answers(id,clarification_id,host_id,version,value,answer_text,observed_on,recorded_at,valid_from,valid_to,recheck_at,scope_fingerprint,supersedes,request_key,payload_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          answerId, id, host, expected + 1, value.isNull() ? null : value.asBoolean() ? 1 : 0, text,
          string(observed), now, string(from), string(to), recheckAt, fingerprint, Json.write(supersedes), key, hash);
      // Revisions replace only the answer in this dialogue; other dialogues require explicit IDs.
      db.execute("UPDATE account_clarification_answers SET superseded_by=? WHERE clarification_id=? AND version=? AND superseded_by IS NULL", answerId, id, expected);
      for (String previous : supersedes)
        db.execute("UPDATE account_clarification_answers SET superseded_by=? WHERE id=? AND superseded_by IS NULL", answerId, previous);
      db.execute("UPDATE account_clarifications SET version=? WHERE id=?", expected + 1, id);
      return dto(repository.find(id), true);
    });
  }

  private ObjectNode dto(ObjectNode row, boolean host) throws SQLException {
    return dtos(List.of(row), host).getFirst();
  }

  private record ListingEvidence(String fingerprint, Map<String, Boolean> profileValues,
      Set<String> profileConflicts, List<JsonNode> statements, Map<String, List<JsonNode>> related) {}

  /** Request-local reuse keeps every history and reads all projections from one transaction. */
  private List<ObjectNode> dtos(List<ObjectNode> rows, boolean host) throws SQLException {
    Instant now = clock.instant();
    Map<String, List<ObjectNode>> histories = repository.histories(rows.stream().map(row -> Json.str(row, "id")).toList());
    Map<String, ListingEvidence> evidence = new HashMap<>();
    List<ObjectNode> result = new ArrayList<>();
    for (ObjectNode row : rows) {
      String listingId = Json.str(row, "listing_id");
      ListingEvidence source = evidence.get(listingId);
      if (source == null) {
        ObjectNode listing = listings.owned(listingId, Json.str(row, "hostId"));
        String fingerprint = ClarificationScope.fingerprint(listing, db);
        List<JsonNode> statements = repository.statements(listingId).stream()
            .map(answer -> (JsonNode) statement(answer, fingerprint, now)).toList();
        var profile = OwnerNotesExtractor.assess(Json.str(listing.path("searchProfile"), "notes"));
        Map<String, List<JsonNode>> related = new HashMap<>();
        if (host) for (JsonNode item : statements) {
          if (!Json.str(item, "state").equals("superseded"))
            related.computeIfAbsent(Json.str(item, "feature"), ignored -> new ArrayList<>()).add(item);
        }
        source = new ListingEvidence(fingerprint, profile.values(), profile.conflicts(), statements, related);
        evidence.put(listingId, source);
      }
      result.add(dto(row, host, source, histories.getOrDefault(Json.str(row, "id"), List.of()), now));
    }
    return result;
  }

  private ObjectNode dto(ObjectNode row, boolean host, ListingEvidence source, List<ObjectNode> answers, Instant now) {
    String listingId = Json.str(row, "listing_id"), fingerprint = source.fingerprint();
    String feature = Json.str(row, "feature");
    var decision = ReportedEvidence.combine(source.profileValues().get(feature), source.profileConflicts().contains(feature),
        ReportedEvidence.assess(source.statements(), feature, Json.read(Json.str(row, "trip"))));
    List<ObjectNode> history = new ArrayList<>();
    for (ObjectNode answer : answers) {
      ObjectNode item = statement(answer, fingerprint, now);
      item.put("version", answer.path("version").asInt()).put("text", Json.str(answer, "answer_text"));
      item.set("supersedes", Json.read(Json.str(answer, "supersedes")));
      history.add(item);
    }
    ObjectNode result = Json.obj("id", row.path("id"), "listingId", listingId,
        "listingTitle", row.path("listingTitle"), "roomId", "account-room:" + listingId,
        "feature", row.path("feature"), "text", row.path("question_text"), "note", row.path("note"),
        "createdAt", row.path("created_at"), "status", history.isEmpty() ? "open" : "answered",
        "scopeChanged", !fingerprint.equals(Json.str(row, "scope_fingerprint")),
        "evidenceStatus", decision.status(),
        "version", row.path("version"), "context", Json.read(Json.str(row, "context")),
        "answer", history.isEmpty() ? null : history.getLast(), "history", history);
    if (!host) result.set("trip", Json.read(Json.str(row, "trip")));
    else result.set("relatedStatements", Json.array(source.related().getOrDefault(feature, List.of())));
    return result;
  }

  public static ObjectNode statement(JsonNode row, String fingerprint, Instant now) {
    String state = row.hasNonNull("superseded_by") || row.path("version").asInt() < row.path("current_version").asInt()
        ? "superseded" : !fingerprint.equals(Json.str(row, "scope_fingerprint")) ? "scope_changed"
        : !Instant.parse(Json.str(row, "recheck_at")).isAfter(now) ? "stale" : "active";
    return Json.obj("id", row.path("id"), "feature", row.path("feature"),
        "value", row.path("value").isNull() ? null : row.path("value").asInt() == 1,
        "observedOn", row.path("observed_on"), "recordedAt", row.path("recorded_at"),
        "validFrom", row.path("valid_from"), "validTo", row.path("valid_to"),
        "recheckAt", row.path("recheck_at"), "scope", "listing_unit", "scopeId", row.path("listing_id"), "state", state);
  }

  private static String question(String feature) {
    return switch (feature) {
      case "courtyard" -> "Все окна именно предлагаемого варианта размещения выходят во двор? Уточните, если стороны окон различаются.";
      case "step_free_access" -> "Можно ли пройти от улицы до именно предлагаемого варианта размещения без ступеней, включая вход, путь к лифту и выход из него? Если есть препятствия, опишите их и доступный обход.";
      case "family" -> "Разрешено ли размещение с детьми именно в предлагаемом варианте? Укажите ограничения, если они есть; вместимость проверяется отдельно.";
      default -> throw new IllegalArgumentException("Unsupported feature");
    };
  }
  private static String key(JsonNode input) {
    String value = Inputs.text(input, "requestKey", "Ключ запроса", 8, 100);
    if (!value.matches("[A-Za-z0-9_-]+")) throw new AccountProblem(400, "Некорректный ключ запроса.");
    return value;
  }
  private static LocalDate nullableDate(JsonNode input, String field) {
    if (input.path(field).isNull()) return null;
    LocalDate date = Inputs.date(input, field, field);
    if (date.getYear() < 2000 || date.getYear() > 2100) throw new AccountProblem(400, "Дата вне допустимого диапазона.");
    return date;
  }
  private static String string(LocalDate date) { return date == null ? null : date.toString(); }
  private static void fields(JsonNode input, Set<String> accepted) {
    if (!input.isObject()) throw new AccountProblem(400, "Ожидается JSON-объект.");
    input.fieldNames().forEachRemaining(name -> {
      if (!accepted.contains(name)) throw new AccountProblem(400, "Неизвестное поле: " + name);
    });
  }
  private static void replay(String hash, JsonNode old) {
    if (!hash.equals(Json.str(old, "payload_hash")))
      throw new AccountProblem(409, "Ключ запроса уже использован с другими данными.");
  }
  private static String hash(JsonNode value) {
    return ClarificationScope.hash(Json.write(sorted(value)));
  }
  private static JsonNode sorted(JsonNode value) {
    if (value.isObject()) {
      ObjectNode sorted = Json.obj();
      List<String> names = new ArrayList<>();
      value.fieldNames().forEachRemaining(names::add);
      names.stream().sorted().forEach(name -> sorted.set(name, sorted(value.path(name))));
      return sorted;
    }
    if (value.isArray()) return Json.array(Json.list(value).stream().map(ClarificationService::sorted).toList());
    return value;
  }
}
