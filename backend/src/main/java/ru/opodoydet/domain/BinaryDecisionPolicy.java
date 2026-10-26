package ru.opodoydet.domain;

import java.util.Set;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/** Binary product decisions are separate from unchanged source evidence and raw evaluations. */
public final class BinaryDecisionPolicy {
  private BinaryDecisionPolicy() {}

  public static ObjectNode decide(JsonNode raw, JsonNode hotel) {
    ObjectNode result = (ObjectNode) raw.deepCopy();
    String status = Json.str(raw, "status"), original = Json.str(raw, "explanation");
    result.put("evidenceStatus", status).put("sourceExplanation", original);
    if (Set.of("match", "mismatch").contains(status))
      return result.put("assumed", false).put("decisionBasis", "evidence");
    boolean match = false;
    String reason;
    JsonNode route = hotel.path("route");
    switch (Json.str(raw, "feature")) {
      case "beach_walk" -> {
        match = nonnegative(route.path("meters")) && route.path("meters").asDouble() <= 1000;
        reason =
            route.isObject()
                ? "Используем сохранённое расстояние до пляжа и порог 1 км."
                : "Без рассчитанного маршрута считаем фильтр близости пляжа невыполненным.";
      }
      case "step_free_route" -> {
        match =
            route.isObject()
                && ((route.path("steps").isIntegralNumber() && route.path("steps").asInt() == 0)
                    || nonnegative(route.path("noStepsAlternative").path("meters")));
        reason = "Оцениваем путь по отметкам лестниц и обходу на карте; весь путь не обследован.";
      }
      case "courtyard" ->
          reason = "Без подтверждения окон во двор считаем этот фильтр невыполненным.";
      case "step_free_access" ->
          reason =
              "Без подтверждения всего пути до номера считаем фильтр доступа без ступеней"
                  + " невыполненным.";
      case "family" -> {
        match =
            Set.of("hotel", "guest_house", "apartment").contains(Json.str(hotel, "lodgingType"));
        reason =
            "Грубая оценка по типу размещения: отели, гостевые дома и апартаменты считаем"
                + " подходящими для семьи; условия конкретного номера не подтверждены.";
      }
      case "area_safety" ->
          reason =
              "Нет сопоставимого показателя для этого фильтра: считаем условие невыполненным. Это"
                  + " не вывод об опасности района.";
      case "clean_air" -> {
        match =
            nonnegative(raw.path("currentAirUsAqi"))
                && raw.path("currentAirUsAqi").asDouble() <= 50;
        reason =
            nonnegative(raw.path("currentAirUsAqi"))
                ? "Грубая оценка по текущему US AQI "
                    + raw.path("currentAirUsAqi").asText()
                    + " от "
                    + Json.str(raw, "currentAirTime")
                    + ": принимаем значение не выше 50. Это не прогноз на поездку."
                : "Нет полного прогноза и свежего текущего снимка; считаем фильтр чистого воздуха"
                    + " невыполненным.";
      }
      case "low_noise" -> {
        if (Json.str(raw, "assessmentBasis").equals("historical")
            && Set.of("low", "moderate", "high").contains(Json.str(raw, "riskLevel"))) {
          match = Json.str(raw, "riskLevel").equals("low");
          reason =
              "Грубая оценка по исторической транспортной нагрузке: принимаем только низкий"
                  + " расчётный риск. Это не прогноз и не измерение шума на даты поездки.";
        } else {
          double nearest =
              nonnegative(raw.path("nearestRoadMeters"))
                  ? raw.path("nearestRoadMeters").asDouble()
                  : Double.POSITIVE_INFINITY;
          if (!Double.isFinite(nearest))
            for (JsonNode source : hotel.path("noise"))
              if (Json.str(source, "kind").equals("road") && nonnegative(source.path("meters")))
                nearest = Math.min(nearest, source.path("meters").asDouble());
          match = Double.isFinite(nearest) && nearest > 150;
          reason =
              Double.isFinite(nearest)
                  ? "Грубая оценка по ближайшей отмеченной дороге: "
                      + Math.round(nearest)
                      + " м; фильтр проходит при расстоянии больше 150 м. Это не замер шума."
                  : "Нет данных даже о ближайшей дороге; считаем фильтр внешнего шума"
                      + " невыполненным.";
        }
      }
      default ->
          reason = "Недостаточно источников: по правилу подбора считаем условие невыполненным.";
    }
    return result
        .put("status", match ? "match" : "mismatch")
        .put("assumed", true)
        .put("decisionBasis", "estimate")
        .put("assumption", reason)
        .put("explanation", "Оценка: " + reason);
  }

  public static ObjectNode capacity(JsonNode hotel, JsonNode room, JsonNode trip) {
    boolean known = room.path("capacity").isIntegralNumber() && room.path("capacity").asInt() > 0;
    int count =
        known
            ? room.path("capacity").asInt()
            : Json.str(hotel, "lodgingType").equals("apartment") ? 4 : 2;
    boolean match = count >= trip.path("adults").asInt() + trip.path("children").asInt();
    boolean conditional = known && !match && room.path("capacityMayVary").asBoolean(false);
    ObjectNode result =
        Json.obj(
            "capacityStatus",
            match ? "match" : "mismatch",
            "capacityEvidenceStatus",
            !known || conditional ? "unknown" : match ? "match" : "mismatch",
            "capacityAssumed",
            !known || conditional,
            "capacityExplanation",
            !known
                ? "Оценка: предполагаем вместимость " + count + " гостей по типу размещения."
                : conditional
                    ? "Оценка: не учитываем условное увеличение вместимости без подтверждения"
                        + " условий."
                    : match
                        ? "Указанной вместимости достаточно для всех гостей."
                        : "Указанная вместимость меньше числа гостей.");
    if (!known) result.put("estimatedCapacity", count);
    return result;
  }

  private static boolean nonnegative(JsonNode value) {
    return value.isNumber() && Double.isFinite(value.asDouble()) && value.asDouble() >= 0;
  }
}
