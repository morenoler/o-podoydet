package ru.opodoydet.accounts;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Files;
import ru.opodoydet.server.migration.SqliteImporter;
import java.sql.DriverManager;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.accounts.bookings.BookingService;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.accounts.search.OwnerListingSearchProvider;
import ru.opodoydet.shared.Json;
import ru.opodoydet.server.support.TestDatabases;

class ListingV2Test {
  @TempDir Path temp;
  private static final String PRIVATE = "OWNER_PRIVATE_NOTES_9821";

  private static ObjectNode listing() {
    return Json.obj(
        "title",
        "Номер у моря",
        "description",
        "Просторный номер с отдельной ванной комнатой.",
        "city",
        "Пусан",
        "address",
        "Хэундэ 10",
        "roomType",
        "Стандарт",
        "capacity",
        3,
        "pricePerNight",
        90000,
        "amenities",
        List.of("Wi-Fi"),
        "status",
        "published");
  }

  private static void createUser(AccountDatabase db, String id, String role) throws Exception {
    db.execute(
        "INSERT INTO account_users(id,email,password_hash,role,name,created_at)"
            + " VALUES(?,?,?,?,?,?)",
        id,
        id + "@example.test",
        "unused",
        role,
        id,
        Instant.now().toString());
  }

  @Test
  void additiveMigrationPreservesLegacyDataAndRunsOnlyOnce() throws Exception {
    Path file = temp.resolve("legacy.sqlite3");
    // Build the previous schema without invoking the module's new migration constructor.
    try (var connection = DriverManager.getConnection("jdbc:sqlite:" + file);
        var statement = connection.createStatement();
        var input = Files.newInputStream(Path.of("../data/demo/sqlite-schema/accounts-schema.sql"))) {
      assertNotNull(input);
      for (String sql : new String(input.readAllBytes(), StandardCharsets.UTF_8).split(";"))
        if (!sql.isBlank()) statement.execute(sql);
      statement.executeUpdate(
          "INSERT INTO account_users(id,email,password_hash,role,name,created_at)"
              + " VALUES('host','host@example.test','unused','host','Владелец','2026-10-25T00:00:00Z')");
      statement.executeUpdate(
          "INSERT INTO"
              + " account_listings(id,host_id,title,description,city,address,room_type,capacity,price_per_night,amenities,status,created_at,updated_at)"
              + " VALUES('legacy','host','Номер у моря','Просторный номер с отдельной ванной"
              + " комнатой.','Пусан','Хэундэ"
              + " 10','Стандарт',3,90000,'[]','published','2026-10-25T00:00:00Z','2026-10-25T00:00:00Z')");
      try (var insert =
          connection.prepareStatement(
              "INSERT INTO"
                  + " account_listing_search_profiles(listing_id,notes,floor,window_directions)"
                  + " VALUES('legacy',?,3,?)")) {
        insert.setString(1, PRIVATE);
        insert.setString(2, "[\"south\",\"west\"]");
        insert.executeUpdate();
      }
    }
    try (var database = TestDatabases.create(Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of()))) {
      AccountDatabase db = database.accounts();
      SqliteImporter importer = database.context().getBean(SqliteImporter.class);
      importer.importFile(file);
      ListingService service = new ListingService(db);
      JsonNode publicListing = service.published("legacy");
      assertEquals(3, publicListing.path("floor").asInt());
      assertEquals(Json.array(List.of("south", "west")), publicListing.path("windowDirections"));
      assertTrue(publicListing.path("photos").isArray());
      assertTrue(publicListing.path("photos").isEmpty());
      assertFalse(publicListing.has("searchProfile"));
      assertFalse(publicListing.toString().contains(PRIVATE));
      assertEquals(
          Json.obj("notes", PRIVATE), service.owned("legacy", "host").path("searchProfile"));
      ObjectNode oldRequest = listing();
      JsonNode preserved = service.update("host", "legacy", oldRequest);
      assertEquals(3, preserved.path("floor").asInt());
      assertEquals(publicListing.path("windowDirections"), preserved.path("windowDirections"));
      ObjectNode cleared = listing().putNull("floor");
      cleared.set("windowDirections", Json.array(List.of()));
      service.update("host", "legacy", cleared);
      // Re-import and restart never overwrite changes already made in PostgreSQL.
      importer.importFile(file);
      database.restart();
      db = database.accounts();
      service = new ListingService(db);
      JsonNode listing = service.published("legacy");
      assertTrue(listing.path("floor").isNull());
      assertTrue(listing.path("windowDirections").isEmpty());
      assertEquals(
          PRIVATE, Json.str(service.owned("legacy", "host").path("searchProfile"), "notes"));
      assertEquals(
          3,
          db.one("SELECT floor FROM account_listing_search_profiles WHERE listing_id='legacy'")
              .path("floor")
              .asInt()); // archived legacy values never override public edits
    }
  }

  @Test
  void publicDetailsPhotosAndLegacyWritesStayConsistentAcrossSearchBookingsAndReload()
      throws Exception {
    String id;
    List<String> photos =
        List.of("https://images.example.test/room.jpg?width=1200", "/images/room-2.webp");
    try (var database = TestDatabases.create(Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of()))) {
      AccountDatabase db = database.accounts();
      createUser(db, "host", "host");
      createUser(db, "guest", "user");
      ListingService service = new ListingService(db);
      ObjectNode form = listing().put("floor", 4);
      form.set("windowDirections", Json.array(List.of("south", "east")));
      form.set("photos", Json.array(photos));
      form.set(
          "searchProfile",
          Json.obj(
              "notes",
              "Все окна выходят во двор. " + PRIVATE,
              "floor",
              99,
              "windowDirections",
              List.of("north")));
      JsonNode created = service.create("host", form);
      id = Json.str(created, "id");
      assertEquals(4, created.path("floor").asInt());
      assertEquals(Json.array(List.of("south", "east")), created.path("windowDirections"));
      assertEquals(1, created.path("searchProfile").size());
      assertFalse(created.path("searchProfile").has("floor"));
      JsonNode preserved = service.update("host", id, listing());
      assertEquals(4, preserved.path("floor").asInt());
      assertEquals(Json.array(photos), preserved.path("photos"));
      ObjectNode notesOnly = listing();
      notesOnly.set("searchProfile", Json.obj("notes", PRIVATE));
      assertEquals(4, service.update("host", id, notesOnly).path("floor").asInt());
      ObjectNode legacy = listing();
      legacy.set(
          "searchProfile",
          Json.obj("notes", PRIVATE, "floor", 2, "windowDirections", List.of("north_east")));
      JsonNode legacySaved = service.update("host", id, legacy);
      assertEquals(2, legacySaved.path("floor").asInt());
      assertEquals(Json.array(List.of("north_east")), legacySaved.path("windowDirections"));
      ObjectNode priority = listing().put("floor", 4);
      priority.set("windowDirections", Json.array(List.of("south")));
      priority.set(
          "searchProfile",
          Json.obj(
              "notes",
              PRIVATE,
              "floor",
              201,
              "windowDirections",
              List.of("invalid-legacy-overridden")));
      JsonNode finalListing = service.update("host", id, priority);
      assertEquals(4, finalListing.path("floor").asInt());
      assertEquals(Json.array(List.of("south")), finalListing.path("windowDirections"));
      JsonNode publicListing = service.published(id);
      assertEquals(Json.array(photos), publicListing.path("photos"));
      assertFalse(publicListing.toString().contains(PRIVATE));
      var snapshot =
          new OwnerListingSearchProvider(db)
              .snapshot(
                  Json.obj(
                      "region",
                      "Пусан",
                      "adults",
                      2,
                      "children",
                      0,
                      "text",
                      "Не выше 3 этажа. Окна на юг"));
      JsonNode match = snapshot.apply(List.of(), List.of()).getFirst();
      assertEquals("excluded", Json.str(match.path("best"), "status"));
      assertEquals(4, match.path("hotel").path("floor").asInt());
      assertEquals(Json.array(photos), match.path("hotel").path("photos"));
      assertEquals(90000, match.path("hotel").path("pricePerNight").asInt());
      assertEquals("KRW", Json.str(match.path("hotel"), "currency"));
      assertFalse(match.toString().contains(PRIVATE));
      java.time.LocalDate from =
          java.time.LocalDate.now(java.time.ZoneId.of("Asia/Seoul")).plusDays(10);
      JsonNode booking =
          new BookingService(db, service)
              .request(
                  "guest",
                  id,
                  Json.obj(
                      "checkIn",
                      from.toString(),
                      "checkOut",
                      from.plusDays(2).toString(),
                      "guests",
                      2,
                      "note",
                      ""));
      assertEquals(Json.array(photos), booking.path("photos"));
      assertEquals("Стандарт", Json.str(booking, "roomType"));
      database.restart();
      db = database.accounts();
      service = new ListingService(db);
      JsonNode reloaded = service.published(id);
      assertEquals(4, reloaded.path("floor").asInt());
      assertEquals(Json.array(photos), reloaded.path("photos"));
      assertEquals(Json.array(List.of("south")), reloaded.path("windowDirections"));
      assertEquals(PRIVATE, Json.str(service.owned(id, "host").path("searchProfile"), "notes"));
    }
  }

  @Test
  void unsafePhotosAndInvalidPublicDetailsAreRejectedAtomically() throws Exception {
    try (var database = TestDatabases.create(Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of()))) {
      AccountDatabase db = database.accounts();
      createUser(db, "host", "host");
      ListingService service = new ListingService(db);
      String id = Json.str(service.create("host", listing()), "id");
      for (String url :
          List.of(
              "http://example.test/photo.jpg",
              "data:image/png;base64,AAAA",
              "javascript:alert(1)",
              "file:///C:/secret.png",
              "C:/secret.png",
              "//evil.test/photo.jpg",
              "https://user:pass@example.test/photo.jpg",
              "/api/private",
              "/images/../secret.png",
              "/images/%2e%2e/secret.png",
              "/images/a.png?path=../../",
              "/images/..\\secret.png")) {
        ObjectNode form = listing().put("title", "Не должно сохраниться");
        form.set("photos", Json.array(List.of(url)));
        assertThrows(AccountProblem.class, () -> service.update("host", id, form), url);
        assertEquals("Номер у моря", Json.str(service.published(id), "title"));
        assertTrue(service.published(id).path("photos").isEmpty());
      }
      ObjectNode tooMany = listing();
      tooMany.set(
          "photos",
          Json.array(
              java.util.stream.IntStream.range(0, 7)
                  .mapToObj(i -> "https://example.test/" + i + ".jpg")
                  .toList()));
      assertThrows(AccountProblem.class, () -> service.update("host", id, tooMany));
      ObjectNode duplicate = listing();
      duplicate.set(
          "photos",
          Json.array(List.of("https://example.test/a.jpg", "https://example.test/a.jpg")));
      assertThrows(AccountProblem.class, () -> service.update("host", id, duplicate));
      assertThrows(
          AccountProblem.class, () -> service.update("host", id, listing().put("floor", 201)));
      assertThrows(
          AccountProblem.class, () -> service.update("host", id, listing().put("floor", 2.5)));
      ObjectNode invalid = listing();
      invalid.set("windowDirections", Json.array(List.of("up")));
      assertThrows(AccountProblem.class, () -> service.update("host", id, invalid));
      ObjectNode valid = listing();
      valid.set("photos", Json.array(List.of("/images/owner/room.jpg")));
      service.update("host", id, valid);
      ObjectNode clear = listing();
      clear.set("photos", Json.array(List.of()));
      assertTrue(service.update("host", id, clear).path("photos").isEmpty());
    }
  }
}
