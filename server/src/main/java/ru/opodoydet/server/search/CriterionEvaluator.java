package ru.opodoydet.server.search;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import ru.opodoydet.domain.EvidencePeriod;
import ru.opodoydet.server.catalog.RoomPolicy;
import ru.opodoydet.server.knowledge.Characteristic;
import ru.opodoydet.server.knowledge.Evidence;
import ru.opodoydet.server.knowledge.EvidencePolicy;

/**
 * Оценка одного условия поиска по доказательствам нового ядра.
 *
 * <p>Это перенос старого {@code Matching.evaluate} с двумя отличиями:
 *
 * <ul>
 *   <li>учитываются ответы отельера (метод host), а не только официальные данные и геоданные;
 *   <li>расстояния считаются согласными в пределах допуска ядра, а при нескольких источниках
 *       значение берётся у самого надёжного метода.
 * </ul>
 *
 * Без ответов отельера результат побайтно совпадает со старым — это проверяет контракт.
 */
final class CriterionEvaluator {

  /** Порядок надёжности методов: чьё значение берём, если источники согласны. */
  private static final List<String> METHOD_ORDER = List.of("official", "geo", "host", "agent");

  private final Map<String, Characteristic> characteristics;
  private final Map<String, List<Evidence>> evidenceByHotel;
  private final Map<String, Map<String, BigDecimal>> confidence;
  private final Instant now;
  private final boolean demoPolicy;
  private final ObjectMapper json;
  private final Map<String, JsonNode> rawCache = new java.util.HashMap<>();

  CriterionEvaluator(
      Map<String, Characteristic> characteristics,
      Map<String, List<Evidence>> evidenceByHotel,
      Map<String, Map<String, BigDecimal>> confidence,
      Instant now,
      boolean demoPolicy,
      ObjectMapper json) {
    this.characteristics = characteristics;
    this.evidenceByHotel = evidenceByHotel;
    this.confidence = confidence;
    this.now = now;
    this.demoPolicy = demoPolicy;
    this.json = json;
  }

  /** Условия, которые оцениваются по фактам ядра (не по данным района). */
  boolean handles(String feature) {
    Characteristic c = characteristics.get(feature);
    return c != null && !"area".equals(c.getTool());
  }

  /** «Сырая» оценка условия, как старый Matching.evaluate (до правил BinaryDecisionPolicy). */
  ObjectNode evaluate(String hotelId, String feature, boolean required, JsonNode room, JsonNode trip) {
    Characteristic definition = characteristics.get(feature);
    boolean hotelScope = "hotel".equals(definition.getScope());
    ObjectNode result = json.createObjectNode();
    result.put("feature", feature);
    result.put("required", required);
    if (!demoPolicy && !hotelScope && !RoomPolicy.verified(room, now)) {
      result.set("facts", json.createArrayNode());
      return status(result, "unknown", "Категория номера не подтверждена источником");
    }

    String roomId = room.path("id").asText("");
    List<Evidence> relevant = new ArrayList<>();
    for (Evidence e : evidenceByHotel.getOrDefault(hotelId, List.of())) {
      if (!e.getCharacteristic().equals(feature) || !EvidencePolicy.admissible(e, now, demoPolicy))
        continue;
      if (hotelScope ? e.getRoomId() != null : !roomId.equals(e.getRoomId())) continue;
      JsonNode raw = raw(e);
      if (!EvidencePeriod.applies(raw, trip, definition.getThreshold())) continue;
      relevant.add(e);
    }
    List<Evidence> active =
        relevant.stream().filter(e -> e.getExpiresAt() != null && e.getExpiresAt().isAfter(now)).toList();

    ArrayNode facts = result.putArray("facts");
    for (Evidence e : active.isEmpty() ? relevant : active) facts.add(raw(e));
    if (active.isEmpty())
      return status(
          result,
          relevant.isEmpty() ? "unknown" : "stale",
          relevant.isEmpty()
              ? "Нет достаточных сведений"
              : "Сведения устарели — нужна повторная проверка");

    List<Evidence> valued = active.stream().filter(e -> hasValue(e.getValue())).toList();
    annotate(result, hotelId, hotelScope ? null : roomId, feature, valued);
    if (groups(valued, definition.getValueType(), definition.getThreshold()) > 1)
      return status(result, "conflict", "Источники содержат несовместимые значения");
    if (valued.isEmpty())
      return status(
          result,
          "unknown",
          "Источник содержит только частичные сведения: " + active.getFirst().getQuote());

    Evidence chosen =
        valued.stream()
            .min(Comparator.comparingInt(e -> rank(e.getMethod())))
            .orElseThrow();
    JsonNode value = chosen.getValue();
    Integer threshold = definition.getThreshold();
    if (threshold != null
        ? (!value.isNumber() || !Double.isFinite(value.asDouble()) || value.asDouble() < 0)
        : !value.isBoolean())
      return status(result, "unknown", "Источник не содержит проверяемого значения характеристики");
    boolean match = threshold != null ? value.asDouble() <= threshold : value.asBoolean();
    String explanation;
    if ("beach_walk".equals(feature))
      explanation =
          "geo".equals(chosen.getMethod())
              ? value.asText() + " м по пешеходной сети · вход приближённый"
              : value.asText() + " м со слов отеля";
    else explanation = match ? definition.getPositive() : definition.getNegative();
    return status(result, match ? "match" : "mismatch", explanation);
  }

