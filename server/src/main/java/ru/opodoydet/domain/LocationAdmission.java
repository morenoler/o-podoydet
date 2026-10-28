package ru.opodoydet.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import ru.opodoydet.shared.Json;

/** Location evidence is shared by the building's rooms, without replacing their own checks. */
public final class LocationAdmission {
  private LocationAdmission() {}

  public static final Comparator<JsonNode> ROOM_ORDER = Comparator
      .comparing((JsonNode room) -> !Json.str(room, "status").equals("fits"))
      .thenComparing(room -> room.path("provisional").asBoolean())
      .thenComparing(Comparator.comparingInt((JsonNode room) -> room.path("score").asInt()).reversed());

  public static ObjectNode apply(JsonNode original, List<JsonNode> criteria, JsonNode trip) {
    ObjectNode match = original.deepCopy();
    match.set("locationCriteria", Json.array(criteria));
    boolean blocked = criteria.stream().anyMatch(c -> c.path("required").asBoolean() && !AdmissionPolicy.permits(c, trip));
    boolean provisional = criteria.stream().anyMatch(c -> c.path("required").asBoolean() && !Json.str(c, "evidenceStatus").equals("match"));
    int score = criteria.stream().mapToInt(c -> Json.str(c, "status").equals("match") ? 3 : -2).sum();
    List<JsonNode> rooms = new ArrayList<>();
    for (JsonNode value : match.path("rooms")) {
      ObjectNode room = (ObjectNode) value;
      room.put("score", room.path("score").asInt() + score);
      if (blocked) room.put("status", "excluded").put("provisional", false);
      else if (provisional && Json.str(room, "status").equals("fits")) room.put("provisional", true);
      rooms.add(room);
    }
    rooms.sort(ROOM_ORDER);
    match.set("rooms", Json.array(rooms));
    if (!rooms.isEmpty()) match.set("best", rooms.getFirst().deepCopy());
    return match;
  }

  public static boolean matchesAll(JsonNode criteria) {
    for (JsonNode criterion : criteria)
      if (!Json.str(criterion, "status").equals("match") || !Json.str(criterion, "evidenceStatus").equals("match")) return false;
    return true;
  }
}
