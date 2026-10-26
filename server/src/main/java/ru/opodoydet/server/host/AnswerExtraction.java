package ru.opodoydet.server.host;

import java.util.List;
import org.springframework.stereotype.Component;
import ru.opodoydet.server.knowledge.Characteristic;

/**
 * Выбор способа разбора: LLM, если настроена и что-то нашла; иначе правила. Так система
 * одинаково работает и с ключом, и без него — нужно для жюри.
 */
@Component
public class AnswerExtraction {

  public record Result(String extractor, List<AnswerExtractor.Extraction> extractions) {}

  private final LlmAnswerExtractor llm;
  private final RuleBasedAnswerExtractor rules;

  AnswerExtraction(LlmAnswerExtractor llm, RuleBasedAnswerExtractor rules) {
    this.llm = llm;
    this.rules = rules;
  }

  public Result extract(String answer, List<Characteristic> candidates) {
    if (llm.enabled()) {
      List<AnswerExtractor.Extraction> found = llm.extract(answer, candidates);
      if (!found.isEmpty()) return new Result(llm.name(), found);
    }
    return new Result(rules.name(), rules.extract(answer, candidates));
  }
}
