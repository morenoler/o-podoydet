package ru.opodoydet.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import ru.opodoydet.shared.Json;

/** Admission stays binary; missing evidence never becomes a positive hotel fact. */
public final class BinaryDecisionPolicy {
  private BinaryDecisionPolicy() {}

  public static ObjectNode decide(JsonNode raw, JsonNode hotel) {
    ObjectNode result = raw.deepCopy();
    String status = Json.str(raw, "status"), original = Json.str(raw, "explanation");
    result.put("evidenceStatus", status).put("sourceExplanation", original);
    if (Set.of("match", "mismatch").contains(status))
      return result.put("assumed", false).put("decisionBasis", "evidence");
    String reason =
        switch (Json.str(raw, "feature")) {
          case "beach_walk" ->
              "Нет пригодного подтверждения расстояния до пляжа. Сохранённый маршрут не заменяет недостающие, устаревшие или противоречивые сведения.";
          case "step_free_route" ->
              "Отсутствие лестниц на карте и рассчитанный обход не подтверждают доступность всего пути без ступеней.";
          case "courtyard" -> "Направление окон выбранного номера не подтверждено.";
          case "step_free_access" ->
              "Доступ без ступеней на всём пути до выбранного номера не подтверждён.";
          case "family" ->
              "Тип размещения не подтверждает условия для семьи в выбранной категории номера.";
          case "area_safety" ->
              "Недостаточно сопоставимых сведений для подтверждения условия. Это не вывод об опасности района.";
          case "clean_air" ->
              "Нет достаточных данных о качестве воздуха на даты поездки. Текущий AQI не является прогнозом на поездку.";
          case "low_noise" ->
              "Расстояние до дороги и историческая транспортная нагрузка не подтверждают тишину в выбранном номере на даты поездки.";
          default -> "Нет достаточных подтверждений этого условия.";
        };
    String context =
        status.equals("stale")
            ? "Сведения устарели."
            : status.equals("conflict") ? "Источники противоречат друг другу." : "Недостаточно данных.";
    return result.put("status", "mismatch").put("assumed", true).put("decisionBasis", "estimate")
        .put("assumption", reason).put("explanation", context + " Требуется уточнение: " + reason);
  }

  private static boolean freshSource(JsonNode value, Instant now) {
    try {
      URI uri = URI.create(Json.str(value, "sourceUrl"));
      Instant obtained = Instant.parse(Json.str(value, "obtainedAt"));
      return Set.of("http", "https").contains(uri.getScheme())
          && uri.getHost() != null && uri.getUserInfo() == null
          && !Json.str(value, "quote").isBlank()
          && !obtained.isAfter(now) && !obtained.isBefore(now.minusSeconds(30L * 86400));
    } catch (RuntimeException invalid) { return false; }
  }

  private static boolean integer(JsonNode value, int low, int high) {
    return value.isIntegralNumber() && value.canConvertToInt()
        && value.asInt() >= low && value.asInt() <= high;
  }

  private static boolean validRule(JsonNode rule, Instant now) {
    if (!rule.isObject() || !freshSource(rule, now) || !integer(rule.path("maxGuests"), 1, 20))
      return false;
    for (String key : List.of("maxAdults", "maxChildren", "minChildren", "childMaxAge"))
      if (rule.has(key) && !integer(rule.path(key), 0, 20)) return false;
    int maximum = rule.path("maxGuests").asInt();
    return rule.path("maxAdults").asInt(0) <= maximum
        && rule.path("maxChildren").asInt(0) <= maximum
        && rule.path("minChildren").asInt(0) <= rule.path("maxChildren").asInt(maximum);
  }

  public static ObjectNode capacity(JsonNode hotel, JsonNode room, JsonNode trip) {
    return capacity(hotel, room, trip, Instant.now());
  }

  public static ObjectNode capacity(JsonNode hotel, JsonNode room, JsonNode trip, Instant now) {
    boolean known = room.path("capacity").isIntegralNumber()
        && room.path("capacity").canConvertToInt() && room.path("capacity").asInt() > 0;
    int adults = trip.path("adults").asInt(), children = trip.path("children").asInt();
    if (known && room.path("capacity").asInt() >= adults + children)
      return Json.obj("capacityStatus", "match", "capacityEvidenceStatus", "match",
          "capacityAssumed", false, "capacityExplanation", "Указанной вместимости достаточно для всех гостей.");
    List<JsonNode> rules = Json.list(room.path("occupancyRules"));
    if (room.path("demo").isBoolean() && !room.path("demo").asBoolean()
        && Json.str(room, "evidenceStatus").equals("verified") && freshSource(room, now)) {
      for (JsonNode rule : rules) {
        if (!validRule(rule, now)) continue;
        int maximum = rule.path("maxGuests").asInt();
        if (adults + children > maximum || adults > rule.path("maxAdults").asInt(maximum)
            || children > rule.path("maxChildren").asInt(maximum)
            || children < rule.path("minChildren").asInt(0)) continue;
        // Trip does not collect ages; never assume that children meet an age limit.
        if (children > 0 && rule.has("childMaxAge")) continue;
        return Json.obj("capacityStatus", "match", "capacityEvidenceStatus", "match",
            "capacityAssumed", false, "capacityRule", rule,
            "capacityExplanation", "Опубликованное правило размещения допускает этот состав гостей. Наличие номера на даты не проверено.");
      }
    }
    boolean unresolved = !known || room.path("capacityMayVary").asBoolean(false) || !rules.isEmpty();
    String explanation = unresolved
        ? children > 0 && rules.stream().anyMatch(rule -> rule.has("childMaxAge"))
            ? "Вместимость требует уточнения: опубликованное правило ограничивает возраст детей, а их возраст не указан."
            : "Вместимость требует уточнения: нет достаточных подтверждений для этого состава гостей. Это не установленный недостаток мест."
        : "Указанная вместимость меньше числа гостей.";
    return Json.obj("capacityStatus", "mismatch", "capacityEvidenceStatus", unresolved ? "unknown" : "mismatch",
        "capacityAssumed", unresolved, "capacityExplanation", explanation);
  }
}
