package ru.opodoydet.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import ru.opodoydet.shared.Json;

/** A hotel-level match is not enough to recommend a particular room. */
public final class RoomRecommendations {
  private RoomRecommendations() {}

  public record Selection(
      List<JsonNode> recommendations, List<JsonNode> alternatives, int unverifiedHotelCount) {}

  public static Selection select(List<JsonNode> matches, Instant now, String policy) {
    List<JsonNode> exact = new ArrayList<>(), alternatives = new ArrayList<>();
    int unverified = 0;
    for (JsonNode match : matches) {
      JsonNode hotel = match.path("hotel");
      boolean owner = hotel.hasNonNull("accountListingId");
      boolean hasConcreteRoom = false;
      for (JsonNode roomMatch : match.path("rooms")) {
        JsonNode room = roomMatch.path("room");
        if (!concrete(hotel, room, now, policy)) continue;
        hasConcreteRoom = true;
        // Required mismatches and capacity exclusions cannot become recommendations
        // or quietly re-enter through the optional alternatives section.
        if (!Json.str(roomMatch, "status").equals("fits")) continue;
        ObjectNode item =
            Json.obj(
                "id",
                Json.str(hotel, "id") + "::" + Json.str(room, "id"),
                "hotel",
                hotel.deepCopy(),
                "room",
                roomMatch.deepCopy(),
                "ownerCriteria",
                match.has("ownerCriteria")
                    ? match.path("ownerCriteria").deepCopy()
                    : Json.array(List.of()),
                "source",
                owner
                    ? "owner"
                    : room.path("demo").asBoolean() || hotel.path("synthetic").asBoolean()
                        ? "demo"
                        : "verified");
        if (matchesAll(roomMatch, match.path("ownerCriteria"), owner)) exact.add(item);
        else alternatives.add(item);
      }
      if (!hasConcreteRoom) unverified++;
    }
    Comparator<JsonNode> order =
        Comparator.comparingInt((JsonNode item) -> item.path("room").path("score").asInt())
            .reversed()
            .thenComparingDouble(
                item ->
                    item.path("hotel")
                        .path("route")
                        .path("meters")
                        .asDouble(Double.POSITIVE_INFINITY))
            .thenComparing(item -> Json.str(item, "id"));
    exact.sort(order);
    alternatives.sort(order);
    return new Selection(List.copyOf(exact), List.copyOf(alternatives), unverified);
  }

  public static boolean concrete(JsonNode hotel, JsonNode room, Instant now, String policy) {
    if (Json.str(room, "id").isBlank()
        || Json.str(room, "name").isBlank()
        || Json.str(room, "id").equals(Json.str(hotel, "id") + "-unverified")) return false;
    if (hotel.hasNonNull("accountListingId")) return true;
    return Evidence.room(room, now)
        || (Evidence.demoPolicy(policy)
            && (room.path("demo").asBoolean() || hotel.path("synthetic").asBoolean()));
  }

  public static boolean matchesAll(JsonNode roomMatch, JsonNode ownerCriteria, boolean owner) {
    if (!Json.str(roomMatch, "status").equals("fits")
        || !Json.str(roomMatch, "capacityStatus").equals("match")
        || !Json.str(roomMatch, "capacityEvidenceStatus").equals("match")
        || (!owner && roomMatch.path("capacityAssumed").asBoolean())) return false;
    for (JsonNode criterion : roomMatch.path("criteria"))
      if (!supportedMatch(criterion, owner)) return false;
    for (JsonNode criterion : ownerCriteria) if (!supportedMatch(criterion, owner)) return false;
    return true;
  }

  private static boolean supportedMatch(JsonNode criterion, boolean owner) {
    return Json.str(criterion, "status").equals("match")
        && Json.str(criterion, "evidenceStatus").equals("match")
        && (owner || !criterion.path("assumed").asBoolean());
  }
}
