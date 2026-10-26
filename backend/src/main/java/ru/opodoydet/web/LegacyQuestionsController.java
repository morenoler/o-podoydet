package ru.opodoydet.web;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.opodoydet.application.Agents;
import ru.opodoydet.application.Environment;
import ru.opodoydet.config.AppSettings;
import ru.opodoydet.domain.Features;
import ru.opodoydet.domain.Matching;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/** Demo-only question workflow. Account mode uses ownership-checked account endpoints instead. */
@RestController
public final class LegacyQuestionsController {
  private final Store store;
  private final Agents agents;
  private final Environment environment;
  private final AppSettings settings;

  public LegacyQuestionsController(
      Store store, Agents agents, Environment environment, AppSettings settings) {
    this.store = store;
    this.agents = agents;
    this.environment = environment;
    this.settings = settings;
  }

  @GetMapping("/api/questions")
  public List<JsonNode> questions() throws SQLException {
    requireDemo();
    return store.questions();
  }

  @PostMapping("/api/questions")
  public ObjectNode ask(HttpServletRequest request) throws SQLException, IOException {
    requireDemo();
    JsonNode input = RequestBodies.json(request);
    String hotelId = Validation.text(input, "hotelId", 1, 150),
        roomId = Validation.text(input, "roomId", 1, 150),
        feature = Validation.feature(input, "feature");
    JsonNode trip = Validation.trip(input.path("trip"), store.region);
    JsonNode hotel = store.hotel(hotelId), room = hotel == null ? null : Store.room(hotel, roomId);
    if (room == null) throw new ApiProblem(404, "Категория номера не найдена");
    Features.Definition definition = Features.get(feature);
    if (definition.tool().equals("area")) {
      JsonNode result =
          environment.evaluate(List.of(hotel), trip, Instant.now()).get(hotelId).get(feature);
      return Json.obj(
          "question",
          null,
          "message",
          Json.str(result, "explanation")
              + ". Условие проверяется по независимым источникам на даты поездки; ответ"
              + " отельера не заменяет эти данные.");
    }
    JsonNode criterion =
        Matching.evaluate(
            store.matchingFacts().stream()
                .filter(f -> Json.str(f, "hotelId").equals(hotelId))
                .toList(),
            Json.obj("feature", feature, "required", false),
            room,
            trip,
            Instant.now(),
            store.evidencePolicy());
    if (definition.tool().equals("route")) {
      return Json.obj(
          "question",
          null,
          "message",
          hotel.hasNonNull("route")
              ? "Маршрут рассчитан по сохранённой карте. Доступность всего пути требует"
                  + " обследования; отсутствие отметок не подтверждает отсутствие препятствий."
              : "Для этого отеля маршрут по сохранённой карте не найден. Геоданных"
                  + " недостаточно; расстояние и доступность пути остаются неизвестными.");
    }
    JsonNode question =
        store.ask(
            Json.obj(
                "hotelId",
                hotelId,
                "roomId",
                roomId,
                "feature",
                feature,
                "text",
                Json.str(room, "name") + ": " + definition.question(),
                "trace",
                List.of(
                    Json.obj(
                        "step",
                        "Проверка базы",
                        "detail",
                        "Состояние характеристики: " + Json.str(criterion, "status"),
                        "tool",
                        "facts.lookup"),
                    Json.obj(
                        "step",
                        "Выбор инструмента",
                        "detail",
                        "Для условий внутри номера геоданных недостаточно. Выбран вопрос отельеру.",
                        "tool",
                        "host.ask"),
                    Json.obj(
                        "step",
                        "Вопрос",
                        "detail",
                        "Привязан к конкретной категории. Повторный открытый вопрос не"
                            + " создаётся."))));
    return Json.obj(
        "question", question, "message", "Вопрос добавлен в демонстрационный кабинет отельера.");
  }

  @PostMapping("/api/questions/{id}/preview")
  public ObjectNode preview(@PathVariable String id, HttpServletRequest request)
      throws SQLException, IOException {
    requireDemo();
    JsonNode input = RequestBodies.json(request);
    String text = Validation.text(input, "text", 3, 1500).trim();
    if (text.length() < 3) throw new IllegalArgumentException("Ответ слишком короткий");
    JsonNode question = store.question(id);
    if (question == null || !Json.str(question, "status").equals("open"))
      throw new ApiProblem(404, "Открытый вопрос не найден");
    ObjectNode draft = agents.extract(text, Json.str(question, "feature"));
    draft.put("id", UUID.randomUUID().toString()).put("questionId", id).put("text", text);
    JsonNode latest = store.question(id);
    if (latest == null || !Json.str(latest, "createdAt").equals(Json.str(question, "createdAt")))
      throw new ApiProblem(409, "Вопрос был обновлён во время разбора. Откройте его заново.");
    store.saveDraft(draft, Json.str(question, "createdAt"));
    return draft;
  }

  @PostMapping("/api/drafts/{id}/confirm")
  public ObjectNode confirm(@PathVariable String id, HttpServletRequest request)
      throws SQLException, IOException {
    requireDemo();
    return Json.obj(
        "facts",
        store.confirm(id, Validation.bool(RequestBodies.json(request), "resolveConflict")));
  }

  @RequestMapping({"/api/questions/**", "/api/drafts/**"})
  public Object unavailable() {
    requireDemo();
    throw new ApiProblem(404, "Метод не найден");
  }

  private void requireDemo() {
    if (settings.enabled("ACCOUNT_MODE", true))
      throw new ApiProblem(
          403, "Ответы принимаются только по вашим объявлениям в личном кабинете.");
  }
}
