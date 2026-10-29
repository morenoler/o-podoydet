package ru.opodoydet.server.knowledge;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.opodoydet.server.host.DemoHostGuard;
import ru.opodoydet.server.catalog.CatalogService;

/**
 * Новый API ядра знаний. Здесь видно то, чего не было в старом: итоговый статус факта,
 * числовая уверенность, срок годности и полная цепочка доказательств («почему мы так думаем»).
 */
@RestController
@RequestMapping("/api/v2")
public class KnowledgeController {

  public record EvidenceView(
      String id,
      String method,
      String source,
      String sourceUrl,
      String quote,
      JsonNode value,
      String confidenceLevel,
      String confidenceReason,
      Instant obtainedAt,
      Instant expiresAt,
      boolean demo,
      boolean simulated,
      boolean admissible,
      boolean expired) {}

  public record FactView(
      String characteristic,
      String label,
      String roomId,
      JsonNode value,
      Fact.Status status,
      BigDecimal confidence,
      Instant validUntil,
      Instant resolvedAt,
      List<EvidenceView> evidence) {}

  public record ConflictView(
      Long id,
      String characteristic,
      List<String> evidenceIds,
      String reason,
      Instant detectedAt,
      Instant resolvedAt,
      String resolution) {}

  public record HotelKnowledge(String hotelId, List<FactView> facts, List<ConflictView> conflicts) {}

  private final KnowledgeQueries queries;
  private final FactResolver resolver;
  private final Clock clock;
  private final DemoHostGuard guard;
  private final CatalogService catalog;

  KnowledgeController(KnowledgeQueries queries, FactResolver resolver, Clock clock, DemoHostGuard guard, CatalogService catalog) {
    this.queries = queries;
    this.resolver = resolver;
    this.clock = clock;
    this.guard = guard;
    this.catalog = catalog;
  }

  @GetMapping("/characteristics")
  public List<Characteristic> characteristics() {
    return queries.characteristics();
  }

  @GetMapping("/hotels/{id}/knowledge")
  public ResponseEntity<?> hotel(@PathVariable String id) {
    if (catalog.hotelRegion(id).isEmpty())
      return ResponseEntity.status(404).body(Map.of("error", "Отель не найден в активном каталоге"));
    List<Fact> facts = queries.facts(id);
    if (facts.isEmpty())
      return ResponseEntity.status(404)
          .body(Map.of("error", "Для отеля " + id + " нет фактов (проверьте id)"));
    Instant now = clock.instant();
    List<Characteristic> definitions = queries.characteristics();
    Map<String, String> labels =
        definitions.stream()
            .collect(Collectors.toMap(Characteristic::getCode, Characteristic::getLabel));
    Map<String, Characteristic> byCode =
        definitions.stream()
            .collect(Collectors.toMap(Characteristic::getCode, Function.identity()));
    Map<String, Evidence> evidence =
        queries.evidenceById(facts.stream().flatMap(f -> f.getEvidenceIds().stream()).toList());

    List<FactView> views =
        facts.stream()
            .map(
                f ->
                    new FactView(
                        f.getCharacteristic(),
                        labels.getOrDefault(f.getCharacteristic(), f.getCharacteristic()),
                        f.getRoomId(),
                        complete(f, byCode, evidence) ? f.getValue() : null,
                        complete(f, byCode, evidence) ? f.getStatus() : Fact.Status.unknown,
                        complete(f, byCode, evidence) ? f.getConfidence() : BigDecimal.ZERO,
                        f.getValidUntil(),
                        f.getResolvedAt(),
                        f.getEvidenceIds().stream()
                            .map(evidenceId -> evidenceView(evidenceId, evidence.get(evidenceId), byCode, now))
                            .toList()))
            .toList();
    List<ConflictView> conflicts =
        queries.conflicts(id).stream()
            .map(
                c ->
                    new ConflictView(
                        c.getId(),
                        c.subject().characteristic(),
                        c.getEvidenceIds(),
                        c.getReason(),
                        c.getDetectedAt(),
                        c.getResolvedAt(),
                        c.getResolution()))
            .toList();
    return ResponseEntity.ok(new HotelKnowledge(id, views, conflicts));
  }

  private static boolean complete(Fact fact, Map<String, Characteristic> definitions,
      Map<String, Evidence> evidence) {
    return definitions.containsKey(fact.getCharacteristic())
        && fact.getEvidenceIds().stream().allMatch(evidence::containsKey);
  }

  private static EvidenceView evidenceView(
      String id, Evidence e, Map<String, Characteristic> definitions, Instant now) {
    if (e == null)
      return new EvidenceView(id, "unknown", null, null, null, null, null,
          "Запись доказательства отсутствует; требуется перепроверка.", null, null,
          false, false, false, false);
    Characteristic definition = definitions.get(e.getCharacteristic());
    boolean expired = e.getExpiresAt() != null ? !e.getExpiresAt().isAfter(now)
        : definition != null && !Resolution.expiry(e, definition.getTtlDays()).isAfter(now);
    return new EvidenceView(e.getId(), e.getMethod(), e.getSourceName(), e.getSourceUrl(),
        e.getQuote(), e.getValue(), e.getConfidenceLevel(),
        definition == null ? "Определение характеристики отсутствует; требуется перепроверка." : e.getConfidenceReason(),
        e.getObtainedAt(), e.getExpiresAt(), e.isDemo(), e.isSimulated(),
        definition != null && EvidencePolicy.admissible(e, now, false), expired);
  }

  /** Принудительный пересчёт фактов (обычно идёт сам после импорта и по расписанию). */
  @PostMapping("/knowledge/resolve")
  public FactResolver.Summary resolve() {
    guard.requireEnabled();
    return resolver.resolveAll();
  }
}
