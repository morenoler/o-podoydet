package ru.opodoydet.server.host;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Имитированный отельер для демо (ТЗ это разрешает). Отвечает свободным текстом по сценарию из
 * {@code knowledge/simulated-hosts.json}; дальше ответ проходит тот же путь, что и настоящий:
 * разбор → доказательства → пересчёт фактов. Такие доказательства помечены {@code simulated}.
 *
 * <p>Отвечает только на вопросы, открытые в момент вызова. Уточняющие вопросы, которые появятся
 * по ходу (например, из-за противоречия), ждут следующего вызова — так на демо видно, как
 * система сначала замечает расхождение, а потом разбирается в нём.
 */
@Component
public class SimulatedHotelier {

  public record Round(String hotelId, String persona, int planned, List<HostDialogService.AnswerResult> answers) {}

  private final HostDialogService dialog;
  private final QuestionPlanner planner;
  private final JsonNode script;

  SimulatedHotelier(HostDialogService dialog, QuestionPlanner planner, ObjectMapper json) {
    this.dialog = dialog;
    this.planner = planner;
    try (InputStream input = getClass().getResourceAsStream("/knowledge/simulated-hosts.json")) {
      this.script = json.readTree(input);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  public Round answerOpenQuestions(String hotelId) {
    int planned = planner.plan(hotelId, 50).size();
    List<HostDialogService.AnswerResult> answers = new ArrayList<>();
    List<HostQuestion> open = dialog.queue(hotelId, List.of(HostQuestion.Status.open));
    for (HostQuestion question : open) {
      // Ответ на предыдущий вопрос мог попутно закрыть этот.
      if (dialog.question(question.getId()).getStatus() != HostQuestion.Status.open) continue;
      answers.add(dialog.answer(question.getId(), answerFor(question), "simulated"));
    }
    String persona = script.path("hotels").path(hotelId).path("persona").asText("Без сценария: отельер отвечает «уточню у коллег»");
    return new Round(hotelId, persona, planned, answers);
  }

  String answerFor(HostQuestion question) {
    JsonNode hotel = script.path("hotels").path(question.getHotelId());
    JsonNode room = hotel.path("rooms").path(question.getRoomId() == null ? "" : question.getRoomId());
    for (JsonNode candidate :
        List.of(room.path(question.getCharacteristic()), hotel.path("answers").path(question.getCharacteristic())))
      if (candidate.isTextual()) return candidate.asText();
    return script.path("default").asText("Уточню и вернусь с ответом.");
  }
}