  /** Новые поля (старый фронт их игнорирует): какие методы подтверждают и итоговая уверенность. */
  private void annotate(
      ObjectNode result, String hotelId, String roomId, String feature, List<Evidence> valued) {
    if (valued.stream().noneMatch(e -> !"official".equals(e.getMethod()) && !"geo".equals(e.getMethod())))
      return; // без ответов отельера формат ответа остаётся прежним
    Set<String> methods = new LinkedHashSet<>();
    valued.forEach(e -> methods.add(e.getMethod()));
    ArrayNode sources = result.putArray("sources");
    methods.forEach(sources::add);
    BigDecimal c =
        confidence
            .getOrDefault(hotelId, Map.of())
            .get((roomId == null ? "" : roomId) + ":" + feature);
    if (c != null) result.put("confidence", c);
  }

  private static int groups(List<Evidence> valued, String valueType, Integer threshold) {
    List<JsonNode> representatives = new ArrayList<>();
    for (Evidence e : valued)
      if (representatives.stream().noneMatch(r -> same(r, e.getValue(), valueType, threshold)))
        representatives.add(e.getValue());
    return representatives.size();
  }

  static boolean same(JsonNode a, JsonNode b, String valueType, Integer threshold) {
    // Approximate measurements can agree only when they imply the same search decision.
    if (threshold != null && a.isNumber() && b.isNumber()
        && (a.asDouble() <= threshold) != (b.asDouble() <= threshold)) return false;
    if ("meters".equals(valueType) && a.isNumber() && b.isNumber()) {
      double x = a.asDouble(), y = b.asDouble();
      return Math.abs(x - y) <= Math.max(50.0, 0.25 * Math.min(x, y));
    }
    return a.equals(b);
  }

  private static int rank(String method) {
    int index = METHOD_ORDER.indexOf(method);
    return index < 0 ? METHOD_ORDER.size() : index;
  }

  private static boolean hasValue(JsonNode value) {
    return value != null && !value.isNull() && !value.isMissingNode();
  }

  private static ObjectNode status(ObjectNode result, String status, String explanation) {
    return result.put("status", status).put("explanation", explanation);
  }

  private JsonNode raw(Evidence e) {
    return rawCache
        .computeIfAbsent(
            e.getId(),
            id -> {
              try {
                return json.readTree(e.getRaw());
              } catch (IOException ex) {
                throw new UncheckedIOException(ex);
              }
            })
        .deepCopy();
  }
}
