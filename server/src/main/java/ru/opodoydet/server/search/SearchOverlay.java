package ru.opodoydet.server.search;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Clock;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.opodoydet.application.SearchProjection;
import ru.opodoydet.domain.AdmissionPolicy;
import ru.opodoydet.shared.Json;
import ru.opodoydet.server.catalog.CatalogService;
import ru.opodoydet.server.catalog.Dataset;
import ru.opodoydet.server.knowledge.Characteristic;
import ru.opodoydet.server.knowledge.KnowledgeQueries;

/**
 * Поиск поверх нового ядра знаний.
 *
 * <p>Разбор запроса, условия района (воздух, шум, безопасность), вместимость и объявления из
 * кабинетов пока считает старый API. Условия, которые решаются фактами об отеле и номере
 * (пляж, лестницы, окна во двор, доступность, семейное размещение), здесь пересчитываются по
 * доказательствам ядра — включая ответы отельеров. После этого заново считаются статус и баллы
 * номеров и порядок выдачи.
 *
 * <p>Оба режима допуска используют общую политику основного приложения: неизвестное не становится
 * подтверждением, предварительные варианты явно помечаются, разные номера не объединяются.
 */
@Service
@Transactional(readOnly = true)
public class SearchOverlay implements SearchProjection {

  private static final Map<String, Integer> ORDER = Map.of("fits", 0, "excluded", 1);
  private static final Comparator<JsonNode> ROOM_ORDER =
      Comparator.comparingInt((JsonNode r) -> ORDER.getOrDefault(r.path("status").asText(), 1))
          .thenComparing(r -> r.path("provisional").asBoolean())
          .thenComparing(Comparator.comparingInt((JsonNode r) -> r.path("score").asInt()).reversed());
  private static final Comparator<JsonNode> MATCH_ORDER =
      Comparator.comparing((JsonNode m) -> m.path("best"), ROOM_ORDER)
          .thenComparingDouble(
              m -> m.path("hotel").path("route").path("meters").asDouble(Double.POSITIVE_INFINITY));

  private final KnowledgeQueries knowledge;
  private final CatalogService catalog;
  private final ObjectMapper json;
  private final Clock clock;

  SearchOverlay(KnowledgeQueries knowledge, CatalogService catalog, ObjectMapper json, Clock clock) {
    this.knowledge = knowledge;
    this.catalog = catalog;
    this.json = json;
    this.clock = clock;
  }

  /** All variants are calculated immediately; no JPA entities escape into stored advisor snapshots. */
  @Override
  public SearchProjection.Snapshot snapshot(JsonNode trip, java.time.Instant now) {
    Context captured = context(now);
    JsonNode capturedTrip = trip.deepCopy();
    return (matches, preferences, conflicts) -> {
      List<JsonNode> result = matches.stream().map(m -> (JsonNode) m.deepCopy())
          .collect(Collectors.toCollection(ArrayList::new));
      Set<String> requested = features(Json.array(preferences));
      for (JsonNode match : result)
        recompute((ObjectNode) match, capturedTrip, captured, conflicts, requested);
      result.sort(MATCH_ORDER);
      return result;
    };
  }

  /** Ответ {@code POST /api/search} старого API → тот же ответ с критериями по ядру. */
  public ObjectNode search(ObjectNode response, JsonNode trip) {
    Context context = context();
    boolean conflicts = !response.path("conflicts").isEmpty();
    Set<String> preferenceFeatures = features(response.path("preferences"));

    List<JsonNode> matches = new ArrayList<>();
    response.path("results").forEach(matches::add);
    response.path("excluded").forEach(matches::add);
    int changed = 0;
    for (JsonNode match : matches)
      changed += recompute((ObjectNode) match, trip, context, conflicts, preferenceFeatures);
    if (changed == 0) return response;

    matches.sort(MATCH_ORDER); // устойчивая сортировка: при равенстве сохраняется старый порядок
    ArrayNode results = json.createArrayNode(), excluded = json.createArrayNode();
    for (JsonNode match : matches)
      ("fits".equals(match.path("best").path("status").asText()) ? results : excluded).add(match);
    response.set("results", results);
    response.set("excluded", excluded);
    if (response.path("trace").isArray())
      ((ArrayNode) response.path("trace"))
          .addObject()
          .put("step", "Знания об отелях")
          .put(
              "detail",
              "Условия по фактам пересчитаны с учётом ответов отельеров, изменено оценок: "
                  + changed
                  + ".")
          .put("tool", "Spring · ядро знаний");
    return response;
  }

