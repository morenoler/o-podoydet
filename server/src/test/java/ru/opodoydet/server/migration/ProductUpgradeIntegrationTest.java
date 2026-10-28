package ru.opodoydet.server.migration;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import ru.opodoydet.accounts.bookings.BookingRepository;
import ru.opodoydet.accounts.listings.ListingRepository;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

/** Upgrade the published host/location schema, with real persisted records, before new features. */
class ProductUpgradeIntegrationTest {
  @Test void upgradingV10PreservesCurrencyBedsCoordinatesAndBookingSnapshots() throws Exception {
    try (var fixture = TestDatabases.create(Json.obj("region", "Сочи", "hotels", List.of(), "facts", List.of()),
        Map.of("spring.flyway.target", "10"))) {
      var db = fixture.accounts();
      for (String id : List.of("host", "guest"))
        db.execute("INSERT INTO account_users(id,email,password_hash,role,name,created_at) VALUES(?,?,?,?,?,?)",
            id, id + "@example.test", "unused", id.equals("host") ? "host" : "user", id, "2026-10-28T00:00:00Z");
      String beds = Json.write(List.of(Json.obj("type", "double", "count", 1, "placesPerUnit", 2)));
      db.execute("INSERT INTO account_listings(id,host_id,title,description,city,address,room_type,capacity,price_per_night,amenities,status,created_at,updated_at,longitude,latitude,sleeping_places,beds,demo,currency) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          "stay", "host", "Вымышленная квартира", "Тест обновления базы", "Сочи", "Тестовая улица", "Квартира", 2,
          7500, "[\"Посудомоечная машина\"]", "published", "2026-10-28T00:00:00Z", "2026-10-28T00:00:00Z", 39.73, 43.58, 2, beds, true, "RUB");
      db.execute("INSERT INTO account_bookings(id,listing_id,user_id,check_in,check_out,guests,nights,price_per_night,total_price,status,note,listing_title,city,address,created_at,updated_at,currency) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          "booking", "stay", "guest", "2027-06-10", "2027-06-13", 2, 3, 7000, 21000L, "pending", "PRIVATE_UPGRADE_NOTE",
          "Прежнее название", "Сочи", "Прежний адрес", "2026-10-28T00:00:00Z", "2026-10-28T00:00:00Z", "RUB");
      var migration = Flyway.configure().dataSource(fixture.dataSource()).schemas(fixture.schema())
          .defaultSchema(fixture.schema()).locations("classpath:db/migration").load().migrate();
      assertEquals(3, migration.migrationsExecuted);
      var listing = new ListingRepository(db).find("stay");
      assertEquals("RUB", Json.str(listing, "currency"));
      assertEquals(Json.read(beds), listing.path("beds"));
      assertEquals(Json.array(List.of(39.73, 43.58)), listing.path("coordinates"));
      assertTrue(listing.path("demo").asBoolean());
      assertTrue(listing.path("amenityEvidence").isEmpty(), "Old prose must not become structured evidence");
      assertTrue(listing.path("amenityStates").path("dishwasher").isNull());
      var booking = new BookingRepository(db).find("booking");
      assertEquals("RUB", Json.str(booking, "currency"));
      assertEquals(21000, booking.path("totalPrice").asLong());
      assertEquals("Прежнее название", Json.str(booking, "listingTitle"));
      assertEquals("PRIVATE_UPGRADE_NOTE", Json.str(booking, "note"));
      assertFalse(booking.has("hostReply"));
      assertEquals(0, db.rows("SELECT owner_id FROM account_shortlists").size());
      assertEquals(0, db.rows("SELECT owner_id FROM account_shortlist_shares").size());
      new BookingRepository(db).reply("booking", "Приватный ответ после обновления", "2026-10-28T01:00:00Z");
      assertEquals("pending", Json.str(new BookingRepository(db).find("booking"), "status"));
      assertEquals(21000, new BookingRepository(db).find("booking").path("totalPrice").asLong());
    }
  }
}
