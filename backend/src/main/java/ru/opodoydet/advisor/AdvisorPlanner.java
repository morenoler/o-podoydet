package ru.opodoydet.advisor;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import ru.opodoydet.domain.Features;
import ru.opodoydet.domain.Matching;
import ru.opodoydet.shared.Json;

/** All eligibility and counterfactual counts come from the ordinary matching engine. */
public final class AdvisorPlanner {
  private AdvisorPlanner() {}

  public static ObjectNode plan(
      JsonNode trip,
      ObjectNode interpreted,
      List<JsonNode> hotels,
      List<JsonNode> facts,
      Instant now,
      Map<String, Map<String, JsonNode>> environments,
      String policy) {
    List<JsonNode> preferences = Json.list(interpreted.path("preferences"));
    List<JsonNode> ranked =
        Matching.rank(hotels, facts, preferences, trip, now, environments, policy);
    boolean conflict = !interpreted.path("conflicts").isEmpty();
    List<JsonNode> fit =
        conflict ? List.of() : ranked.stream().filter(AdvisorPlanner::fits).toList();
    List<JsonNode> candidates =
        ranked.stream()
            .sorted(
                (a, b) -> {
                  if (fits(a) || fits(b)) return Boolean.compare(fits(b), fits(a));
                  int blockers = Integer.compare(blockers(a), blockers(b));
                  return blockers != 0 ? blockers : Integer.compare(uncertainty(a), uncertainty(b));
                })
            .limit(6)
            .map(item -> candidate(item, conflict))
            .toList();
    Set<String> ids = candidates.stream().map(c -> Json.str(c, "id")).collect(Collectors.toSet());
    List<JsonNode> scenarios = new ArrayList<>();
    List<String> warnings =
        new ArrayList<>(
            Json.list(interpreted.path("warnings")).stream().map(JsonNode::asText).toList());
    warnings.add("Цены, наличие номеров на даты и бронирование не проверены.");
    if (!conflict) {
      for (JsonNode preference : preferences) {
        String feature = Json.str(preference, "feature"), label = Features.get(feature).label();
        boolean required = preference.path("required").asBoolean();
        if (!fit.isEmpty() && !required) {
          List<JsonNode> ordered = new ArrayList<>(fit);
          ordered.sort(Comparator.comparingInt(item -> optionalPriority(item, feature)));
          scenarios.add(
              Json.obj(
                  "id",
                  "priority-" + feature,
                  "feature",
                  feature,
                  "label",
                  "В первую очередь: " + label,
                  "kind",
                  "optional_priority",
                  "count",
                  fit.size(),
                  "gainedCount",
                  0,
                  "candidateIds",
                  existingIds(ordered, ids),
                  "explanation",
                  "Меняется только порядок уже подходящих вариантов. Обязательные условия"
                      + " сохранены."));
        } else if (fit.isEmpty() && required) {
          List<JsonNode> changed =
              preferences.stream()
                  .map(
                      p -> {
                        ObjectNode copy = p.deepCopy();
                        if (Json.str(p, "feature").equals(feature)) copy.put("required", false);
                        return (JsonNode) copy;
                      })
                  .toList();
          List<JsonNode> possible =
              Matching.rank(hotels, facts, changed, trip, now, environments, policy).stream()
                  .filter(AdvisorPlanner::fits)
                  .toList();
          scenarios.add(
              Json.obj(
                  "id",
                  "consent-" + feature,
                  "feature",
                  feature,
                  "label",
                  "Если сделать желательным: " + label,
                  "kind",
                  "requires_consent",
                  "count",
                  possible.size(),
                  "gainedCount",
                  possible.size(),
                  "candidateIds",
                  existingIds(possible, ids),
                  "explanation",
                  "Только предварительный расчёт. Требуется ваше согласие изменить одно"
                      + " обязательное условие. Гости, даты, вместимость и остальные требования"
                      + " сохранены; наличие не проверено."));
        }
      }
      if (fit.isEmpty() && scenarios.stream().noneMatch(s -> s.path("gainedCount").asInt() > 0))
        warnings.add("Смягчение одного обязательного пожелания не даёт подходящих вариантов.");
    }
    List<JsonNode> questions = new ArrayList<>();
    if (conflict) {
      questions.add(
          Json.obj(
              "id",
              "resolve-conflict",
              "text",
              "Уточните противоречащие пожелания: что нужно оставить?",
              "reason",
              String.join(
                  " ",
                  Json.list(interpreted.path("conflicts")).stream()
                      .map(JsonNode::asText)
                      .toList())));
    } else {
      for (JsonNode candidate : candidates) {
        for (JsonNode evidence : candidate.path("criteria")) {
          if (questions.size() >= 3
              || !evidence.path("required").asBoolean()
              || (!evidence.path("assumed").asBoolean()
                  && !Set.of("unknown", "stale", "conflict")
                      .contains(Json.str(evidence, "evidenceStatus")))) continue;
          String feature = Json.str(evidence, "feature");
          if (feature.equals("capacity")
              || questions.stream().anyMatch(q -> Json.str(q, "feature").equals(feature))) continue;
          ObjectNode question =
              Json.obj(
                  "id",
                  "check-" + Json.str(evidence, "id"),
                  "text",
                  "Пожелание «"
                      + Json.str(evidence, "label")
                      + "» остаётся обязательным, пока нет подтверждения, или вы готовы"
                      + " пересмотреть его в настройках пожеланий?",
                  "reason",
                  Json.str(candidate, "hotelName")
                      + ", "
                      + Json.str(candidate, "roomName")
                      + ": "
                      + Json.str(evidence, "explanation"));
          question.put("feature", feature);
          questions.add(question);
        }
      }
    }
    ObjectNode context =
        Json.obj(
            "trip",
            trip,
            "preferences",
            preferences,
            "totalHotels",
            hotels.size(),
            "fitCount",
            fit.size(),
            "conflicts",
            interpreted.path("conflicts"),
            "warnings",
            warnings,
            "candidates",
            candidates,
            "scenarios",
            scenarios,
            "questions",
            questions,
            "generatedAt",
            now.toString());
    // Lab diagnostics reuse this exact rank result, including cases outside the model shortlist.
    List<JsonNode> testCases =
        ranked.stream()
            .filter(item -> item.path("hotel").path("synthetic").asBoolean(false))
            .map(item -> candidate(item, conflict))
            .toList();
    if (!testCases.isEmpty()) context.set("testCases", Json.array(testCases));
    return context;
  }

