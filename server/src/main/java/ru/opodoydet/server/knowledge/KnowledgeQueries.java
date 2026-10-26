package ru.opodoydet.server.knowledge;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Публичный вход в модуль знаний: остальные модули не трогают репозитории напрямую. */
@Service
@Transactional(readOnly = true)
public class KnowledgeQueries {

  private final EvidenceRepository evidence;
  private final FactRepository facts;
  private final ConflictRepository conflicts;
  private final CharacteristicRepository characteristics;

  KnowledgeQueries(
      EvidenceRepository evidence,
      FactRepository facts,
      ConflictRepository conflicts,
      CharacteristicRepository characteristics) {
    this.evidence = evidence;
    this.facts = facts;
    this.conflicts = conflicts;
    this.characteristics = characteristics;
  }

  /** Доказательства, которые старый API отдавал как {@code facts}, в том же порядке. */
  public List<Evidence> legacyFacts(String hotelId, Instant now, boolean demoPolicy) {
    return evidence.findActiveByHotel(hotelId).stream()
        .filter(e -> EvidencePolicy.legacyAdmissible(e, now, demoPolicy))
        .toList();
  }

  /** Пробелы в знаниях: факты, которые неизвестны, устарели или противоречивы. */
  public List<Fact> gaps(String hotelIdOrNull) {
    return facts.findAll().stream()
        .filter(f -> hotelIdOrNull == null || f.getHotelId().equals(hotelIdOrNull))
        .filter(f -> f.getStatus() != Fact.Status.confirmed)
        .toList();
  }

  public java.util.Optional<Characteristic> characteristic(String code) {
    return characteristics.findById(code);
  }

  /** Все действующие доказательства по отелю в порядке появления — для оценки критериев поиска. */
  public Map<String, List<Evidence>> activeEvidenceByHotel() {
    return evidence.findActive().stream()
        .collect(Collectors.groupingBy(Evidence::getHotelId, java.util.LinkedHashMap::new, Collectors.toList()));
  }

  /** Уверенность итоговых фактов: hotelId → (roomId|"" + ":" + характеристика) → уверенность. */
  public Map<String, Map<String, java.math.BigDecimal>> confidenceByHotel() {
    Map<String, Map<String, java.math.BigDecimal>> result = new java.util.HashMap<>();
    for (Fact f : facts.findAll())
      result
          .computeIfAbsent(f.getHotelId(), k -> new java.util.HashMap<>())
          .put((f.getRoomId() == null ? "" : f.getRoomId()) + ":" + f.getCharacteristic(), f.getConfidence());
    return result;
  }

  public List<Fact> facts(String hotelId) {
    return facts.findByHotelIdOrderByRoomIdAscCharacteristicAsc(hotelId);
  }

  public Map<String, Evidence> evidenceById(Collection<String> ids) {
    return evidence.findAllById(ids).stream()
        .collect(Collectors.toMap(Evidence::getId, Function.identity()));
  }

  public List<Conflict> conflicts(String hotelId) {
    return conflicts.findByHotel(hotelId);
  }

  public List<Characteristic> characteristics() {
    return characteristics.findAll().stream()
        .sorted(java.util.Comparator.comparing(Characteristic::getCode))
        .toList();
  }
}
