package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Set;
import ru.opodoydet.shared.Json;

/** Recognition of the user's own text, separate from selected chips and evidence of a room. */
public final class PersonalWishes {
  private PersonalWishes() {}

  public static ObjectNode recognized(
      boolean hasText, List<JsonNode> inferred, Set<String> excluded) {
    List<String> features = inferred.stream().map(item -> Json.str(item, "feature"))
        .filter(feature -> !excluded.contains(feature)).distinct().toList();
    return Json.obj(
        "status", !hasText ? "not_requested" : features.isEmpty() && excluded.isEmpty()
            ? "unrecognized" : "recognized",
        "completeness", "unverified",
        "features", features,
        "excludedFeatures", excluded,
        "ownerCriteria", List.of());
  }

  /** Add generated floor/direction conditions, never the query or the owner's private notes. */
  public static void includeOwnerCriteria(ObjectNode interpreted, List<JsonNode> criteria) {
    if (!interpreted.path("personalWishes").isObject()) return;
    ObjectNode wishes = (ObjectNode) interpreted.path("personalWishes");
    wishes.set("ownerCriteria", Json.array(criteria));
    if (!criteria.isEmpty()) wishes.put("status", "recognized");
  }

  /** No parser claims complete coverage of arbitrary prose, even when known conditions match. */
  public static String notice(JsonNode wishes) {
    return switch (Json.str(wishes, "status")) {
      case "unrecognized" -> "В личном пожелании ничего не распознано. Попробуйте описать нужные условия иначе или выбрать их в фильтрах. Поиск выполнен по выбранным условиям и параметрам поездки.";
      case "recognized" -> "Из личного пожелания проверены только распознанные условия; остальной текст не проверен. Соответствие каждого варианта нужно смотреть отдельно.";
      default -> "";
    };
  }
}
