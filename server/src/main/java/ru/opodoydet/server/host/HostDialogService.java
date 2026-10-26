package ru.opodoydet.server.host;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import ru.opodoydet.server.knowledge.Characteristic;
import ru.opodoydet.server.knowledge.Fact;
import ru.opodoydet.server.knowledge.FactResolver;
import ru.opodoydet.server.knowledge.KnowledgeCommands;
import ru.opodoydet.server.knowledge.KnowledgeCommands.HostStatement;
import ru.opodoydet.server.knowledge.KnowledgeQueries;
import ru.opodoydet.server.knowledge.Subject;
import ru.opodoydet.server.web.NotFoundException;

/**
 * Принимает свободный ответ отельера и доводит его до знаний:
 *
 * <ol>
 *   <li>раскладывает ответ по характеристикам (LLM или правила) — один ответ может закрыть
 *       сразу несколько пробелов;
 *   <li>сохраняет каждое утверждение как доказательство с методом host и дословной цитатой;
 *   <li>пересчитывает факты: что подтвердилось, где возникло противоречие;
 *   <li>закрывает вопросы, на которые ответ пришёл попутно, и задаёт уточняющие вопросы по
 *       противоречиям — так система «разбирается», а не просто фиксирует расхождение.
 * </ol>
 */
@Service
public class HostDialogService {

  public record FactState(JsonNode value, Fact.Status status, BigDecimal confidence) {}

  public record Change(
      String characteristic,
      String roomId,
      JsonNode extracted,
      String quote,
      String confidenceLevel,
      String evidenceId,
      FactState before,
      FactState after) {}

  public record AnswerResult(
      HostQuestion question,
      String extractor,
      List<Change> changes,
      List<HostQuestion> closedAlongTheWay,
      List<HostQuestion> followUps) {}

  private final HostQuestionRepository questions;
  private final AnswerExtraction extraction;
  private final KnowledgeQueries knowledge;
  private final KnowledgeCommands commands;
  private final FactResolver resolver;
  private final QuestionPlanner planner;
  private final TransactionTemplate tx;
  private final Clock clock;
  private final DemoHostGuard guard;

  HostDialogService(
      HostQuestionRepository questions,
      AnswerExtraction extraction,
      KnowledgeQueries knowledge,
      KnowledgeCommands commands,
      FactResolver resolver,
      QuestionPlanner planner,
      TransactionTemplate tx,
      Clock clock,
      DemoHostGuard guard) {
    this.questions = questions;
    this.extraction = extraction;
    this.knowledge = knowledge;
    this.commands = commands;
    this.resolver = resolver;
    this.planner = planner;
    this.tx = tx;
    this.clock = clock;
    this.guard = guard;
  }

  public HostQuestion question(UUID id) {
    guard.requireEnabled();
    HostQuestion question = questions.findById(id).orElseThrow(() -> new NotFoundException("Вопрос не найден"));
    guard.requireHotel(question.getHotelId());
    return question;
  }

  public List<HostQuestion> queue(String hotelIdOrNull, List<HostQuestion.Status> statuses) {
    guard.requireHotel(hotelIdOrNull);
    Set<String> allowed = guard.allowedHotels();
    return questions.findQueue(statuses, hotelIdOrNull).stream().filter(q -> allowed.contains(q.getHotelId())).toList();
  }