  /** Ответ {@code POST /api/hotels/{id}/evaluate}: все условия по каждой категории номера. */
  public ObjectNode detail(ObjectNode match, JsonNode trip) {
    Context context = context();
    boolean conflicts = !match.path("conflicts").isEmpty();
    recompute(match, trip, context, conflicts, features(match.path("preferences")));
    return match;
  }

  /** Возвращает число изменённых оценок условий. */
  private int recompute(
      ObjectNode match,
      JsonNode trip,
      Context context,
      boolean conflicts,
      Set<String> preferenceFeatures) {
    String hotelId = match.path("hotel").path("id").asText("");
    if (!context.hotels().contains(hotelId)) return 0; // объявления из кабинетов и т. п.
    int changed = 0;
    List<JsonNode> rooms = new ArrayList<>();
    match.path("rooms").forEach(rooms::add);
    for (JsonNode node : rooms) {
      ObjectNode room = (ObjectNode) node;
      ArrayNode old = (ArrayNode) room.path("criteria");

      int delta = room.path("score").asInt() - score(old, preferenceFeatures);

      ArrayNode updated = json.createArrayNode();
      for (JsonNode criterion : old) {
        String feature = criterion.path("feature").asText();
        if (!context.evaluator().handles(feature)) {
          updated.add(criterion);
          continue;
        }
        ObjectNode fresh =
            DecisionPolicy.decide(
                context
                    .evaluator()
                    .evaluate(
                        hotelId,
                        feature,
                        criterion.path("required").asBoolean(),
                        room.path("room"),
                        trip),
                match.path("hotel"));
        if (!fresh.equals(criterion)) changed++;
        updated.add(fresh);
      }
      if (updated.equals(old)) continue;

      room.set("criteria", updated);
      room.put("score", score(updated, preferenceFeatures) + delta);
      List<JsonNode> requested = Json.list(updated).stream()
          .filter(c -> preferenceFeatures.contains(c.path("feature").asText())).toList();
      ObjectNode decision = AdmissionPolicy.decide(room, requested, trip);
      boolean ownerBlocked = Json.list(match.path("ownerCriteria")).stream()
          .anyMatch(c -> c.path("required").asBoolean() && !AdmissionPolicy.permits(c, trip));
      if (conflicts || ownerBlocked) decision.put("status", "excluded").put("provisional", false);
      else if ("fits".equals(decision.path("status").asText()) && Json.list(match.path("ownerCriteria")).stream()
          .anyMatch(c -> c.path("required").asBoolean() && !"match".equals(c.path("status").asText())))
        decision.put("provisional", true);
      room.setAll(decision);
    }
    if (changed == 0) return 0;
    rooms.sort(ROOM_ORDER);
    ArrayNode sorted = json.createArrayNode();
    rooms.forEach(sorted::add);
    match.set("rooms", sorted);
    ObjectNode best = (ObjectNode) rooms.getFirst().deepCopy();
    match.set("best", best);
    return changed;
  }

  /** Баллы как в старом Matching.rank: +3 за совпадение, −3 за высокий риск шума, иначе −2. */
  private static int score(JsonNode criteria, Set<String> preferenceFeatures) {
    int score = 0;
    for (JsonNode c : criteria) {
      if (!preferenceFeatures.contains(c.path("feature").asText())) continue;
      score +=
          "match".equals(c.path("status").asText())
              ? 3
              : "low_noise".equals(c.path("feature").asText())
                      && "high".equals(c.path("riskLevel").asText())
                  ? -3
                  : -2;
    }
    return score;
  }

  private static Set<String> features(JsonNode preferences) {
    Set<String> result = new HashSet<>();
    preferences.forEach(p -> result.add(p.path("feature").asText()));
    return result;
  }

  private record Context(Set<String> hotels, CriterionEvaluator evaluator) {}

  private Context context() { return context(clock.instant()); }

  private Context context(java.time.Instant now) {
    boolean demo = catalog.dataset().map(Dataset::isDemoPolicy).orElse(false);
    Map<String, Characteristic> characteristics =
        knowledge.characteristics().stream()
            .collect(Collectors.toMap(Characteristic::getCode, Function.identity()));
    var evidence = knowledge.activeEvidenceByHotel();
    return new Context(
        catalog.hotelIds(),
        new CriterionEvaluator(
            characteristics, evidence, knowledge.confidenceByHotel(), now, demo, json));
  }
}
