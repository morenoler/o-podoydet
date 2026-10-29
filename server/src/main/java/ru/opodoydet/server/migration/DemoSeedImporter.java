package ru.opodoydet.server.migration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import ru.opodoydet.accounts.auth.Passwords;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;

/** Explicit, atomic synthetic account seed; ordinary runtime never needs a SQLite driver. */
@Component
public final class DemoSeedImporter {
  private static final String KIND = "opodoydet-synthetic-demo-json-v1";
  private static final String MARKER = "account-demo-json:v1";
  private final JdbcClient jdbc;
  private final TransactionTemplate tx;
  private final ObjectMapper json;
  private final RuntimeEnv env;

  public DemoSeedImporter(JdbcClient jdbc, TransactionTemplate tx, ObjectMapper json, RuntimeEnv env) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.json = json;
    this.env = env;
  }

  public void run() throws IOException {
    String source = env.get("DEMO_SEED_PATH", "");
    if (source.isBlank()) return;
    if (!env.get("LEGACY_DB_PATH", "").isBlank())
      throw new IllegalArgumentException("Выберите DEMO_SEED_PATH или LEGACY_DB_PATH, а не оба источника.");
    Path path = Path.of(source);
    if (!Files.isRegularFile(path) || Files.size(path) > 2 * 1024 * 1024)
      throw new IllegalArgumentException("DEMO_SEED_PATH должен указывать на JSON-образец до 2 МБ.");
    importSeed(json.readTree(path.toFile()));
  }

  /** Returns false after the first successful import; preserves all later user edits. */
  public boolean importSeed(JsonNode seed) {
    if (!"true".equals(env.get("DEMO_MODE", "false")))
      throw new IllegalArgumentException("Учебные аккаунты требуют явного DEMO_MODE=true.");
    String schema = jdbc.sql("SELECT current_schema()").query(String.class).single();
    if (schema == null || schema.equals("public") || !schema.equals(env.get("DB_SCHEMA", "public")))
      throw new IllegalArgumentException("Учебным аккаунтам нужна отдельная явно выбранная схема PostgreSQL.");
    JsonNode fixture = seed.path("fixtures");
    validate(seed, fixture);
    LocalDate date = LocalDate.parse(seed.path("seedDate").asText());
    return Boolean.TRUE.equals(tx.execute(status -> {
      jdbc.sql("SELECT pg_advisory_xact_lock(763298415)").query((row, number) -> 1).single();
      if (jdbc.sql("SELECT count(*) FROM migration_marker WHERE name=?").param(MARKER).query(Long.class).single() > 0)
        return false;
      // Refuse to merge public demo credentials into a pre-existing user database.
      jdbc.sql("LOCK TABLE account_users, account_listings, account_bookings, account_questions IN EXCLUSIVE MODE").update();
      if (jdbc.sql("SELECT (SELECT count(*) FROM account_users) + (SELECT count(*) FROM account_listings)"
          + " + (SELECT count(*) FROM account_bookings) + (SELECT count(*) FROM account_questions)")
          .query(Long.class).single() != 0)
        throw new IllegalStateException("Схема уже содержит кабинеты. Для демо выберите новую пустую схему.");
      JsonNode user = role(fixture, "user"), host = role(fixture, "host");
      for (JsonNode account : fixture.path("accounts"))
        jdbc.sql("INSERT INTO account_users(id,email,password_hash,role,name,phone,about,created_at) VALUES(?,?,?,?,?,'',?,?)")
            .params(text(account,"id"),text(account,"email"),Passwords.hash(text(account,"password")),
                text(account,"role"),text(account,"name"),text(account,"about"),time(date,-150)).update();
      int index = 0;
      for (JsonNode listing : fixture.path("listings")) {
        jdbc.sql("""
            INSERT INTO account_listings(id,host_id,title,description,city,address,room_type,capacity,
              price_per_night,amenities,status,created_at,updated_at,floor,window_directions,photos,
              longitude,latitude,sleeping_places,beds,demo)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,true)
            """)
            .params(text(listing,"id"),text(host,"id"),text(listing,"title"),text(listing,"description"),
                text(listing,"city"),text(listing,"address"),text(listing,"roomType"),listing.path("capacity").asInt(),
                listing.path("pricePerNight").asInt(),write(listing.path("amenities")),text(listing,"status"),
                time(date,-120+index),time(date,-10+index),integer(listing,"floor"),write(listing.path("windowDirections")),"[]",
                coordinate(listing,0),coordinate(listing,1),integer(listing,"sleepingPlaces"),write(listing.path("beds"))).update();
        jdbc.sql("INSERT INTO account_listing_search_profiles(listing_id,notes) VALUES(?,?)")
            .params(text(listing,"id"),text(listing,"notes")).update();
        index++;
      }
      index = 0;
      for (JsonNode booking : fixture.path("bookings")) {
        JsonNode listing = fixture.path("listings").get(booking.path("listing").asInt());
        int nights = booking.path("checkOutDays").asInt() - booking.path("checkInDays").asInt();
        long price = booking.path("pricePerNight").asLong();
        jdbc.sql("""
            INSERT INTO account_bookings(id,listing_id,user_id,check_in,check_out,guests,nights,
              price_per_night,total_price,status,note,listing_title,city,address,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """)
            .params("44444444-4444-4444-8444-44444444400"+(++index),text(listing,"id"),text(user,"id"),
                date.plusDays(booking.path("checkInDays").asInt()).toString(),date.plusDays(booking.path("checkOutDays").asInt()).toString(),
                booking.path("guests").asInt(),nights,price,nights*price,text(booking,"status"),text(booking,"note"),
                text(listing,"title"),text(listing,"city"),text(listing,"address"),time(date,booking.path("createdDays").asInt()),
                time(date,booking.path("updatedDays").asInt())).update();
      }
      index = 0;
      for (JsonNode question : fixture.path("questions")) {
        JsonNode listing = fixture.path("listings").get(question.path("listing").asInt());
        jdbc.sql("INSERT INTO account_questions(id,listing_id,user_id,text,answer,created_at,answered_at) VALUES(?,?,?,?,?,?,?)")
            .params("55555555-5555-4555-8555-55555555500"+(++index),text(listing,"id"),text(user,"id"),text(question,"text"),
                question.path("answer").isNull() ? null : text(question,"answer"),time(date,question.path("createdDays").asInt()),
                question.path("answer").isNull() ? null : time(date,question.path("answeredDays").asInt())).update();
      }
      jdbc.sql("INSERT INTO migration_marker(name,applied_at) VALUES(?,?)")
          .params(MARKER,Timestamp.from(Instant.now())).update();
      return true;
    }));
  }

  private void validate(JsonNode seed, JsonNode fixture) {
    if (!KIND.equals(seed.path("kind").asText()) || !seed.path("is_demo").asBoolean(false) || fixture.path("version").asInt() != 2)
      throw new IllegalArgumentException("Неизвестный формат синтетического JSON-образца.");
    LocalDate.parse(seed.path("seedDate").asText());
    try {
      String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(write(fixture).getBytes(StandardCharsets.UTF_8)));
      if (!digest.equals(seed.path("fixtureSha256").asText())) throw new IllegalArgumentException("SHA-256 синтетического образца не совпадает.");
    } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    if (fixture.path("accounts").size()!=2 || fixture.path("listings").size()!=8 || fixture.path("bookings").size()!=6 || fixture.path("questions").size()!=6)
      throw new IllegalArgumentException("Неожиданный состав синтетического образца.");
    for (JsonNode account : fixture.path("accounts"))
      if (!text(account,"email").endsWith(".test") || text(account,"password").length()<8)
        throw new IllegalArgumentException("Разрешены только учебные аккаунты .test.");
    role(fixture,"user"); role(fixture,"host");
    for (JsonNode listing : fixture.path("listings"))
      if (!listing.path("demo").asBoolean(false) || !listing.path("photos").isArray() || !listing.path("photos").isEmpty())
        throw new IllegalArgumentException("Учебное объявление должно иметь demo=true и не содержать фотографии.");
  }

  private static JsonNode role(JsonNode fixture, String role) {
    List<JsonNode> accounts = new ArrayList<>();
    fixture.path("accounts").forEach(account -> { if (role.equals(text(account,"role"))) accounts.add(account); });
    if (accounts.size()!=1) throw new IllegalArgumentException("Нужен ровно один учебный аккаунт роли " + role);
    return accounts.getFirst();
  }
  private String write(JsonNode value) {
    try { return json.writeValueAsString(value); } catch (IOException error) { throw new IllegalArgumentException(error); }
  }
  private static String text(JsonNode value, String field) { return value.path(field).asText(); }
  private static Integer integer(JsonNode value, String field) { return value.hasNonNull(field) ? value.path(field).asInt() : null; }
  private static Double coordinate(JsonNode listing, int index) { return listing.path("coordinates").isArray() ? listing.path("coordinates").get(index).asDouble() : null; }
  private static String time(LocalDate date, int days) { return date.plusDays(days) + "T09:00:00.000Z"; }
}
