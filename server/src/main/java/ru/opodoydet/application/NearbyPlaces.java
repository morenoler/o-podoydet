package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import ru.opodoydet.shared.Json;

/** Saved OSM surroundings evidence; distances describe straight lines, never walking routes. */
public final class NearbyPlaces {
  private NearbyPlaces() {}

  public static final Set<String> KINDS = Set.of(
      "cafe", "restaurant", "supermarket", "convenience", "pharmacy", "park", "subway",
      "museum", "shopping_mall", "beach", "train_station", "city_center");

  public static boolean matches(JsonNode hotel, JsonNode filters, Instant now) {
    JsonNode requirements = filters.path("nearby");
    return requirements.isMissingNode() || requirements.isArray()
        && selected(hotel, filters, now).size() == requirements.size();
  }

  /** One closest, current source per requested kind, in request order. */
  public static List<JsonNode> selected(JsonNode hotel, JsonNode filters, Instant now) {
    if (hotel.path("synthetic").asBoolean() || !coordinates(hotel.path("coordinates"))) return List.of();
    List<JsonNode> result = new ArrayList<>();
    for (JsonNode requirement : filters.path("nearby")) {
      String kind = Json.str(requirement, "kind");
      JsonNode limit = requirement.path("maxMeters");
      if (!KINDS.contains(kind) || !limit.isNumber() || !Double.isFinite(limit.asDouble())
          || limit.asDouble() < 1 || limit.asDouble() > 10_000) continue;
      Json.list(hotel.path("nearbyPlaces")).stream()
          .filter(place -> kind.equals(Json.str(place, "kind")) && usable(place, now)
              && place.path("meters").asDouble() <= limit.asDouble())
          .min(Comparator.comparingDouble((JsonNode place) -> place.path("meters").asDouble())
              .thenComparing(place -> Json.str(place, "osmId")))
          .ifPresent(place -> result.add(place.deepCopy()));
    }
    return List.copyOf(result);
  }

  public static boolean usable(JsonNode place, Instant now) {
    try {
      JsonNode meters = place.path("meters");
      String osmId = Json.str(place, "osmId");
      Instant obtained = Instant.parse(Json.str(place, "obtainedAt"));
      Instant expires = Instant.parse(Json.str(place, "expiresAt"));
      if (place.has("sourceDate") && (!place.path("sourceDate").isTextual()
          || Instant.parse(Json.str(place, "sourceDate")).isAfter(now))) return false;
      return KINDS.contains(Json.str(place, "kind"))
          && Json.str(place, "status").equals("supported")
          && Json.str(place, "scope").equals("hotel_surroundings")
          && Json.str(place, "method").equals("haversine-osm-v1")
          && !Json.str(place, "name").isBlank()
          && meters.isNumber() && Double.isFinite(meters.asDouble()) && meters.asDouble() >= 0
          && coordinates(place.path("coordinates"))
          && osmId.matches("(?:node|way|relation)/[1-9][0-9]*")
          && Json.str(place, "sourceUrl").equals("https://www.openstreetmap.org/" + osmId)
          && !obtained.isAfter(now) && expires.isAfter(now) && expires.isAfter(obtained);
    } catch (RuntimeException malformed) {
      return false;
    }
  }

  private static boolean coordinates(JsonNode value) {
    return value.isArray() && value.size() == 2
        && coordinate(value.get(0), 180) && coordinate(value.get(1), 90);
  }

  private static boolean coordinate(JsonNode value, double maximum) {
    return value.isNumber() && Double.isFinite(value.asDouble())
        && Math.abs(value.asDouble()) <= maximum;
  }
}