  private static boolean fits(JsonNode match) {
    return Json.str(match.path("best"), "status").equals("fits");
  }

  private static int blockers(JsonNode match) {
    JsonNode room = match.path("best");
    return (Json.str(room, "capacityStatus").equals("mismatch") ? 1 : 0)
        + (int)
            Json.list(room.path("criteria")).stream()
                .filter(
                    c -> c.path("required").asBoolean() && Json.str(c, "status").equals("mismatch"))
                .count();
  }

  private static int uncertainty(JsonNode match) {
    JsonNode room = match.path("best");
    return (room.path("capacityAssumed").asBoolean() ? 1 : 0)
        + (int)
            Json.list(room.path("criteria")).stream()
                .filter(
                    c ->
                        c.path("assumed").asBoolean()
                            || Set.of("unknown", "stale", "conflict")
                                .contains(Json.str(c, "evidenceStatus")))
                .count();
  }

  private static boolean safeUrl(JsonNode value) {
    if (!value.isTextual()) return false;
    try {
      java.net.URI uri = java.net.URI.create(value.asText());
      return ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))
          && uri.getHost() != null
          && uri.getRawUserInfo() == null;
    } catch (IllegalArgumentException error) {
      return false;
    }
  }

  private static String id(JsonNode match) {
    return Json.str(match.path("hotel"), "id")
        + "::"
        + Json.str(match.path("best").path("room"), "id");
  }

  private static List<String> existingIds(List<JsonNode> ranked, Set<String> ids) {
    return ranked.stream().map(AdvisorPlanner::id).filter(ids::contains).limit(6).toList();
  }

  private static int optionalPriority(JsonNode match, String feature) {
    return Json.list(match.path("best").path("criteria")).stream()
            .filter(c -> Json.str(c, "feature").equals(feature))
            .anyMatch(c -> Json.str(c, "status").equals("match"))
        ? 0
        : 1;
  }

  private static JsonNode candidate(JsonNode match, boolean conflict) {
    JsonNode hotel = match.path("hotel"), best = match.path("best"), room = best.path("room");
    String id = id(match);
    List<JsonNode> criteria = new ArrayList<>();
    criteria.add(
        Json.obj(
            "id",
            id + "::capacity",
            "feature",
            "capacity",
            "label",
            "Вместимость",
            "required",
            true,
            "status",
            best.path("capacityStatus"),
            "evidenceStatus",
            best.path("capacityEvidenceStatus"),
            "assumed",
            best.path("capacityAssumed"),
            "explanation",
            best.path("capacityExplanation"),
            "sources",
            safeUrl(room.path("sourceUrl"))
                ? List.of(Json.obj("url", room.path("sourceUrl"), "label", "Категория номера"))
                : List.of()));
    for (JsonNode criterion : best.path("criteria")) {
      String feature = Json.str(criterion, "feature");
      List<JsonNode> sources = new ArrayList<>();
      for (JsonNode fact : criterion.path("facts"))
        if (safeUrl(fact.path("sourceUrl")))
          sources.add(Json.obj("url", fact.path("sourceUrl"), "label", Json.str(fact, "source")));
      for (JsonNode evidence : criterion.path("environmentalEvidence"))
        if (safeUrl(evidence.path("sourceUrl")))
          sources.add(Json.obj("url", evidence.path("sourceUrl"), "label", "Данные района"));
      criteria.add(
          Json.obj(
              "id",
              id + "::" + feature,
              "feature",
              feature,
              "label",
              Features.get(feature).label(),
              "required",
              criterion.path("required"),
              "status",
              criterion.path("status"),
              "evidenceStatus",
              criterion.path("evidenceStatus"),
              "assumed",
              criterion.path("assumed"),
              "explanation",
              criterion.path("explanation"),
              "sources",
              sources.stream().distinct().limit(3).toList()));
    }
    return Json.obj(
        "id",
        id,
        "hotelId",
        hotel.path("id"),
        "hotelName",
        hotel.path("name"),
        "roomId",
        room.path("id"),
        "roomName",
        room.path("name"),
        "status",
        conflict ? "excluded" : Json.str(best, "status"),
        "score",
        best.path("score"),
        "criteria",
        criteria);
  }
}