  public AnswerResult answer(UUID id, String text, String channel) {
    HostQuestion question = question(id);
    if (!question.acceptsAnswer())
      throw new IllegalArgumentException("На этот вопрос уже ответили или он закрыт");
    String answer = text == null ? "" : text.strip();
    if (answer.length() < 2 || answer.length() > 2000)
      throw new IllegalArgumentException("Ответ должен быть от 2 до 2000 символов");
    boolean simulated = "simulated".equals(channel);

    // 1. Разбор: о чём в принципе может идти речь в ответе на этот вопрос.
    List<Characteristic> candidates = candidates(question);
    AnswerExtraction.Result result = extraction.extract(answer, candidates);
    Map<String, Characteristic> byCode = new LinkedHashMap<>();
    candidates.forEach(c -> byCode.put(c.getCode(), c));

    // 2. Сохраняем утверждения и отмечаем вопрос (одна транзакция).
    record Pending(AnswerExtractor.Extraction extraction, Subject subject, FactState before, String evidenceId) {}
    List<Pending> pending = new ArrayList<>();
    tx.executeWithoutResult(
        status -> {
          HostQuestion current = questions.locked(id).orElseThrow(() -> new NotFoundException("Вопрос не найден"));
          if (!current.acceptsAnswer()) throw new IllegalArgumentException("Вопрос закрыт");
          boolean askedFound = false;
          for (AnswerExtractor.Extraction e : result.extractions()) {
            Characteristic c = byCode.get(e.characteristic());
            Subject subject =
                new Subject(
                    question.getHotelId(),
                    "room".equals(c.getScope()) ? question.getRoomId() : null,
                    c.getCode());
            FactState before = state(subject);
            String evidenceId =
                commands.recordHostStatement(
                    new HostStatement(
                        subject.hotelId(),
                        subject.roomId(),
                        subject.characteristic(),
                        e.value(),
                        e.quote(),
                        e.confidenceLevel(),
                        "Ответ отельера, разбор: " + result.extractor(),
                        simulated ? "Имитированный отельер (демо)" : "Ответ отельера в кабинете",
                        simulated,
                        question.getId()));
            pending.add(new Pending(e, subject, before, evidenceId));
            askedFound |= subject.equals(question.subject());
          }
          question.answer(
              askedFound ? HostQuestion.Status.answered : HostQuestion.Status.unresolved,
              answer,
              channel,
              result.extractor(),
              clock.instant());
          questions.save(question);
        });

    // 3. Пересчёт фактов (отдельная транзакция, чтобы видеть свежие доказательства).
    resolver.resolveAll();

    // 4. Итог по каждому затронутому предмету.
    List<Change> changes = new ArrayList<>();
    Set<Subject> conflicts = new LinkedHashSet<>();
    for (Pending p : pending) {
      FactState after = state(p.subject());
      if (after != null && after.status() == Fact.Status.conflict) conflicts.add(p.subject());
      changes.add(
          new Change(
              p.subject().characteristic(),
              p.subject().roomId(),
              p.extraction().value(),
              p.extraction().quote(),
              p.extraction().confidenceLevel(),
              p.evidenceId(),
              p.before(),
              after));
    }

    // 5. Вопросы, на которые ответ пришёл попутно, больше не нужны.
    List<HostQuestion> closed = new ArrayList<>();
    Instant now = clock.instant();
    for (HostQuestion open : questions.findQueue(List.of(HostQuestion.Status.open), question.getHotelId())) {
      FactState state = state(open.subject());
      if (state != null && state.status() == Fact.Status.confirmed) {
        open.cancel("Закрыт: факт подтвердился из ответа на другой вопрос", now);
        closed.add(questions.save(open));
      }
    }

    // 6. Противоречия — повод переспросить, а не молча выбрать сторону.
    List<HostQuestion> followUps = conflicts.isEmpty() ? List.of() : planner.planFor(conflicts);
    return new AnswerResult(question, result.extractor(), changes, closed, followUps);
  }

  private List<Characteristic> candidates(HostQuestion question) {
    return knowledge.characteristics().stream()
        .filter(c -> QuestionPlanner.ASKABLE_TOOLS.contains(c.getTool()))
        .filter(c -> "hotel".equals(c.getScope()) || question.getRoomId() != null)
        .toList();
  }

  private FactState state(Subject subject) {
    return resolver
        .fact(subject)
        .map(f -> new FactState(f.getValue(), f.getStatus(), f.getConfidence()))
        .orElse(null);
  }
}
