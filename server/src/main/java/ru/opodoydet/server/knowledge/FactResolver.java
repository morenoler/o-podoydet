package ru.opodoydet.server.knowledge;

import java.time.Clock;
import java.time.Instant;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Пересчитывает факты из доказательств и ведёт журнал противоречий.
 *
 * <p>Запускается после импорта и по расписанию: так факты сами переходят в {@code stale}, когда
 * у источников истекает срок, — это основа будущей актуализации.
 */
@Service
public class FactResolver {

  public record Summary(Map<Fact.Status, Integer> facts, int conflictsOpened, int conflictsClosed) {}

  private static final Logger log = LoggerFactory.getLogger(FactResolver.class);

  private final EvidenceRepository evidence;
  private final FactRepository facts;
  private final ConflictRepository conflicts;
  private final CharacteristicRepository characteristics;
  private final JdbcClient jdbc;
  private final Clock clock;

  FactResolver(
      EvidenceRepository evidence,
      FactRepository facts,
      ConflictRepository conflicts,
      CharacteristicRepository characteristics,
      JdbcClient jdbc,
      Clock clock) {
    this.evidence = evidence;
    this.facts = facts;
    this.conflicts = conflicts;
    this.characteristics = characteristics;
    this.jdbc = jdbc;
    this.clock = clock;
  }

  @Scheduled(
      initialDelayString = "${knowledge.resolve-interval:PT1H}",
      fixedDelayString = "${knowledge.resolve-interval:PT1H}")
  public void scheduled() {
    Summary summary = resolveAll();
    log.info("Пересчёт фактов по расписанию: {}", summary);
  }

  /** Текущий факт по предмету (после пересчёта). */
  @Transactional(readOnly = true)
  public java.util.Optional<Fact> fact(Subject subject) {
    return facts.findByHotelIdOrderByRoomIdAscCharacteristicAsc(subject.hotelId()).stream()
        .filter(f -> f.subject().equals(subject))
        .findFirst();
  }

  @Transactional
  public Summary resolveAll() {
    Instant now = clock.instant();
    boolean demoPolicy = demoPolicy();
    Map<String, Double> priors = priors();
    Map<String, Characteristic> byCode =
        characteristics.findAll().stream()
            .collect(Collectors.toMap(Characteristic::getCode, Function.identity()));

    Map<Subject, List<Evidence>> grouped =
        evidence.findActive().stream()
            .collect(Collectors.groupingBy(Subject::of, LinkedHashMap::new, Collectors.toList()));
    Map<Subject, Fact> existing = new HashMap<>();
    for (Fact fact : facts.findAll()) existing.put(fact.subject(), fact);
    Map<Subject, Conflict> open = new HashMap<>();
    for (Conflict conflict : conflicts.findOpen()) open.put(conflict.subject(), conflict);

    Map<Fact.Status, Integer> counts = new EnumMap<>(Fact.Status.class);
    int opened = 0, closed = 0;

    for (var entry : grouped.entrySet()) {
      Subject subject = entry.getKey();
      Characteristic characteristic = byCode.get(subject.characteristic());
      Resolution.Outcome outcome =
          Resolution.compute(
              entry.getValue(),
              characteristic.getTtlDays(),
              characteristic.getValueType(),
              priors,
              now,
              demoPolicy);

      Fact fact = existing.remove(subject);
      if (fact == null) fact = new Fact(subject);
      fact.update(
          outcome.value(),
          outcome.status(),
          outcome.confidence(),
          outcome.evidenceIds(),
          outcome.validUntil(),
          now);
      facts.save(fact);
      counts.merge(outcome.status(), 1, Integer::sum);

      Conflict current = open.remove(subject);
      if (outcome.status() == Fact.Status.conflict) {
        if (current != null && current.sameEvidence(outcome.evidenceIds())) continue;
        if (current != null) {
          current.close("Пересчитано: изменился набор доказательств", now);
          closed++;
        }
        conflicts.save(new Conflict(subject, outcome.evidenceIds(), outcome.conflictReason(), now));
        opened++;
      } else if (current != null) {
        current.close("Противоречие снято: источники больше не расходятся", now);
        closed++;
      }
    }
    // Доказательств по предмету не осталось — факт тоже исчезает, противоречие закрывается.
    facts.deleteAll(existing.values());
    for (Conflict orphan : open.values()) {
      orphan.close("Доказательства удалены или деактивированы", now);
      closed++;
    }
    return new Summary(counts, opened, closed);
  }

  private boolean demoPolicy() {
    return jdbc.sql("SELECT count(*) FROM dataset WHERE evidence_policy = 'demo'")
            .query(Long.class)
            .single()
        > 0;
  }

  private Map<String, Double> priors() {
    return jdbc.sql("SELECT method, prior_trust FROM source_method")
        .query((rs, i) -> Map.entry(rs.getString(1), rs.getDouble(2)))
        .list()
        .stream()
        .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
  }
}
