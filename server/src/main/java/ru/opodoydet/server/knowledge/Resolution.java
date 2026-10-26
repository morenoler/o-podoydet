package ru.opodoydet.server.knowledge;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.ToDoubleFunction;

/**
 * Чистая функция «доказательства → факт». Без БД и Spring, поэтому легко тестируется и легко
 * объясняется жюри.
 *
 * <ol>
 *   <li>Отбрасываем недопустимые доказательства ({@link EvidencePolicy#admissible}).
 *   <li>Срок жизни: {@code expiresAt} источника, иначе {@code obtainedAt + ttl} характеристики.
 *   <li>Нет свежих со значением, но есть устаревшие — {@code stale}: нужна перепроверка.
 *   <li>Свежие согласны — {@code confirmed}; уверенность складывается как noisy-OR: два независимых
 *       источника по 0.6 дают 0.84.
 *   <li>Свежие расходятся — {@code conflict}: берём значение с наибольшим весом, а уверенность
 *       снижаем на вес лучшего несогласного.
 * </ol>
 *
 * <p>Вес доказательства = априорное доверие к методу × уровень уверенности источника.
 */
public final class Resolution {

  public record Outcome(
      JsonNode value,
      Fact.Status status,
      double confidence,
      List<String> evidenceIds,
      Instant validUntil,
      String conflictReason) {}

  static final Map<String, Double> LEVEL = Map.of("low", 0.45, "medium", 0.7, "high", 0.9);
  static final double UNKNOWN_LEVEL = 0.5;

  private Resolution() {}

  public static Outcome compute(
      List<Evidence> evidence,
      int ttlDays,
      Map<String, Double> methodPrior,
      Instant now,
      boolean demoPolicy) {
    return compute(evidence, ttlDays, "boolean", methodPrior, now, demoPolicy);
  }

  public static Outcome compute(
      List<Evidence> evidence,
      int ttlDays,
      String valueType,
      Map<String, Double> methodPrior,
      Instant now,
      boolean demoPolicy) {
    List<Evidence> admissible =
        evidence.stream().filter(e -> EvidencePolicy.admissible(e, now, demoPolicy)).toList();
    ToDoubleFunction<Evidence> weight =
        e ->
            methodPrior.getOrDefault(e.getMethod(), 0.0)
                * LEVEL.getOrDefault(e.getConfidenceLevel(), UNKNOWN_LEVEL);

    List<Evidence> withValue = admissible.stream().filter(e -> hasValue(e.getValue())).toList();
    List<Evidence> fresh =
        withValue.stream().filter(e -> expiry(e, ttlDays).isAfter(now)).toList();

    if (fresh.isEmpty()) {
      if (!withValue.isEmpty()) {
        Evidence latest =
            withValue.stream()
                .max(Comparator.comparing(e -> expiry(e, ttlDays)))
                .orElseThrow();
        return new Outcome(
            latest.getValue(),
            Fact.Status.stale,
            0.0,
            ids(withValue),
            expiry(latest, ttlDays),
            null);
      }
      return new Outcome(null, Fact.Status.unknown, 0.0, ids(admissible), null, null);
    }

    // Группируем свежие доказательства по значению, сохраняя порядок появления. Расстояния
    // считаются согласными в пределах допуска: 36 м и 50 м до пляжа — одно и то же утверждение.
    Map<JsonNode, List<Evidence>> byValue = new LinkedHashMap<>();
    for (Evidence e : fresh) {
      JsonNode key =
          byValue.keySet().stream()
              .filter(k -> same(k, e.getValue(), valueType))
              .findFirst()
              .orElse(e.getValue());
      byValue.computeIfAbsent(key, k -> new ArrayList<>()).add(e);
    }

    List<Map.Entry<JsonNode, Double>> ranked = new ArrayList<>();
    for (var group : byValue.entrySet())
      ranked.add(Map.entry(group.getKey(), noisyOr(group.getValue(), weight)));
    ranked.sort(Map.Entry.<JsonNode, Double>comparingByValue().reversed());

    List<Evidence> supporting = byValue.get(ranked.getFirst().getKey());
    // Значение группы — у самого весомого доказательства в ней.
    JsonNode chosen =
        supporting.stream().max(Comparator.comparingDouble(weight)).orElseThrow().getValue();
    Instant validUntil =
        supporting.stream().map(e -> expiry(e, ttlDays)).min(Comparator.naturalOrder()).orElse(null);

    if (ranked.size() == 1)
      return new Outcome(
          chosen,
          Fact.Status.confirmed,
          ranked.getFirst().getValue(),
          ids(fresh),
          validUntil,
          null);

    double best = ranked.get(0).getValue(), runnerUp = ranked.get(1).getValue();
    String reason =
        "Источники расходятся: "
            + String.join(
                " / ",
                ranked.stream()
                    .map(r -> r.getKey() + " (вес " + round(r.getValue()) + ")")
                    .toList());
    return new Outcome(
        chosen,
        Fact.Status.conflict,
        Math.max(0.0, best * (1 - runnerUp)),
        ids(fresh),
        validUntil,
        reason);
  }

  /** Допуск для расстояний: max(50 м, 25% от меньшего). Остальные типы — точное совпадение. */
  static boolean same(JsonNode a, JsonNode b, String valueType) {
    if ("meters".equals(valueType) && a.isNumber() && b.isNumber()) {
      double x = a.asDouble(), y = b.asDouble();
      return Math.abs(x - y) <= Math.max(50.0, 0.25 * Math.min(x, y));
    }
    return a.equals(b);
  }

  static Instant expiry(Evidence e, int ttlDays) {
    if (e.getExpiresAt() != null) return e.getExpiresAt();
    Instant base = Objects.requireNonNullElse(e.getObtainedAt(), Instant.EPOCH);
    return base.plus(ttlDays, ChronoUnit.DAYS);
  }

  private static boolean hasValue(JsonNode value) {
    return value != null && !value.isNull() && !value.isMissingNode();
  }

  private static double noisyOr(List<Evidence> group, ToDoubleFunction<Evidence> weight) {
    double miss = 1.0;
    for (Evidence e : group) miss *= 1 - Math.min(1.0, Math.max(0.0, weight.applyAsDouble(e)));
    return 1 - miss;
  }

  private static List<String> ids(List<Evidence> evidence) {
    return evidence.stream().map(Evidence::getId).toList();
  }

  private static String round(double value) {
    return String.format(java.util.Locale.ROOT, "%.2f", value);
  }
}
