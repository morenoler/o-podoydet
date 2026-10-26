package ru.opodoydet.server.host;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import ru.opodoydet.server.knowledge.Characteristic;

/** Раскладывает свободный ответ отельера по характеристикам. */
public interface AnswerExtractor {

  /**
   * Одно извлечённое утверждение.
   *
   * @param quote дословный фрагмент ответа — без него утверждение не принимается
   * @param confidenceLevel low | medium | high: насколько уверенно сформулировано
   */
  record Extraction(String characteristic, JsonNode value, String quote, String confidenceLevel) {}

  String name();

  /**
   * @param candidates характеристики, о которых в принципе может идти речь в этом ответе
   */
  List<Extraction> extract(String answer, List<Characteristic> candidates);

  /** Общая защита от выдумок: цитата дословно есть в ответе, тип значения совпадает. */
  static boolean valid(Extraction e, String answer, List<Characteristic> candidates) {
    if (e.quote() == null || e.quote().isBlank() || !answer.contains(e.quote())) return false;
    if (e.value() == null || e.value().isNull()) return false;
    return candidates.stream()
        .filter(c -> c.getCode().equals(e.characteristic()))
        .anyMatch(
            c ->
                switch (c.getValueType()) {
                  case "boolean" -> e.value().isBoolean();
                  case "meters" -> e.value().isNumber() && e.value().asDouble() >= 0;
                  default -> false;
                });
  }
}
