package ru.opodoydet.server.migration;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.DriverManager;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;
import ru.opodoydet.server.knowledge.FactResolver;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

class SqliteDemoProvenanceTest {
  @TempDir Path temp;
  private static final String KIND = "opodoydet-synthetic-demo-v1";

  private record Source(Path file, String host, String first, String second) {}

  private Source source(String name, String kind) throws Exception {
    Path file = temp.resolve(name + ".sqlite3");
    String host = name + "-host", first = name + "-room", second = name + "-other";
    try (var connection = DriverManager.getConnection("jdbc:sqlite:" + file);
        var sql = connection.createStatement()) {
      sql.execute("CREATE TABLE account_users(id TEXT PRIMARY KEY,email TEXT,password_hash TEXT,role TEXT,name TEXT,created_at TEXT)");
      try (var insert = connection.prepareStatement("INSERT INTO account_users VALUES(?,?,'unused','host','Fixture owner','2026-10-25T00:00:00Z')")) {
        insert.setString(1, host); insert.setString(2, host + "@example.test"); insert.executeUpdate();
      }
      sql.execute("CREATE TABLE account_listings(id TEXT PRIMARY KEY,host_id TEXT,title TEXT,description TEXT,city TEXT,address TEXT,room_type TEXT,capacity INTEGER,price_per_night INTEGER,amenities TEXT,status TEXT,created_at TEXT,updated_at TEXT)");
      try (var insert = connection.prepareStatement("INSERT INTO account_listings VALUES(?,?,'ДЕМО · Название не доказывает происхождение','Fictional fixture for isolated tests','Пусан','Тестовая улица 1','Номер',2,10000,'[]','published','2026-10-25T00:00:00Z','2026-10-25T00:00:00Z')")) {
        for (String id : List.of(first, second)) {
          insert.setString(1, id); insert.setString(2, host); insert.executeUpdate();
        }
      }
      if (kind != null) {
        sql.execute("CREATE TABLE demo_seed_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
        try (var insert = connection.prepareStatement("INSERT INTO demo_seed_metadata VALUES('kind',?)")) {
          insert.setString(1, kind); insert.executeUpdate();
        }
      }
    }
    return new Source(file, host, first, second);
  }

  private static TestDatabases.Database database() throws Exception {
    return TestDatabases.create(Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of()));
  }

  private static SqliteImporter importer(TestDatabases.Database db, Source source) {
    return new SqliteImporter(db.jdbc(), db.tx(), db.context().getBean(FactResolver.class),
        new RuntimeEnv(Map.of("LEGACY_DB_PATH", source.file().toString())));
  }

  private static String marker(Source source, String version) throws Exception {
    Path file = source.file().toAbsolutePath().normalize();
    return "sqlite-import:" + version + ":" + file + ":" + Files.size(file) + ":" + Files.getLastModifiedTime(file).toMillis();
  }

  private static void journal(TestDatabases.Database db, String marker) {
    db.jdbc().sql("INSERT INTO migration_marker(name,applied_at) VALUES(?,?)")
        .params(marker, Timestamp.from(Instant.now())).update();
  }

