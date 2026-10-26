package ru.opodoydet.server.search;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Set;

/**
 * Перенос старого {@code BinaryDecisionPolicy.decide} для условий, которые оцениваются по фактам.
 * Подбор всегда бинарный: если доказательства нет, условие решается грубой оценкой и честно
 * помечается {@code assumed: true}. Условия района (воздух, шум, безопасность) по-прежнему решает
 * старый API.
 */
final class DecisionPolicy {

  private DecisionPolicy() {}

  static ObjectNode decide(ObjectNode raw, JsonNode hotel) {
    ObjectNode result = raw.deepCopy();
    String status = raw.path("status").asText(""), original = raw.path("explanation").asText("");
    result.put("evidenceStatus", status).put("sourceExplanation", original);
    if (Set.of("match", "mismatch").contains(status))
      return result.put("assumed", false).put("decisionBasis", "evidence");
    boolean match = false;
    String reason;
    JsonNode route = hotel.path("route");
    switch (raw.path("feature").asText("")) {
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
      case "courtyard" -> reason = "Без подтверждения окон во двор считаем этот фильтр невыполненным.";
      case "step_free_access" ->
          reason =
              "Без подтверждения всего пути до номера считаем фильтр доступа без ступеней"
                  + " невыполненным.";
      case "family" -> {
        match =
            Set.of("hotel", "guest_house", "apartment").contains(hotel.path("lodgingType").asText(""));
        reason =
            "Грубая оценка по типу размещения: отели, гостевые дома и апартаменты считаем"
                + " подходящими для семьи; условия конкретного номера не подтверждены.";
      }
      default -> reason = "Недостаточно источников: по правилу подбора считаем условие невыполненным.";
    }
    return result
        .put("status", match ? "match" : "mismatch")
        .put("assumed", true)
        .put("decisionBasis", "estimate")
        .put("assumption", reason)
        .put("explanation", "Оценка: " + reason);
  }

  private static boolean nonnegative(JsonNode value) {
    return value.isNumber() && Double.isFinite(value.asDouble()) && value.asDouble() >= 0;
  }
}
