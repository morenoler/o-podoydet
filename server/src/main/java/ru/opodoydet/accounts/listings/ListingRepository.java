package ru.opodoydet.accounts.listings;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.util.List;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.shared.Json;

public final class ListingRepository {
  private final AccountDatabase db;
  private static final String SELECT =
      "SELECT l.id,l.host_id AS hostId,u.name AS"
          + " hostName,l.title,l.description,l.city,l.address,l.room_type AS"
          + " roomType,l.capacity,l.price_per_night AS"
          + " pricePerNight,l.amenities,l.status,l.floor,l.window_directions AS"
          + " windowDirections,l.photos,l.longitude,l.latitude,l.sleeping_places AS sleepingPlaces,l.beds,l.demo,l.created_at AS createdAt,l.updated_at AS updatedAt FROM"
          + " account_listings l JOIN account_users u ON u.id=l.host_id ";

  public ListingRepository(AccountDatabase db) {
    this.db = db;
  }

  public ObjectNode find(String id) throws SQLException {
    return decode(db.one(SELECT + "WHERE l.id=?", id));
  }

  public List<ObjectNode> published() throws SQLException {
    return db.rows(SELECT + "WHERE l.status='published' ORDER BY l.created_at DESC").stream()
        .map(ListingRepository::decode)
        .toList();
  }

  public List<ObjectNode> owned(String hostId) throws SQLException {
    return db.rows(SELECT + "WHERE l.host_id=? ORDER BY l.created_at DESC", hostId).stream()
        .map(ListingRepository::decode)
        .toList();
  }

  public void insert(ObjectNode l) throws SQLException {
    db.execute(
        "INSERT INTO"
            + " account_listings(id,host_id,title,description,city,address,room_type,capacity,price_per_night,amenities,status,created_at,updated_at,floor,window_directions,photos,longitude,latitude,sleeping_places,beds,demo)"
            + " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        Json.str(l, "id"),
        Json.str(l, "hostId"),
        Json.str(l, "title"),
        Json.str(l, "description"),
        Json.str(l, "city"),
        Json.str(l, "address"),
        Json.str(l, "roomType"),
        l.path("capacity").asInt(),
        l.path("pricePerNight").asInt(),
        Json.write(l.path("amenities")),
        Json.str(l, "status"),
        Json.str(l, "createdAt"),
        Json.str(l, "updatedAt"),
        l.path("floor").isNull() ? null : l.path("floor").asInt(),
        Json.write(l.path("windowDirections")),
        Json.write(l.path("photos")),
        coordinate(l, 0), coordinate(l, 1),
        l.hasNonNull("sleepingPlaces") ? l.path("sleepingPlaces").asInt() : null,
        Json.write(l.path("beds")), l.path("demo").asBoolean());
  }

  public void update(String id, ObjectNode l) throws SQLException {
    db.execute(
        "UPDATE account_listings SET"
            + " title=?,description=?,city=?,address=?,room_type=?,capacity=?,price_per_night=?,amenities=?,status=?,updated_at=?,floor=?,window_directions=?,photos=?,longitude=?,latitude=?,sleeping_places=?,beds=?"
            + " WHERE id=?",
        Json.str(l, "title"),
        Json.str(l, "description"),
        Json.str(l, "city"),
        Json.str(l, "address"),
        Json.str(l, "roomType"),
        l.path("capacity").asInt(),
        l.path("pricePerNight").asInt(),
        Json.write(l.path("amenities")),
        Json.str(l, "status"),
        Json.str(l, "updatedAt"),
        l.path("floor").isNull() ? null : l.path("floor").asInt(),
        Json.write(l.path("windowDirections")),
        Json.write(l.path("photos")),
        coordinate(l, 0), coordinate(l, 1),
        l.hasNonNull("sleepingPlaces") ? l.path("sleepingPlaces").asInt() : null,
        Json.write(l.path("beds")),
        id);
  }

  private static Double coordinate(ObjectNode listing, int index) {
    return listing.hasNonNull("coordinates") ? listing.path("coordinates").get(index).asDouble() : null;
  }

  private static ObjectNode decode(ObjectNode node) {
    if (node == null) return null;
    node.set("amenities", Json.read(Json.str(node, "amenities")));
    node.set("windowDirections", Json.read(Json.str(node, "windowDirections")));
    node.set("photos", Json.read(Json.str(node, "photos")));
    node.set("beds", Json.read(Json.str(node, "beds")));
    if (node.hasNonNull("longitude") && node.hasNonNull("latitude"))
      node.set("coordinates", Json.array(List.of(node.path("longitude").asDouble(), node.path("latitude").asDouble())));
    else node.putNull("coordinates");
    node.remove(List.of("longitude", "latitude"));
    node.put("currency", "KRW");
    return node;
  }
}
