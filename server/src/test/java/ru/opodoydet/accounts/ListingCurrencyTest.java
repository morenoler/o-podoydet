package ru.opodoydet.accounts;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.accounts.bookings.BookingService;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.search.OwnerListingSearchProvider;
import ru.opodoydet.application.HotelFilters;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

class ListingCurrencyTest {
  private static ObjectNode listing() {
    return Json.obj("title", "Synthetic currency fixture", "description", "Synthetic isolated price fixture for testing.",
        "city", "Сочи", "address", "Synthetic address 1", "roomType", "Synthetic unit", "capacity", 2,
        "pricePerNight", 5000, "amenities", List.of(), "status", "published",
        "coordinates", List.of(39.72, 43.58), "sleepingPlaces", 2,
        "beds", List.of(Json.obj("type", "double", "count", 1, "placesPerUnit", 2)));
  }

  @Test void priceCurrencyIsExplicitAndBookingSnapshotSurvivesLaterEdits() throws Exception {
    try (var db = TestDatabases.create(Json.obj("region", "Сочи", "hotels", List.of(), "facts", List.of()))) {
      for (String user : List.of("host", "guest"))
        db.accounts().execute("INSERT INTO account_users(id,email,password_hash,role,name,created_at) VALUES(?,?,?,?,?,?)",
            user, user + "@example.test", "unused", user.equals("host") ? "host" : "user", user, Instant.now().toString());
      var listings = new ListingService(db.accounts());
      var bookings = new BookingService(db.accounts(), listings);
      ObjectNode created = listings.create("host", listing().put("currency", "RUB"));
      String id = created.path("id").asText();
      assertThat(created.path("currency").asText()).isEqualTo("RUB");
      assertThat(created.path("coordinates").get(0).asDouble()).isEqualTo(39.72);
      assertThat(created.path("sleepingPlaces").asInt()).isEqualTo(2);
      LocalDate checkIn = LocalDate.now().plusDays(5);
      var booking = bookings.request("guest", id, Json.obj("checkIn", checkIn.toString(), "checkOut", checkIn.plusDays(2).toString(), "guests", 2, "note", ""));
      assertThat(booking.path("currency").asText()).isEqualTo("RUB");
      assertThat(booking.path("totalPrice").asInt()).isEqualTo(10000);
      // An old client omits currency: updating a description must preserve the stored unit.
      assertThat(listings.update("host", id, listing()).path("currency").asText()).isEqualTo("RUB");
      listings.update("host", id, listing().put("currency", "KRW").put("pricePerNight", 80000));
      var saved = bookings.user("guest").getFirst();
      assertThat(saved.path("currency").asText()).isEqualTo("RUB");
      assertThat(saved.path("pricePerNight").asInt()).isEqualTo(5000);
      assertThatThrownBy(() -> listings.update("host", id, listing().put("currency", "USD"))).isInstanceOf(AccountProblem.class);
    }
  }

  @Test void legacySochiPriceRemainsKrwUntilExplicitlyReenteredAndIsNotComparedToRubleBudget() throws Exception {
    try (var db = TestDatabases.create(Json.obj("region", "Сочи", "hotels", List.of(), "facts", List.of()))) {
      db.accounts().execute("INSERT INTO account_users(id,email,password_hash,role,name,created_at) VALUES(?,?,?,?,?,?)",
          "host", "host@example.test", "unused", "host", "host", Instant.now().toString());
      var listings = new ListingService(db.accounts());
      var legacy = listings.create("host", listing());
      String id = legacy.path("id").asText();
      assertThat(legacy.path("currency").asText()).isEqualTo("KRW");
      assertThat(listings.update("host", id, listing().put("city", "Пусан")).path("currency").asText()).isEqualTo("KRW");
      listings.update("host", id, listing());
      var trip = Json.obj("region", "Сочи", "adults", 2, "children", 0, "text", "", "admissionMode", "explore");
      var snapshot = new OwnerListingSearchProvider(db.accounts()).snapshot(trip);
      var projected = snapshot.apply(List.of(), List.of()).getFirst().path("hotel");
      assertThat(projected.path("currency").asText()).isEqualTo("KRW");
      assertThat(projected.path("region").asText()).isEqualTo("Сочи");
      assertThat(HotelFilters.matches(projected, null, List.of(), Json.obj("maxPricePerNight", 10000))).isFalse();
      listings.update("host", id, listing().put("currency", "RUB").put("pricePerNight", 6000));
      var updated = new OwnerListingSearchProvider(db.accounts()).snapshot(trip).apply(List.of(), List.of()).getFirst().path("hotel");
      assertThat(updated.path("currency").asText()).isEqualTo("RUB");
      assertThat(updated.path("pricePerNight").asInt()).isEqualTo(6000);
      assertThat(HotelFilters.matches(updated, null, List.of(), Json.obj("maxPricePerNight", 10000))).isTrue();
    }
  }

  @Test void sameInstantUsesTheListingsLocalBookingDate() throws Exception {
    try (var db = TestDatabases.create(Json.obj("region", "Сочи", "hotels", List.of(), "facts", List.of()))) {
      for (String user : List.of("host", "guest"))
        db.accounts().execute("INSERT INTO account_users(id,email,password_hash,role,name,created_at) VALUES(?,?,?,?,?,?)",
            user, user + "@example.test", "unused", user.equals("host") ? "host" : "user", user, Instant.now().toString());
      var listings = new ListingService(db.accounts());
      var clock = java.time.Clock.fixed(Instant.parse("2026-10-27T18:30:00Z"), java.time.ZoneOffset.UTC);
      var bookings = new BookingService(db.accounts(), listings, clock);
      var sochi = listings.create("host", listing().put("currency", "RUB"));
      var busan = listings.create("host", listing().put("city", "Пусан"));
      var request = Json.obj("checkIn", "2026-10-27", "checkOut", "2026-10-29", "guests", 2, "note", "");
      assertThat(bookings.request("guest", sochi.path("id").asText(), request).path("currency").asText()).isEqualTo("RUB");
      assertThatThrownBy(() -> bookings.request("guest", busan.path("id").asText(), request))
          .isInstanceOf(AccountProblem.class).hasMessageContaining("будущие даты");
    }
  }
}
