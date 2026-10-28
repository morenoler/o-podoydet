package ru.opodoydet.accounts.shortlists;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.shared.Json;

/** Owner-scoped choice notes; no evidence or booking confirmation is inferred from saving. */
public final class ShortlistService {
  private final AccountDatabase db;
  private final Clock clock;
  private final SecureRandom random = new SecureRandom();
  private static final Set<String> STAGES = Set.of("considering", "clarify", "availability", "chosen");

  public ShortlistService(AccountDatabase db, Clock clock) { this.db = db; this.clock = clock; }

  public ObjectNode get(String owner) throws SQLException {
    var row = db.one("SELECT payload, revision, updated_at AS updatedAt FROM account_shortlists WHERE owner_id=?", owner);
    ObjectNode value = row == null ? empty() : (ObjectNode) Json.read(row.path("payload").asText());
    if (row != null) {
      value.put("revision", row.path("revision").asLong());
      value.put("updatedAt", row.path("updatedAt").asText());
    }
    value.put("shareActive", db.one("SELECT owner_id FROM account_shortlist_shares WHERE owner_id=? AND expires_at>?", owner, clock.instant().toString()) != null);
    return value;
  }

  public ObjectNode save(String owner, JsonNode request) throws SQLException {
    ObjectNode payload = validate(request);
    long expected = revision(request);
    return db.transaction(() -> {
      db.lockRequest(owner, "shortlist");
      ObjectNode current = get(owner);
      checkRevision(current, expected);
      String now = clock.instant().toString();
      db.execute("INSERT INTO account_shortlists(owner_id,payload,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET payload=EXCLUDED.payload,revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at",
          owner, Json.write(payload), expected + 1, now);
      return get(owner);
    });
  }

  public ObjectNode share(String owner, JsonNode request) throws SQLException {
    long expected = revision(request);
    return db.transaction(() -> {
      db.lockRequest(owner, "shortlist");
      ObjectNode current = get(owner);
      checkRevision(current, expected);
      if (current.path("items").isEmpty()) throw new AccountProblem(400, "Сначала сохраните варианты для поездки.");
      Instant now = clock.instant();
      String expires = now.plus(30, ChronoUnit.DAYS).toString();
      ObjectNode projection = Json.obj("title", current.path("title").asText(), "sharedAt", now.toString(), "expiresAt", expires);
      if (current.path("trip").isObject()) {
        ObjectNode trip = Json.obj();
        for (String key : List.of("region", "checkIn", "checkOut", "adults", "children", "preferences")) trip.set(key, current.path("trip").path(key));
        projection.set("trip", trip);
      } else projection.putNull("trip");
      var items = projection.putArray("items");
      for (JsonNode item : current.path("items")) {
        ObjectNode visible = Json.obj();
        for (String key : List.of("id", "name", "path", "hotelId", "photos", "address")) if (item.has(key)) visible.set(key, item.path(key));
        items.add(visible);
      }
      byte[] bytes = new byte[32]; random.nextBytes(bytes);
      String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
      db.execute("INSERT INTO account_shortlist_shares(owner_id,token_hash,payload,expires_at) VALUES(?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at",
          owner, hash(token), Json.write(projection), expires);
      return Json.obj("token", token, "expiresAt", expires);
    });
  }

  public ObjectNode revoke(String owner) throws SQLException {
    return db.transaction(() -> {
      db.lockRequest(owner, "shortlist");
      db.execute("DELETE FROM account_shortlist_shares WHERE owner_id=?", owner);
      return Json.obj("ok", true);
    });
  }

  public JsonNode shared(String token) throws SQLException {
    if (!token.matches("[A-Za-z0-9_-]{43}")) throw unavailable();
    var row = db.one("SELECT payload FROM account_shortlist_shares WHERE token_hash=? AND expires_at>?", hash(token), clock.instant().toString());
    if (row == null) throw unavailable();
    return Json.read(row.path("payload").asText());
  }

