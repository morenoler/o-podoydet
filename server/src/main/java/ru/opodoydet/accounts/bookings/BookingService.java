package ru.opodoydet.accounts.bookings;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.Inputs;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.shared.Json;

public final class BookingService {
  private final AccountDatabase db;
  private final BookingRepository repository;
  private final ListingService listings;

  public BookingService(AccountDatabase db, ListingService listings) {
    this.db = db;
    repository = new BookingRepository(db);
    this.listings = listings;
  }

  public List<ObjectNode> user(String user) throws SQLException {
    return repository.user(user);
  }

  public List<ObjectNode> host(String host) throws SQLException {
    return repository.host(host);
  }

  public ObjectNode request(String user, String listingId, JsonNode input) throws SQLException {
    LocalDate from = Inputs.date(input, "checkIn", "Заезд"),
        to = Inputs.date(input, "checkOut", "Выезд");
    long nights = ChronoUnit.DAYS.between(from, to);
    if (from.isBefore(today()) || nights < 1 || nights > 90 || from.isAfter(today().plusYears(2)))
      throw new AccountProblem(400, "Выберите будущие даты: от 1 до 90 ночей, не дальше двух лет.");
    int guests = Inputs.integer(input, "guests", "Гости", 1, 20);
    String note = Inputs.optional(input, "note", "Комментарий", 1500);
    return db.transaction(
        () -> {
          ObjectNode listing = listings.published(listingId);
          if (guests > listing.path("capacity").asInt())
            throw new AccountProblem(
                400, "В объявлении недостаточно мест для выбранного числа гостей.");
          if (repository.overlap(listingId, from.toString(), to.toString(), ""))
            throw new AccountProblem(
                409, "На эти даты уже есть подтверждённая бронь. Выберите другие даты.");
          if (repository.duplicate(listingId, user, from.toString(), to.toString()))
            throw new AccountProblem(409, "Заявка на эти даты уже есть в вашем личном кабинете.");
          String id = UUID.randomUUID().toString(), now = Instant.now().toString();
          ObjectNode booking =
              Json.obj(
                  "id",
                  id,
                  "listingId",
                  listingId,
                  "userId",
                  user,
                  "checkIn",
                  from.toString(),
                  "checkOut",
                  to.toString(),
                  "guests",
                  guests,
                  "nights",
                  nights,
                  "pricePerNight",
                  listing.path("pricePerNight").asInt(),
                  "totalPrice",
                  nights * listing.path("pricePerNight").asLong(),
                  "note",
                  note,
                  "listingTitle",
                  Json.str(listing, "title"),
                  "city",
                  Json.str(listing, "city"),
                  "address",
                  Json.str(listing, "address"),
                  "createdAt",
                  now,
                  "updatedAt",
                  now);
          repository.insert(booking);
          return repository.find(id);
        });
  }

  public ObjectNode cancel(String user, String id) throws SQLException {
    return db.transaction(
        () -> {
          ObjectNode booking = repository.find(id);
          if (booking == null || !Json.str(booking, "userId").equals(user))
            throw new AccountProblem(404, "Ваша заявка не найдена.");
          String status = Json.str(booking, "status");
          if (!status.equals("pending") && !status.equals("confirmed"))
            throw new AccountProblem(409, "Эту заявку уже нельзя отменить.");
          if (status.equals("confirmed")
              && LocalDate.parse(Json.str(booking, "checkIn")).isBefore(today()))
            throw new AccountProblem(
                409, "Поездка уже началась. Свяжитесь с отельером для отмены.");
          repository.status(id, "cancelled", Instant.now().toString());
          return repository.find(id);
        });
  }

  public ObjectNode status(String host, String id, JsonNode input) throws SQLException {
    String target = Inputs.text(input, "status", "Статус заявки", 1, 20);
    return db.transaction(
        () -> {
          ObjectNode booking = repository.find(id);
          if (booking == null || !Json.str(booking, "hostId").equals(host))
            throw new AccountProblem(404, "Заявка на ваше объявление не найдена.");
          String current = Json.str(booking, "status");
          boolean allowed =
              (current.equals("pending")
                      && (target.equals("confirmed") || target.equals("cancelled")))
                  || (current.equals("confirmed")
                      && (target.equals("completed") || target.equals("cancelled")));
          if (!allowed)
            throw new AccountProblem(409, "Такое изменение статуса недоступно. Обновите страницу.");
          if (target.equals("completed")
              && LocalDate.parse(Json.str(booking, "checkOut")).isAfter(today()))
            throw new AccountProblem(409, "Завершить поездку можно после даты выезда.");
          if (target.equals("confirmed")) {
            if (LocalDate.parse(Json.str(booking, "checkOut")).isBefore(today())
                || LocalDate.parse(Json.str(booking, "checkOut")).equals(today()))
              throw new AccountProblem(
                  409, "Даты поездки уже прошли. Эту заявку нельзя подтвердить.");
            if (repository.overlap(
                Json.str(booking, "listingId"),
                Json.str(booking, "checkIn"),
                Json.str(booking, "checkOut"),
                id)) throw new AccountProblem(409, "На эти даты уже есть подтверждённая бронь.");
          }
          repository.status(id, target, Instant.now().toString());
          return repository.find(id);
        });
  }

  // Rental calendar follows the territory of the catalogue, independently of server timezone.
  private static LocalDate today() {
    return LocalDate.now(ZoneId.of("Asia/Seoul"));
  }
}
