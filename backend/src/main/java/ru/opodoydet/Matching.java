package ru.opodoydet;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

final class Matching {
  private static final Map<String, Integer> ORDER = Map.of("fits", 0, "clarify", 1, "excluded", 2);

  private Matching() {}

  static ObjectNode evaluate(
      List<JsonNode> facts, JsonNode preference, JsonNode room, JsonNode trip, Instant now) {
    String feature = Json.str(preference, "feature");
    Features.Definition definition = Features.get(feature);
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
            .filter(
                f ->
                    Json.str(f, "feature").equals(feature)
                        && !f.hasNonNull("supersededBy")
                        && (definition.scope().equals("hotel")
                            ? !f.hasNonNull("roomId")
                            : Json.str(f, "roomId").equals(Json.str(room, "id"))))
            .filter(
                f ->
                    (!f.hasNonNull("validFrom")
                            || Json.str(f, "validFrom").compareTo(Json.str(trip, "checkIn")) <= 0)
                        && (!f.hasNonNull("validTo")
                            || Json.str(f, "validTo").compareTo(Json.str(trip, "checkOut")) >= 0))
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
    if (active.stream().map(f -> f.path("value")).distinct().count() > 1)
      return status(result, "conflict", "Источники противоречат друг другу — нужно уточнение");
    JsonNode value = active.getFirst().path("value");
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

  static List<JsonNode> rank(
      List<JsonNode> hotels,
      List<JsonNode> facts,
      List<JsonNode> preferences,
      JsonNode trip,
      Instant now) {
    return rank(hotels, facts, preferences, trip, now, Map.of());
  }

  static ObjectNode evaluateWithEnvironment(
      List<JsonNode> facts,
      JsonNode preference,
      JsonNode room,
      JsonNode trip,
      Instant now,
      Map<String, JsonNode> environment) {
    String feature = Json.str(preference, "feature");
    if (Features.get(feature).tool().equals("area") && environment.containsKey(feature)) {
      ObjectNode criterion = environment.get(feature).deepCopy();
      return criterion.put("required", preference.path("required").asBoolean());
    }
    return evaluate(facts, preference, room, trip, now);
  }

  static List<JsonNode> rank(
      List<JsonNode> hotels,
      List<JsonNode> facts,
      List<JsonNode> preferences,
      JsonNode trip,
      Instant now,
      Map<String, Map<String, JsonNode>> environments) {
    List<JsonNode> matches = new ArrayList<>();
    Comparator<JsonNode> roomOrder =
        Comparator.comparingInt((JsonNode r) -> ORDER.get(Json.str(r, "status")))
            .thenComparing(
                Comparator.comparingInt((JsonNode r) -> r.path("score").asInt()).reversed());
    for (JsonNode hotel : hotels) {
      List<JsonNode> scoped =
          facts.stream().filter(f -> Json.str(f, "hotelId").equals(Json.str(hotel, "id"))).toList();
      List<JsonNode> rooms = new ArrayList<>();
      for (JsonNode room : hotel.path("rooms")) {
        List<JsonNode> criteria =
            preferences.stream()
                .map(
                    p ->
                        (JsonNode)
                            evaluateWithEnvironment(
                                scoped,
                                p,
                                room,
                                trip,
                                now,
                                environments.getOrDefault(Json.str(hotel, "id"), Map.of())))
                .toList();
        boolean capacity =
            room.path("capacity").asInt()
                >= trip.path("adults").asInt() + trip.path("children").asInt();
        String state =
            !capacity
                    || criteria.stream()
                        .anyMatch(
                            c ->
                                c.path("required").asBoolean()
                                    && Json.str(c, "status").equals("mismatch"))
                ? "excluded"
                : criteria.stream()
                        .anyMatch(
                            c ->
                                c.path("required").asBoolean()
                                    && !Json.str(c, "status").equals("match"))
                    ? "clarify"
                    : "fits";
        int score =
            criteria.stream()
                .mapToInt(
                    c ->
                        switch (Json.str(c, "status")) {
                          case "match" -> 3;
                          case "mismatch" ->
                              Json.str(c, "feature").equals("low_noise")
                                      && Json.str(c, "riskLevel").equals("high")
                                  ? -3
                                  : -2;
                          default ->
                              Json.str(c, "status").equals("unknown")
                                      && Json.str(c, "feature").equals("low_noise")
                                      && Json.str(c, "assessmentBasis").equals("historical")
                                      && !c.path("required").asBoolean()
                                  ? switch (Json.str(c, "riskLevel")) {
                                    case "high" -> -3;
                                    case "moderate" -> -2;
                                    default -> -1;
                                  }
                                  : -1;
                        })
                .sum();
        rooms.add(Json.obj("room", room, "criteria", criteria, "status", state, "score", score));
      }
      if (rooms.isEmpty())
        continue; // An invalid or empty category list cannot yield a recommendation.
      rooms.sort(roomOrder);
      matches.add(Json.obj("hotel", hotel, "best", rooms.getFirst(), "rooms", rooms));
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
