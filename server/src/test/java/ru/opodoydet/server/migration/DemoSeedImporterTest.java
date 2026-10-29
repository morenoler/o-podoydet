package ru.opodoydet.server.migration;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import ru.opodoydet.accounts.auth.Passwords;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

class DemoSeedImporterTest {
  private static final ObjectMapper JSON = new ObjectMapper();

  private static ObjectNode seed() throws Exception {
    Path path = Path.of("../data/demo/fixtures.json");
    if (!Files.exists(path)) path = Path.of("data/demo/fixtures.json");
    ObjectNode result = Json.obj("kind", "opodoydet-synthetic-demo-json-v1", "is_demo", true,
        "seedDate", "2028-02-29", "fixtures", JSON.readTree(path.toFile()));
    checksum(result);
    return result;
  }

  private static void checksum(ObjectNode seed) throws Exception {
    seed.put("fixtureSha256", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
        .digest(JSON.writeValueAsString(seed.path("fixtures")).getBytes(StandardCharsets.UTF_8))));
  }

  private static ObjectNode catalog() {
    return Json.obj("region", "Пусан", "evidencePolicy", "verified-only", "hotels", List.of(), "facts", List.of());
  }

  @Test void portableJsonSeedsPostgresWithCompatiblePasswordsAndPreservesEdits() throws Exception {
    try (var db = TestDatabases.create(catalog(), Map.of("DEMO_MODE", "true"))) {
      var importer = db.context().getBean(DemoSeedImporter.class);
      ObjectNode seed = seed();
      assertTrue(importer.importSeed(seed));
      assertEquals(2L, db.jdbc().sql("SELECT count(*) FROM account_users").query(Long.class).single());
      assertEquals(8L, db.jdbc().sql("SELECT count(*) FROM account_listings WHERE demo").query(Long.class).single());
      assertEquals(7L, db.jdbc().sql("SELECT count(*) FROM account_listings WHERE status='published'").query(Long.class).single());
      assertEquals(6L, db.jdbc().sql("SELECT count(*) FROM account_bookings").query(Long.class).single());
      assertEquals(3L, db.jdbc().sql("SELECT count(*) FROM account_questions WHERE answer IS NULL").query(Long.class).single());
      assertEquals(0L, db.jdbc().sql("SELECT (SELECT count(*) FROM account_sessions)+(SELECT count(*) FROM advisor_run)").query(Long.class).single());
      assertEquals("2028-03-07", db.jdbc().sql("SELECT min(check_in) FROM account_bookings WHERE status='pending'").query(String.class).single());
      String passwordHash = db.jdbc().sql("SELECT password_hash FROM account_users WHERE email='user@demo.test'").query(String.class).single();
      assertTrue(Passwords.verify("UserDemo2026!", passwordHash));
      assertTrue(db.jdbc().sql("SELECT count(*) FROM account_listings WHERE longitude IS NULL AND latitude IS NULL").query(Long.class).single() > 0);
      assertTrue(db.jdbc().sql("SELECT count(*) FROM account_listings WHERE sleeping_places IS NOT NULL AND beds<>'[]'").query(Long.class).single() > 0);
      db.jdbc().sql("UPDATE account_listings SET title='Edited demo' WHERE id='33333333-3333-4333-8333-333333333001'").update();
      assertFalse(importer.importSeed(seed));
      assertEquals("Edited demo", db.jdbc().sql("SELECT title FROM account_listings WHERE id='33333333-3333-4333-8333-333333333001'").query(String.class).single());
      assertEquals(passwordHash, db.jdbc().sql("SELECT password_hash FROM account_users WHERE email='user@demo.test'").query(String.class).single());
    }
  }

  @Test void failedImportRollsBackAndNeverMergesIntoExistingAccounts() throws Exception {
    try (var db = TestDatabases.create(catalog(), Map.of("DEMO_MODE", "true"))) {
      var importer = db.context().getBean(DemoSeedImporter.class);
      ObjectNode corrupt = seed();
      ((ObjectNode) corrupt.path("fixtures").path("listings").get(1)).put("capacity", -5);
      checksum(corrupt);
      assertThrows(RuntimeException.class, () -> importer.importSeed(corrupt));
      assertEquals(0L, db.jdbc().sql("SELECT count(*) FROM account_users").query(Long.class).single());
      assertEquals(0L, db.jdbc().sql("SELECT count(*) FROM migration_marker WHERE name='account-demo-json:v1'").query(Long.class).single());
      db.jdbc().sql("INSERT INTO account_users(id,email,password_hash,role,name,created_at) VALUES('existing','existing@example.test','x','user','Existing','2026-10-29')").update();
      assertThrows(IllegalStateException.class, () -> importer.importSeed(seed()));
      assertEquals(1L, db.jdbc().sql("SELECT count(*) FROM account_users").query(Long.class).single());
    }
  }

  @Test void explicitOptInSchemaAndIntegrityAreRequired() throws Exception {
    try (var db = TestDatabases.create(catalog())) {
      assertThrows(IllegalArgumentException.class, () -> db.context().getBean(DemoSeedImporter.class).importSeed(seed()));
      var incorrectSchema = new DemoSeedImporter(db.jdbc(),db.tx(),JSON,
          new RuntimeEnv(Map.of("DEMO_MODE","true","DB_SCHEMA","public")));
      assertThrows(IllegalArgumentException.class, () -> incorrectSchema.importSeed(seed()));
      var importer = new DemoSeedImporter(db.jdbc(),db.tx(),JSON,
          new RuntimeEnv(Map.of("DEMO_MODE","true","DB_SCHEMA",db.schema())));
      ObjectNode tampered = seed();
      ((ObjectNode) tampered.path("fixtures").path("listings").get(0)).put("demo",false);
      assertThrows(IllegalArgumentException.class, () -> importer.importSeed(tampered));
      checksum(tampered);
      assertThrows(IllegalArgumentException.class, () -> importer.importSeed(tampered));
    }
  }

  @Test void startupImportsJsonOnceWithoutLegacyDatabase() throws Exception {
    Path directory = Files.createTempDirectory("opodoydet-native-demo-");
    Path file = directory.resolve("seed.json");
    try {
      Files.writeString(file, JSON.writeValueAsString(seed()), StandardCharsets.UTF_8);
      try (var db = TestDatabases.create(catalog(), Map.of("DEMO_MODE","true","DEMO_SEED_PATH",file.toString()))) {
        assertEquals(8L, db.jdbc().sql("SELECT count(*) FROM account_listings").query(Long.class).single());
        db.restart();
        assertEquals(8L, db.jdbc().sql("SELECT count(*) FROM account_listings").query(Long.class).single());
      }
    } finally { Files.deleteIfExists(file); Files.deleteIfExists(directory); }
  }
}
