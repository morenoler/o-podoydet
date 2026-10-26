package ru.opodoydet.server.host;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.LongNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import ru.opodoydet.server.knowledge.Characteristic;

/**
 * Разбор ответа без LLM: работает всегда, в том числе у жюри без ключа.
 *
 * <p>Ответ режется на фразы (по точкам, точкам с запятой, запятым и союзам «а»/«но»); каждая
 * фраза проверяется отдельно, поэтому «во двор окон нет, а до лифта без ступеней» даёт два
 * разных факта. Цитата — всегда дословный фрагмент ответа. Если в ответе есть и «да», и «нет» по
 * одной характеристике, она пропускается: лучше переспросить, чем ошибиться.
 */
@Component
public class RuleBasedAnswerExtractor implements AnswerExtractor {

  private static final int FLAGS =
      Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE | Pattern.UNICODE_CHARACTER_CLASS;

  private static Pattern p(String regex) {
    return Pattern.compile(regex, FLAGS);
  }

  /** Фраза про дорогу к пляжу, а не про здание. */
  private static final Pattern BEACH = p("пляж|мор[еяю]|набережн|beach");

  private static final Pattern HEDGE =
      p("кажется|вроде|наверное|по-моему|возможно|скорее всего|не уверен|если не ошибаюсь");

  private record Rule(Pattern negative, Pattern positive, Boolean beachContext) {}

  private static final Map<String, Rule> RULES = new LinkedHashMap<>();

  static {
    RULES.put(
        "courtyard",
        new Rule(
            p("во\\s+двор\\S*\\s+(окон\\s+)?(не|нет)|\\b(не|нет)\\b[^,.;]{0,25}во\\s+двор"
                + "|(окн\\S*|выход\\S*)[^,.;]{0,40}?\\s+на\\s+(улиц|дорог|проспект|океан|море|пляж|город|набережн)"),
            p("(во|на)\\s+(внутренн\\S+\\s+)?двор|courtyard"),
            null));
    RULES.put(
        "step_free_access",
        new Rule(
            p("\\d+\\s+ступен|(есть|несколько|пара|две|три|четыре)\\s+ступен|ступен\\S*\\s+(есть|на\\s+входе)"
                + "|нет\\s+лифта|без\\s+лифта|только\\s+по\\s+лестниц|нет\\s+пандус|пандус\\S*\\s+нет"),
            p("без\\s+(ступен|порог)|пандус|на\\s+одном\\s+уровне|доступ\\S*\\s+для\\s+(колясок|инвалидн)"
                + "|(проехать|пройти|заехать)\\s+с\\s+коляск"),
            false));
    RULES.put(
        "step_free_route",
        new Rule(
            p("лестниц\\S*\\s+(есть|вниз|вверх)|есть\\s+лестниц"
                + "|(спуск|спуст|подним|подъ[её]м)\\S*\\s+по\\s+(лестниц|ступен)"
                + "|\\d+\\s+ступен|(есть|несколько)\\s+ступен"),
            p("без\\s+(лестниц|ступен)|ровн\\S+\\s+(тротуар|дорог|путь|дорожк)|по\\s+ровн"),
            true));
    RULES.put(
        "family",
        new Rule(
            p("без\\s+детей|дет\\S*\\s+не\\s+(размещ|принима|засел)|не\\s+(размещ|принима|засел)\\S*\\s+(с\\s+)?дет"
                + "|только\\s+(для\\s+)?взросл|18\\+"),
            p("детск\\S+\\s+кроват|кроватк|с\\s+детьми\\s+(можно|размещ|подход|удобно)|семейн"
                + "|дет\\S*\\s+(размещ|принима)"),
            null));
  }

  private static final Pattern METERS = p("(\\d[\\d\\s]{0,6})\\s*(м\\b|метр)");
  private static final Pattern KILOMETERS = p("(\\d+(?:[.,]\\d+)?)\\s*км");
  private static final Pattern MINUTES = p("(\\d+)\\s*мин");
  /** Средняя скорость пешехода, м/мин — для ответов вида «5 минут пешком». */
  static final int METERS_PER_MINUTE = 80;

