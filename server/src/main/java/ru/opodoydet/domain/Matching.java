package ru.opodoydet.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import ru.opodoydet.shared.Json;

public final class Matching {
  private static final Map<String, Integer> ORDER = Map.of("fits", 0, "excluded", 1);

  private Matching() {}

  public static ObjectNode evaluate(
      List<JsonNode> facts, JsonNode preference, JsonNode room, JsonNode trip, Instant now) {
    return evaluate(facts, preference, room, trip, now, "verified-only");
  }

  public static ObjectNode evaluate(
      List<JsonNode> facts,
      JsonNode preference,
      JsonNode room,
      JsonNode trip,
      Instant now,
      String policy) {
    String feature = Json.str(preference, "feature");
    Features.Definition definition = Features.get(feature);
    if (!Evidence.demoPolicy(policy)
        && !definition.scope().equals("hotel")
        && !Evidence.room(room, now))
      return Json.obj(
          "feature",
          feature,
          "required",
          preference.path("required").asBoolean(),
          "facts",
          List.of(),
          "status",
          "unknown",
          "explanation",
          "Категория номера не подтверждена источником");
    if (definition.tool().equals("area"))
      return Json.obj(
          "feature",
          feature,
          "required",
          preference.path("required").asBoolean(),
          "facts",
          List.of(),
          "status",
          "unknown",
          "explanation",
          "Нет достаточных данных о районе на даты поездки");
    List<JsonNode> relevant =
        facts.stream()
            .filter(f -> Evidence.demoPolicy(policy) || Evidence.fact(f, now))
            .filter(
                f ->
                    Json.str(f, "feature").equals(feature)
                        && !f.hasNonNull("supersededBy")
                        && (definition.scope().equals("hotel")
                            ? !f.hasNonNull("roomId")
                            : Json.str(f, "roomId").equals(Json.str(room, "id"))))
            .filter(
                f -> {
                  boolean negative = definition.threshold() == null
                      ? f.path("value").isBoolean() && !f.path("value").asBoolean()
                      : f.path("value").isNumber() && f.path("value").asDouble() > definition.threshold();
                  return (!f.hasNonNull("validFrom") || Json.str(f, "validFrom").compareTo(Json.str(trip, negative ? "checkOut" : "checkIn")) <= 0)
                      && (!f.hasNonNull("validTo") || Json.str(f, "validTo").compareTo(Json.str(trip, negative ? "checkIn" : "checkOut")) >= 0);
                })
            .toList();
    List<JsonNode> active =
        relevant.stream()
            .filter(
                f -> {
                  try {
                    return Instant.parse(Json.str(f, "expiresAt")).isAfter(now);
                  } catch (DateTimeParseException e) {
                    return false;
                  }
                })
            .toList();
    ObjectNode result =
        Json.obj(
            "feature",
            feature,
            "required",
            preference.path("required").asBoolean(),
            "facts",
            active.isEmpty() ? relevant : active);
    if (active.isEmpty())
      return status(
          result,
          relevant.isEmpty() ? "unknown" : "stale",
          relevant.isEmpty()
              ? "Нет достаточных сведений"
              : "Сведения устарели — нужна повторная проверка");
    if (active.stream()
            .filter(f -> f.hasNonNull("value"))
            .map(f -> f.path("value"))
            .distinct()
            .count()
        > 1)
      return status(result, "conflict", "Источники содержат несовместимые значения");
    if (active.stream().noneMatch(f -> f.hasNonNull("value")))
      return status(
          result,
          "unknown",
          "Источник содержит только частичные сведения: " + Json.str(active.getFirst(), "quote"));
    JsonNode value =
        active.stream().filter(f -> f.hasNonNull("value")).findFirst().orElseThrow().path("value");
    if (definition.threshold() != null
        ? (!value.isNumber() || !Double.isFinite(value.asDouble()) || value.asDouble() < 0)
        : !value.isBoolean())
      return status(result, "unknown", "Источник не содержит проверяемого значения характеристики");
    boolean match =
        definition.threshold() != null
            ? value.asDouble() <= definition.threshold()
            : value.asBoolean();
    return status(
        result,
        match ? "match" : "mismatch",
        feature.equals("beach_walk")
            ? value.asText() + " м по пешеходной сети · вход приближённый"
            : match ? definition.positive() : definition.negative());
  }

  private static ObjectNode status(ObjectNode result, String status, String explanation) {
    return result.put("status", status).put("explanation", explanation);
  }

