package ru.opodoydet.server.host;

import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Диалог с отельером.
 *
 * <ul>
 *   <li>{@code POST /api/v2/questions/plan} — агент находит пробелы и формирует вопросы;
 *   <li>{@code GET /api/v2/questions} — очередь вопросов по ценности информации;
 *   <li>{@code POST /api/v2/questions/{id}/answer} — свободный ответ отельера → факты;
 *   <li>{@code POST /api/v2/host/{hotelId}/simulate} — имитированный отельер отвечает на открытые
 *       вопросы своего отеля (демо).
 * </ul>
 *
 * Экспериментальный поток доступен только для вымышленных объектов в LAB_MODE.
 * Реальные кабинеты используют отдельные авторизованные /api/host и /api/account методы.
 */
@RestController
@RequestMapping("/api/v2")
public class HostDialogController {

  public record PlanResult(int created, List<HostQuestion> questions) {}

  public record AnswerRequest(String text) {}

  private final QuestionPlanner planner;
  private final HostDialogService dialog;
  private final SimulatedHotelier simulator;

  HostDialogController(QuestionPlanner planner, HostDialogService dialog, SimulatedHotelier simulator) {
    this.planner = planner;
    this.dialog = dialog;
    this.simulator = simulator;
  }

  @PostMapping("/questions/plan")
  public PlanResult plan(
      @RequestParam(required = false) String hotelId,
      @RequestParam(defaultValue = "20") int limit) {
    if (limit < 1 || limit > 500) throw new IllegalArgumentException("limit от 1 до 500");
    List<HostQuestion> created = planner.plan(hotelId, limit);
    return new PlanResult(created.size(), created);
  }

  @GetMapping("/questions")
  public List<HostQuestion> queue(
      @RequestParam(required = false) String hotelId,
      @RequestParam(defaultValue = "open") List<HostQuestion.Status> status) {
    return dialog.queue(hotelId, status);
  }

  @GetMapping("/questions/{id}")
  public HostQuestion question(@PathVariable UUID id) {
    return dialog.question(id);
  }

  @PostMapping("/questions/{id}/answer")
  public HostDialogService.AnswerResult answer(
      @PathVariable UUID id, @RequestBody AnswerRequest request) {
    return dialog.answer(id, request.text(), "cabinet");
  }

  @PostMapping("/host/{hotelId}/simulate")
  public SimulatedHotelier.Round simulate(@PathVariable String hotelId) {
    return simulator.answerOpenQuestions(hotelId);
  }
}
