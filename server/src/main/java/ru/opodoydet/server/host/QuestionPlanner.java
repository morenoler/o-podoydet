package ru.opodoydet.server.host;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.opodoydet.server.knowledge.Characteristic;
import ru.opodoydet.server.knowledge.Evidence;
import ru.opodoydet.server.knowledge.Fact;
import ru.opodoydet.server.knowledge.KnowledgeQueries;
import ru.opodoydet.server.knowledge.Subject;

/**
 * Агент-планировщик: находит пробелы в знаниях и решает, о чём спросить отельера.
 *
 * <p>Спрашиваем только то, что отельер действительно знает лучше открытых данных (инструменты
 * {@code host} и {@code route}); экологию района и статистику безопасности у него не спрашиваем.
 *
 * <p>Ценность информации (v1) = неопределённость × срочность × спрос:
 *
 * <ul>
 *   <li>неопределённость — {@code 1 − confidence} факта;
 *   <li>срочность — противоречие 1.0, неизвестно 0.8, устарело 0.6;
 *   <li>спрос — {@code spec.demand} характеристики (по умолчанию 1.0). Следующий шаг — считать его
 *       по реальным поисковым запросам.
 * </ul>
 */
@Service
public class QuestionPlanner {

  static final Set<String> ASKABLE_TOOLS = Set.of("host", "route");
  static final Map<Fact.Status, Double> URGENCY =
      Map.of(Fact.Status.conflict, 1.0, Fact.Status.unknown, 0.8, Fact.Status.stale, 0.6);
  private static final DateTimeFormatter DATE =
      DateTimeFormatter.ofPattern("dd.MM.yyyy").withZone(ZoneOffset.UTC);

  private final KnowledgeQueries knowledge;
  private final HostQuestionRepository questions;
  private final JdbcClient jdbc;
  private final Clock clock;
  private final java.time.Duration reaskAfter;

  QuestionPlanner(
      KnowledgeQueries knowledge,
      HostQuestionRepository questions,
      JdbcClient jdbc,
      Clock clock,
      @org.springframework.beans.factory.annotation.Value("${host.reask-after:PT24H}")
          java.time.Duration reaskAfter) {
    this.knowledge = knowledge;
    this.questions = questions;
    this.jdbc = jdbc;
    this.clock = clock;
    this.reaskAfter = reaskAfter;
  }

  /** Создаёт вопросы по самым ценным пробелам. Уже открытые вопросы не дублируются. */
  @Transactional
  public List<HostQuestion> plan(String hotelIdOrNull, int limit) {
    return create(knowledge.gaps(hotelIdOrNull), limit);
  }

  /** Вопросы именно по этим предметам — например, уточнение после найденного противоречия. */
  @Transactional
  public List<HostQuestion> planFor(Set<Subject> subjects) {
    List<Fact> gaps =
        subjects.stream()
            .flatMap(s -> knowledge.gaps(s.hotelId()).stream())
            .filter(f -> subjects.contains(f.subject()))
            .toList();
    return create(gaps, Integer.MAX_VALUE);
  }