  public static List<JsonNode> rank(
      List<JsonNode> hotels,
      List<JsonNode> facts,
      List<JsonNode> preferences,
      JsonNode trip,
      Instant now) {
    return rank(hotels, facts, preferences, trip, now, Map.of());
  }

  public static ObjectNode evaluateWithEnvironment(
      List<JsonNode> facts,
      JsonNode preference,
      JsonNode room,
      JsonNode trip,
      Instant now,
      Map<String, JsonNode> environment) {
    return evaluateWithEnvironment(
        facts, preference, room, trip, now, environment, "verified-only");
  }

  public static ObjectNode evaluateWithEnvironment(
      List<JsonNode> facts,
      JsonNode preference,
      JsonNode room,
      JsonNode trip,
      Instant now,
      Map<String, JsonNode> environment,
      String policy) {
    String feature = Json.str(preference, "feature");
    if (Features.get(feature).tool().equals("area") && environment.containsKey(feature)) {
      ObjectNode criterion = environment.get(feature).deepCopy();
      return criterion.put("required", preference.path("required").asBoolean());
    }
    return evaluate(facts, preference, room, trip, now, policy);
  }

  public static List<JsonNode> rank(
      List<JsonNode> hotels,
      List<JsonNode> facts,
      List<JsonNode> preferences,
      JsonNode trip,
      Instant now,
      Map<String, Map<String, JsonNode>> environments) {
    return rank(hotels, facts, preferences, trip, now, environments, "verified-only");
  }

  public static List<JsonNode> rank(
      List<JsonNode> hotels,
      List<JsonNode> facts,
      List<JsonNode> preferences,
      JsonNode trip,
      Instant now,
      Map<String, Map<String, JsonNode>> environments,
      String policy) {
    List<JsonNode> matches = new ArrayList<>();
    Comparator<JsonNode> roomOrder =
        Comparator.comparingInt((JsonNode r) -> ORDER.get(Json.str(r, "status")))
            .thenComparing(r -> r.path("provisional").asBoolean())
            .thenComparing(
                Comparator.comparingInt((JsonNode r) -> r.path("score").asInt()).reversed());
    for (JsonNode hotel : hotels) {
      List<JsonNode> scoped =
          facts.stream().filter(f -> Json.str(f, "hotelId").equals(Json.str(hotel, "id"))).toList();
      List<JsonNode> rooms = new ArrayList<>();
      List<JsonNode> visibleRooms = Evidence.rooms(hotel, now, policy);
      ObjectNode visibleHotel = hotel.deepCopy();
      visibleHotel.set("rooms", Json.array(visibleRooms));
      for (JsonNode room : visibleRooms) {
        List<JsonNode> criteria =
            preferences.stream()
                .map(
                    p ->
                        (JsonNode)
                            BinaryDecisionPolicy.decide(
                                evaluateWithEnvironment(
                                    scoped,
                                    p,
                                    room,
                                    trip,
                                    now,
                                    environments.getOrDefault(Json.str(hotel, "id"), Map.of()),
                                    policy),
                                hotel))
                .toList();
        ObjectNode capacity = BinaryDecisionPolicy.capacity(hotel, room, trip, now);
        int score =
            criteria.stream()
                .mapToInt(
                    c ->
                        Json.str(c, "status").equals("match")
                            ? 3
                            : Json.str(c, "feature").equals("low_noise")
                                    && Json.str(c, "riskLevel").equals("high")
                                ? -3
                                : -2)
                .sum();
        ObjectNode roomMatch =
            Json.obj("room", room, "criteria", criteria, "score", score);
        roomMatch.setAll(AdmissionPolicy.decide(capacity, criteria, trip));
        roomMatch.setAll(capacity);
        rooms.add(roomMatch);
      }
      if (rooms.isEmpty())
        continue; // An invalid or empty category list cannot yield a recommendation.
      rooms.sort(roomOrder);
      matches.add(Json.obj("hotel", visibleHotel, "best", rooms.getFirst(), "rooms", rooms));
    }
    matches.sort(
        (a, b) -> {
          int order = roomOrder.compare(a.path("best"), b.path("best"));
          return order != 0
              ? order
              : Double.compare(
                  a.path("hotel").path("route").path("meters").asDouble(Double.POSITIVE_INFINITY),
                  b.path("hotel").path("route").path("meters").asDouble(Double.POSITIVE_INFINITY));
        });
    return matches;
  }
}