  @Override
  public String name() {
    return "rules";
  }

  @Override
  public List<Extraction> extract(String answer, List<Characteristic> candidates) {
    Set<String> wanted =
        Set.copyOf(candidates.stream().map(Characteristic::getCode).toList());
    Map<String, List<Extraction>> found = new LinkedHashMap<>();

    for (String sentence : sentences(answer)) {
     // Оговорка («кажется», «вроде») относится ко всему предложению, а не к одной фразе.
     String level = HEDGE.matcher(sentence).find() ? "low" : "medium";
     for (String clause : clauses(sentence)) {
      boolean beach = BEACH.matcher(clause).find();
      for (var rule : RULES.entrySet()) {
        if (!wanted.contains(rule.getKey())) continue;
        Rule r = rule.getValue();
        if (r.beachContext() != null && r.beachContext() != beach) continue;
        Boolean value =
            r.negative().matcher(clause).find()
                ? Boolean.FALSE
                : r.positive().matcher(clause).find() ? Boolean.TRUE : null;
        if (value != null)
          found
              .computeIfAbsent(rule.getKey(), k -> new ArrayList<>())
              .add(new Extraction(rule.getKey(), BooleanNode.valueOf(value), clause, level));
      }
      if (wanted.contains("beach_walk") && beach) {
        Extraction distance = distance(clause, level);
        if (distance != null)
          found.computeIfAbsent("beach_walk", k -> new ArrayList<>()).add(distance);
      }
     }
    }

    List<Extraction> result = new ArrayList<>();
    for (List<Extraction> options : found.values()) {
      boolean consistent =
          options.stream().map(e -> e.value().toString()).distinct().count() == 1
              || options.getFirst().value().isNumber();
      if (consistent) result.add(options.getFirst());
    }
    return result.stream().filter(e -> AnswerExtractor.valid(e, answer, candidates)).toList();
  }

  private static Extraction distance(String clause, String level) {
    Matcher km = KILOMETERS.matcher(clause);
    if (km.find())
      return new Extraction(
          "beach_walk",
          LongNode.valueOf(Math.round(Double.parseDouble(km.group(1).replace(',', '.')) * 1000)),
          clause,
          level);
    Matcher m = METERS.matcher(clause);
    if (m.find())
      return new Extraction(
          "beach_walk", LongNode.valueOf(Long.parseLong(m.group(1).replaceAll("\\s", ""))), clause, level);
    Matcher min = MINUTES.matcher(clause);
    if (min.find())
      // Минуты — грубая оценка, поэтому уверенность всегда низкая.
      return new Extraction(
          "beach_walk",
          LongNode.valueOf(Long.parseLong(min.group(1)) * METERS_PER_MINUTE),
          clause,
          "low");
    return null;
  }

  static List<String> sentences(String answer) {
    List<String> result = new ArrayList<>();
    for (String part : answer.split("[.!?;\\n]+")) if (!part.isBlank()) result.add(part.strip());
    return result;
  }

  /** Фразы предложения — дословные подстроки, чтобы цитата проходила проверку. */
  static List<String> clauses(String sentence) {
    List<String> result = new ArrayList<>();
    for (String part : sentence.split(",\\s*|\\s+(?=(а|но|однако|хотя)\\s)")) {
      String clause = part.strip();
      if (clause.length() >= 3) result.add(clause);
    }
    return result;
  }

  /** Для тестов: характеристики, которые умеет разбирать этот экстрактор. */
  static Set<String> supported() {
    Set<String> codes = new java.util.HashSet<>(RULES.keySet());
    codes.add("beach_walk");
    return codes;
  }

  static JsonNode bool(boolean value) {
    return BooleanNode.valueOf(value);
  }
}