  private static AccountProblem unavailable() { return new AccountProblem(404, "Ссылка недоступна: владелец мог закрыть доступ или срок ссылки истёк."); }
  private static ObjectNode empty() { return Json.obj("title", "Моя поездка в Пусан", "trip", null, "items", List.of(), "revision", 0, "updatedAt", null); }
  private static long revision(JsonNode value) {
    JsonNode revision = value.path("revision");
    if (!revision.isIntegralNumber() || !revision.canConvertToLong() || revision.asLong() < 0 || revision.asLong() == Long.MAX_VALUE)
      throw new AccountProblem(400, "Некорректная версия подборки.");
    return revision.asLong();
  }
  private static void checkRevision(JsonNode current, long expected) {
    if (current.path("revision").asLong() != expected)
      throw new AccountProblem(409, "Подборка изменена на другом устройстве. Загружена свежая версия; повторите изменение.");
  }
  private static String bounded(JsonNode node, String key, int min, int max) {
    String value = Validation.text(node, key, min, max).trim();
    if (value.length() < min) throw new AccountProblem(400, "Заполните поле: " + key);
    return value;
  }

  static ObjectNode validate(JsonNode input) {
    if (!input.isObject()) throw new AccountProblem(400, "Ожидается подборка.");
    ObjectNode result = Json.obj("title", bounded(input, "title", 1, 100));
    if (input.hasNonNull("trip")) {
      JsonNode trip = Validation.tripDraft(input.path("trip"), "Пусан");
      ObjectNode clean = Json.obj();
      for (String key : List.of("region", "checkIn", "checkOut", "adults", "children", "scenarios", "preferences", "text", "preferenceOverrides", "admissionMode", "locationWishes", "pendingLocationQuery"))
        if (trip.has(key)) clean.set(key, trip.path(key));
      result.set("trip", clean);
    } else result.putNull("trip");
    JsonNode inputItems = input.path("items");
    if (!inputItems.isArray() || inputItems.size() > 200) throw new AccountProblem(400, "Сохраните не больше 200 вариантов.");
    Set<String> unique = new HashSet<>();
    var items = result.putArray("items");
    for (JsonNode item : inputItems) {
      String id = bounded(item, "id", 1, 300), path = bounded(item, "path", 1, 1000);
      if (!unique.add(id)) throw new AccountProblem(400, "Варианты повторяются.");
      if (!path.matches("^/(stays|hotels)/[^/?#\\\\\\s<>]+(?:\\?room=[^&#\\\\\\s<>]+)?$")) throw new AccountProblem(400, "Некорректная ссылка на вариант.");
      ObjectNode clean = Json.obj("id", id, "name", bounded(item, "name", 1, 300), "path", path);
      for (String key : List.of("hotelId", "address", "note"))
        if (item.has(key)) clean.put(key, bounded(item, key, 0, key.equals("note") ? 1500 : 500));
      String stage = item.path("stage").asText("considering");
      if (!STAGES.contains(stage)) throw new AccountProblem(400, "Выберите следующий шаг для варианта.");
      clean.put("stage", stage);
      if (item.has("savedAt")) {
        String saved = bounded(item, "savedAt", 1, 40);
        try { Instant.parse(saved); } catch (RuntimeException invalid) { throw new AccountProblem(400, "Некорректная дата сохранения."); }
        clean.put("savedAt", saved);
      }
      if (item.has("photos")) {
        if (!item.path("photos").isArray() || item.path("photos").size() > 12) throw new AccountProblem(400, "Некорректные фотографии.");
        var photos = clean.putArray("photos");
        for (JsonNode photo : item.path("photos")) {
          if (!photo.isTextual() || !safePhoto(photo.asText())) throw new AccountProblem(400, "Некорректный адрес фотографии.");
          photos.add(photo);
        }
      }
      items.add(clean);
    }
    return result;
  }

  private static boolean safePhoto(String value) {
    if (value.length() > 2048) return false;
    if (value.matches("^/uploads/listings/[0-9a-f-]{36}\\.(jpg|png)$")) return true;
    if (value.matches("^/images/[A-Za-z0-9_./-]+$") && !value.endsWith("/") && !value.contains("//") && !List.of(value.split("/")).contains("..") && !List.of(value.split("/")).contains(".")) return true;
    try {
      URI uri = URI.create(value);
      return "https".equals(uri.getScheme()) && uri.getHost() != null && uri.getUserInfo() == null;
    } catch (RuntimeException invalid) { return false; }
  }
  private static String hash(String token) {
    try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); }
    catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
  }
}
