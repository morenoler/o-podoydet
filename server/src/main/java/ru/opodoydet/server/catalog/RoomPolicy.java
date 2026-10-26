package ru.opodoydet.server.catalog;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * Какие категории номеров показывать. Точный перенос старого {@code Evidence.rooms}: в политике
 * verified-only видны только категории, подтверждённые официальным источником не старше 30 дней;
 * если таких нет — одна заглушка «Категория номера не подтверждена».
 */
public final class RoomPolicy {

  static final long FRESH_DAYS = 30;

  private RoomPolicy() {}

  public static List<JsonNode> visible(
      String hotelId, List<JsonNode> rooms, Instant now, boolean demoPolicy, ObjectMapper json) {
    if (demoPolicy) return rooms;
    List<JsonNode> verified = rooms.stream().filter(r -> verified(r, now)).toList();
    return verified.isEmpty() ? List.of(placeholder(hotelId, json)) : verified;
  }

  public static boolean verified(JsonNode room, Instant now) {
    if (!room.path("demo").isBoolean() || room.path("demo").asBoolean()) return false;
    if (!"verified".equals(room.path("evidenceStatus").asText(""))) return false;
    try {
      URI uri = URI.create(room.path("sourceUrl").asText(""));
      Instant obtained = Instant.parse(room.path("obtainedAt").asText(""));
      return ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
          && uri.getHost() != null
          && !room.path("quote").asText("").isBlank()
          && !obtained.isAfter(now)
          && !obtained.isBefore(now.minus(FRESH_DAYS, ChronoUnit.DAYS));
    } catch (RuntimeException invalid) {
      return false;
    }
  }

  static JsonNode placeholder(String hotelId, ObjectMapper json) {
    ObjectNode room = json.createObjectNode();
    room.put("id", hotelId + "-unverified");
    room.put("name", "Категория номера не подтверждена");
    room.putNull("capacity");
    room.put("demo", false);
    room.put("evidenceStatus", "unknown");
    return room;
  }
}
