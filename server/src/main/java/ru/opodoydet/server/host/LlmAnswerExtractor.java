package ru.opodoydet.server.host;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;
import ru.opodoydet.server.knowledge.Characteristic;
import ru.opodoydet.server.llm.LlmClient;
import ru.opodoydet.shared.Json;

/**
 * Разбор ответа через LLM. Модель не «угадывает» факты об отеле — она только переводит
 * слова отельера в поля, и каждое поле обязано опираться на дословную цитату из ответа.
 * Всё, что не прошло проверку {@link AnswerExtractor#valid}, отбрасывается.
 */
@Component
public class LlmAnswerExtractor implements AnswerExtractor {

  private static final Set<String> LEVELS = Set.of("low", "medium", "high");

  static final String SYSTEM =
      """
      Ты разбираешь ответ отельера на вопросы о характеристиках отеля.
      Извлекай только то, что отельер прямо утверждает. Не додумывай и не используй общие знания.
      Для каждого утверждения верни:
        characteristic — код из списка;
        value — true/false для типа boolean или целое число метров для типа meters;
        quote — ДОСЛОВНЫЙ фрагмент ответа, на котором основано утверждение;
        certainty — high (сказано определённо), medium (обычная формулировка) или low (есть «кажется», «вроде», оценка на глаз).
      Если характеристика не упомянута или ответ неоднозначен — не включай её.
      Ответ строго в JSON: {"extractions":[{"characteristic":"...","value":...,"quote":"...","certainty":"..."}]}
      """;

  private final LlmClient llm;

  LlmAnswerExtractor(LlmClient llm) {
    this.llm = llm;
  }

  @Override
  public String name() {
    return "llm:" + llm.model();
  }

  boolean enabled() {
    return llm.enabled();
  }

  @Override
  public List<Extraction> extract(String answer, List<Characteristic> candidates) {
    if (candidates.isEmpty()) return List.of();
    StringBuilder user = new StringBuilder("Характеристики:\n");
    for (Characteristic c : candidates)
      user.append("- ")
          .append(c.getCode())
          .append(" (")
          .append(c.getValueType())
          .append("): ")
          .append(c.getLabel())
          .append(c.getQuestion() == null ? "" : ". Вопрос: " + c.getQuestion())
          .append('\n');
    user.append("\nОтвет отельера:\n").append(answer);

    List<Extraction> result = new ArrayList<>();
    for (JsonNode item :
        llm.completeJson(SYSTEM, user.toString(), schema(candidates))
            .map(r -> r.path("extractions"))
            .orElse(com.fasterxml.jackson.databind.node.MissingNode.getInstance())) {
      String level = item.path("certainty").asText("medium");
      JsonNode value = item.path("value");
      if (value.isNumber()) value = com.fasterxml.jackson.databind.node.LongNode.valueOf(value.asLong());
      Extraction e =
          new Extraction(
              item.path("characteristic").asText(""),
              value,
              item.path("quote").asText(""),
              LEVELS.contains(level) ? level : "medium");
      if (AnswerExtractor.valid(e, answer, candidates)
          && result.stream().noneMatch(r -> r.characteristic().equals(e.characteristic())))
        result.add(e);
    }
    return result;
  }

  private static JsonNode schema(List<Characteristic> candidates) {
    JsonNode item = Json.obj("type", "object", "additionalProperties", false,
        "properties", Json.obj(
            "characteristic", Json.obj("type", "string", "enum", candidates.stream().map(Characteristic::getCode).toList()),
            "value", Json.obj("anyOf", List.of(Json.obj("type", "boolean"), Json.obj("type", "integer"))),
            "quote", Json.obj("type", "string"),
            "certainty", Json.obj("type", "string", "enum", List.of("low", "medium", "high"))),
        "required", List.of("characteristic", "value", "quote", "certainty"));
    return Json.obj("type", "object", "additionalProperties", false,
        "properties", Json.obj("extractions", Json.obj("type", "array", "maxItems", candidates.size(), "items", item)),
        "required", List.of("extractions"));
  }
}