  private List<HostQuestion> create(List<Fact> gaps, int limit) {
    Instant now = clock.instant();
    Set<Subject> alreadyOpen = new HashSet<>();
    for (HostQuestion q : questions.findQueue(List.of(HostQuestion.Status.open), null))
      alreadyOpen.add(q.subject());
    // Не переспрашиваем то, на что отельер только что ответил уклончиво, — кроме противоречий.
    Set<Subject> recentlyAsked = new HashSet<>();
    for (HostQuestion q : questions.findQueue(List.of(HostQuestion.Status.unresolved), null))
      if (q.getAnsweredAt() != null && q.getAnsweredAt().isAfter(now.minus(reaskAfter)))
        recentlyAsked.add(q.subject());

    record Candidate(Fact fact, Characteristic characteristic, double priority) {}
    List<Candidate> candidates = new ArrayList<>();
    for (Fact fact : gaps) {
      if (alreadyOpen.contains(fact.subject())) continue;
      if (fact.getStatus() != Fact.Status.conflict && recentlyAsked.contains(fact.subject())) continue;
      Characteristic c = knowledge.characteristic(fact.getCharacteristic()).orElse(null);
      if (c == null || !ASKABLE_TOOLS.contains(c.getTool())) continue;
      double demand = c.getSpec().path("demand").asDouble(1.0);
      double priority =
          (1 - fact.getConfidence().doubleValue())
              * URGENCY.getOrDefault(fact.getStatus(), 0.5)
              * demand;
      candidates.add(new Candidate(fact, c, Math.min(1.0, priority)));
    }
    candidates.sort(Comparator.comparingDouble(Candidate::priority).reversed());

    List<HostQuestion> created = new ArrayList<>();
    for (Candidate candidate : candidates.subList(0, Math.min(limit, candidates.size()))) {
      Fact fact = candidate.fact();
      HostQuestion question =
          new HostQuestion(
              fact.subject(),
              text(fact, candidate.characteristic()),
              "Факт «" + candidate.characteristic().getLabel() + "»: " + fact.getStatus()
                  + ", уверенность " + fact.getConfidence()
                  + ", доказательства " + fact.getEvidenceIds(),
              fact.getStatus().name(),
              candidate.priority(),
              now);
      created.add(questions.save(question));
    }
    return created;
  }

  /** Вопрос с контекстом: отельер видит, что мы уже знаем и почему спрашиваем. */
  String text(Fact fact, Characteristic c) {
    StringBuilder text = new StringBuilder();
    if (fact.getRoomId() != null) {
      String room =
          jdbc.sql("SELECT name FROM room WHERE hotel_id = ? AND id = ?")
              .params(fact.getHotelId(), fact.getRoomId())
              .query(String.class)
              .optional()
              .orElse(fact.getRoomId());
      text.append("Категория «").append(room).append("». ");
    }
    Map<String, Evidence> evidence = knowledge.evidenceById(fact.getEvidenceIds());
    switch (fact.getStatus()) {
      case conflict -> {
        text.append("Источники расходятся: ");
        List<String> parts = new ArrayList<>();
        for (String id : fact.getEvidenceIds()) {
          Evidence e = evidence.get(id);
          if (e != null && e.getValue() != null)
            parts.add(source(e) + " — " + format(e.getValue(), c));
        }
        text.append(String.join("; ", parts)).append(". Помогите уточнить. ");
      }
      case stale -> {
        Instant last =
            evidence.values().stream()
                .map(Evidence::getObtainedAt)
                .filter(java.util.Objects::nonNull)
                .max(Comparator.naturalOrder())
                .orElse(null);
        if (last != null)
          text.append("Наши сведения от ").append(DATE.format(last)).append(" устарели. ");
      }
      default -> {
        evidence.values().stream()
            .map(Evidence::getQuote)
            .filter(q -> q != null && !q.isBlank())
            .findFirst()
            .ifPresent(q -> text.append("Сейчас известно: «").append(firstSentence(q)).append("». "));
      }
    }
    text.append(c.getQuestion() == null ? "Расскажите, пожалуйста, подробнее: " + c.getLabel() : c.getQuestion());
    return text.toString();
  }

  private static String source(Evidence e) {
    if ("host".equals(e.getMethod())) return "ответ отеля";
    if ("geo".equals(e.getMethod())) return "расчёт по карте";
    if ("official".equals(e.getMethod())) return "официальный сайт";
    return e.getSourceName() == null ? e.getMethod() : e.getSourceName();
  }

  static String format(JsonNode value, Characteristic c) {
    if ("meters".equals(c.getValueType()) && value.isNumber()) return value.asLong() + " м";
    if (value.isBoolean()) return value.asBoolean() ? "да" : "нет";
    return value.asText();
  }

  static String firstSentence(String quote) {
    String first = quote.split("(?<=[.!?])\\s+", 2)[0].trim().replaceAll("[.!?]+$", "");
    return first.length() > 160 ? first.substring(0, 157) + "…" : first;
  }
}
