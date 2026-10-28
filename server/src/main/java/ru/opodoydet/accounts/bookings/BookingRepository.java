package ru.opodoydet.accounts.bookings;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.util.List;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.shared.Json;

public final class BookingRepository {
  private final AccountDatabase db;
  private static final String SELECT =
      "SELECT b.id,b.listing_id AS listingId,b.listing_title AS"
          + " listingTitle,b.city,b.address,b.user_id AS userId,u.name AS guestName,u.email AS"
          + " guestEmail,l.host_id AS hostId,b.check_in AS checkIn,b.check_out AS"
          + " checkOut,b.guests,b.nights,b.price_per_night AS pricePerNight,b.total_price AS"
          + " totalPrice,b.currency,l.photos,l.room_type AS"
          + " roomType,b.status,b.note,b.host_reply AS hostReply,b.replied_at AS repliedAt,"
          + " b.created_at AS createdAt,b.updated_at AS updatedAt FROM"
          + " account_bookings b JOIN account_listings l ON l.id=b.listing_id JOIN account_users u"
          + " ON u.id=b.user_id ";

  public BookingRepository(AccountDatabase db) {
    this.db = db;
  }

  public ObjectNode find(String id) throws SQLException {
    return decode(db.one(SELECT + "WHERE b.id=?", id));
  }

  public List<ObjectNode> user(String id) throws SQLException {
    return db.rows(SELECT + "WHERE b.user_id=? ORDER BY b.created_at DESC", id).stream()
        .map(BookingRepository::decode)
        .toList();
  }

  public List<ObjectNode> host(String id) throws SQLException {
    return db.rows(SELECT + "WHERE l.host_id=? ORDER BY b.created_at DESC", id).stream()
        .map(BookingRepository::decode)
        .toList();
  }

  public boolean overlap(String listing, String from, String to, String excluded)
      throws SQLException {
    return db.one(
            "SELECT id FROM account_bookings WHERE listing_id=? AND status='confirmed' AND"
                + " check_in<? AND check_out>? AND id<>? LIMIT 1",
            listing,
            to,
            from,
            excluded)
        != null;
  }

  public boolean duplicate(String listing, String user, String from, String to)
      throws SQLException {
    return db.one(
            "SELECT id FROM account_bookings WHERE listing_id=? AND user_id=? AND check_in=? AND"
                + " check_out=? AND status IN ('pending','confirmed') LIMIT 1",
            listing,
            user,
            from,
            to)
        != null;
  }

  public void insert(ObjectNode b) throws SQLException {
    db.execute(
        "INSERT INTO"
            + " account_bookings(id,listing_id,user_id,check_in,check_out,guests,nights,price_per_night,total_price,status,note,listing_title,city,address,created_at,updated_at,currency)"
            + " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        Json.str(b, "id"),
        Json.str(b, "listingId"),
        Json.str(b, "userId"),
        Json.str(b, "checkIn"),
        Json.str(b, "checkOut"),
        b.path("guests").asInt(),
        b.path("nights").asInt(),
        b.path("pricePerNight").asInt(),
        b.path("totalPrice").asLong(),
        "pending",
        Json.str(b, "note"),
        Json.str(b, "listingTitle"),
        Json.str(b, "city"),
        Json.str(b, "address"),
        Json.str(b, "createdAt"),
        Json.str(b, "updatedAt"),
        Json.str(b, "currency"));
  }

  public void status(String id, String status, String now) throws SQLException {
    db.execute("UPDATE account_bookings SET status=?,updated_at=? WHERE id=?", status, now, id);
  }

  public void reply(String id, String message, String now) throws SQLException {
    db.execute("UPDATE account_bookings SET host_reply=?,replied_at=?,updated_at=? WHERE id=?",
        message, now, now, id);
  }

  private static ObjectNode decode(ObjectNode row) {
    if (row == null) return null;
    row.set("photos", Json.read(Json.str(row, "photos")));
    if (Json.str(row, "hostReply").isBlank()) row.remove(List.of("hostReply", "repliedAt"));
    return row;
  }
}
