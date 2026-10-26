package ru.opodoydet.domain;

import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.JsonNode;

public final class Evidence {
  private Evidence() {}

  public static boolean demoPolicy(String policy) {
    return "demo".equals(policy);
  }

  public static boolean sourced(JsonNode value, Instant now) {
    try {
      URI uri = URI.create(Json.str(value, "sourceUrl"));
      return Set.of("http", "https").contains(uri.getScheme())
          && uri.getHost() != null
          && !Json.str(value, "quote").isBlank()
          && !Instant.parse(Json.str(value, "obtainedAt")).isAfter(now);
    } catch (RuntimeException invalid) {
      return false;
    }
  }

  public static boolean fact(JsonNode value, Instant now) {
    return value.path("demo").isBoolean()
        && !value.path("demo").asBoolean()
        && Set.of("official", "geo").contains(Json.str(value, "method"))
        && sourced(value, now);
  }

  public static boolean room(JsonNode value, Instant now) {
    return value.path("demo").isBoolean()
        && !value.path("demo").asBoolean()
        && Json.str(value, "evidenceStatus").equals("verified")
        && sourced(value, now)
        && !Instant.parse(Json.str(value, "obtainedAt")).isBefore(now.minusSeconds(30L * 86400));
  }

  public static JsonNode placeholder(String hotelId) {
    return Json.obj(
        "id",
        hotelId + "-unverified",
        "name",
        "Категория номера не подтверждена",
        "capacity",
        null,
        "demo",
        false,
        "evidenceStatus",
        "unknown");
  }

  public static List<JsonNode> rooms(JsonNode hotel, Instant now, String policy) {
    List<JsonNode> rooms = Json.list(hotel.path("rooms"));
    if (demoPolicy(policy)) return rooms;
    List<JsonNode> verified = rooms.stream().filter(r -> room(r, now)).toList();
    return verified.isEmpty() ? List.of(placeholder(Json.str(hotel, "id"))) : verified;
  }
}