  private static byte[] digest(Source source) throws Exception {
    return MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(source.file()));
  }

  private static boolean demo(TestDatabases.Database db, String id) {
    return db.jdbc().sql("SELECT demo FROM account_listings WHERE id=?").param(id).query(Boolean.class).single();
  }

  @Test void trustedOldFixtureMarkerSetsDemoWithoutInventingBedsOrLocation() throws Exception {
    Source source = source("trusted-old", KIND);
    byte[] before = digest(source);
    try (var db = database()) {
      importer(db, source).run();
      var listing = new ListingService(db.accounts()).published(source.first());
      assertTrue(listing.path("demo").asBoolean());
      assertTrue(listing.path("coordinates").isNull());
      assertTrue(listing.path("sleepingPlaces").isNull());
      assertTrue(listing.path("beds").isEmpty());
      assertArrayEquals(before, digest(source));
    }
  }

  @Test void namesAndUnrecognizedMetadataNeverClassifyOrdinaryRowsAsDemo() throws Exception {
    try (var db = database()) {
      for (String kind : List.of("", "different-synthetic-marker")) {
        Source source = source(kind.isEmpty() ? "unmarked" : "wrong-marker", kind.isEmpty() ? null : kind);
        importer(db, source).run();
        assertFalse(demo(db, source.first()));
      }
    }
  }

  @Test void completedV2ImportRepairsOnlyMatchedOwnerProvenanceAndPreservesPostgresEdits() throws Exception {
    Source source = source("completed-v2", KIND);
    byte[] before = digest(source);
    try (var db = database()) {
      SqliteImporter importer = importer(db, source);
      importer.importFile(source.file());
      // Simulate V7 defaults on already imported legacy rows, with later PostgreSQL edits.
      db.jdbc().sql("UPDATE account_listings SET demo=FALSE,title='User correction',price_per_night=54321").update();
      db.jdbc().sql("INSERT INTO account_users(id,email,password_hash,role,name,created_at) VALUES('unrelated-host','unrelated@example.test','unused','host','Other','2026-10-26T00:00:00Z')").update();
      db.jdbc().sql("UPDATE account_listings SET host_id='unrelated-host' WHERE id=?").param(source.second()).update();
      journal(db, marker(source, "v2"));
      var saved = db.jdbc().sql("SELECT * FROM account_listings WHERE id=?").param(source.first()).query().singleRow();
      importer.run();
      assertTrue(demo(db, source.first()));
      assertFalse(demo(db, source.second()));
      var restored = db.jdbc().sql("SELECT * FROM account_listings WHERE id=?").param(source.first()).query().singleRow();
      saved.put("demo", true);
      assertEquals(saved, restored, "Only provenance may change; unknown beds/location remain unknown");
      assertEquals(1L, db.jdbc().sql("SELECT count(*) FROM migration_marker WHERE name=?")
          .param(marker(source, "v3")).query(Long.class).single());
      importer.run();
      assertEquals(restored, db.jdbc().sql("SELECT * FROM account_listings WHERE id=?").param(source.first()).query().singleRow());
      assertArrayEquals(before, digest(source));
    }
  }

  @Test void collisionsWithoutCompletedSourceIdentityStayUntouchedEvenOnLaterRestarts() throws Exception {
    try (var db = database()) {
      for (boolean unrelatedJournal : List.of(false, true)) {
        Source source = source("collision-" + unrelatedJournal, KIND);
        SqliteImporter importer = importer(db, source);
        importer.importFile(source.file());
        db.jdbc().sql("UPDATE account_listings SET demo=FALSE,title='Existing independent row' WHERE id=?").param(source.first()).update();
        db.jdbc().sql("DELETE FROM account_listings WHERE id=?").param(source.second()).update();
        if (unrelatedJournal) journal(db, marker(source, "v2") + "-different-file-identity");
        importer.run();
        assertFalse(demo(db, source.first()));
        assertTrue(demo(db, source.second()), "New inserts retain the explicit fixture provenance");
        importer.run();
        assertFalse(demo(db, source.first()), "A v3 journal must not bless an earlier skipped collision");
        assertEquals("Existing independent row", db.jdbc().sql("SELECT title FROM account_listings WHERE id=?")
            .param(source.first()).query(String.class).single());
      }
    }
  }

  @Test void completedLegacyJournalWithoutTrustedMetadataDoesNotBackfill() throws Exception {
    Source source = source("ordinary-completed", "wrong-kind");
    try (var db = database()) {
      SqliteImporter importer = importer(db, source);
      importer.importFile(source.file());
      journal(db, marker(source, "v2"));
      importer.run();
      assertFalse(demo(db, source.first()));
      assertFalse(demo(db, source.second()));
    }
  }
}
