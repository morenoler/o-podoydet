package ru.opodoydet.accounts.clarifications;

import java.util.Locale;
import java.util.Arrays;
import java.util.regex.Pattern;
import ru.opodoydet.accounts.AccountProblem;

/**
 * A bounded consistency guard for an explicit checkbox attestation, not a prose extractor.
 * Neutral prose is allowed. Recognized uncertainty, qualifications and contradictions are
 * rejected; an unrecognized sentence is never promoted to evidence by this class.
 */
final class StatementTextGuard {
  private StatementTextGuard() {}

  private static final String UNCERTAIN = "не знаю|неизвест|не уверен|кажется|не провер|нужно уточнить|пока выясня|надо уточнить|не могу подтвердить";
  private static final String PARTIAL_UNITS = "(?:част[ьи]|некотор\\p{L}*|отдельн\\p{L}*)\\s+(?:из\\s+)?(?:номер|комнат|корпус|категори)\\p{L}*|не\\s+(?:во|в|у)\\s+всех\\s+(?:номер|комнат|корпус)\\p{L}*";
  private static final String FAMILY = "дет|ребен|семейн|семь|взросл";
  private static final String WINDOWS = "окн|во двор";
  private static final String ACCESS = "ступен|лестниц|пандус|коляск|лифт|вход|путь|пути|проход";

  static void check(String feature, boolean value, String text) {
    String normalized = text.toLowerCase(Locale.ROOT).replace('ё', 'е').replaceAll("(?U)\\s+", " ");
    boolean positive = false, negative = false;
    // A full alternate route can make entrance stairs irrelevant. Explicitly unavoidable
    // barriers remain contradictions even if another sentence claims a step-free path.
    boolean fullAccess = feature.equals("step_free_access")
        && Arrays.stream(normalized.split("[.!?;]+")).anyMatch(StatementTextGuard::hasFullAccess);
    for (String raw : normalized.split("[.!?;]+")) {
      String sentence = raw.trim();
      if (sentence.isEmpty()) continue;
      // Statements explicitly about a different unit do not describe this listing unit.
      if (has(sentence, "^(?:в|у) (?:соседн|друг)\\p{L}* (?:номер|комнат)")) continue;
      String terms = switch (feature) {
        case "family" -> FAMILY;
        case "courtyard" -> WINDOWS;
        case "step_free_access" -> ACCESS;
        default -> "(?!)";
      };
      boolean selected = has(sentence, terms);
      boolean anotherSubject = has(sentence, "парков|кофемаш|балкон|скидк|кроватк|здани|пляж|крыш");
      anotherSubject |= !feature.equals("family") && has(sentence, FAMILY);
      anotherSubject |= !feature.equals("courtyard") && has(sentence, WINDOWS);
      anotherSubject |= !feature.equals("step_free_access") && has(sentence, ACCESS);
      if (has(sentence, UNCERTAIN) && (selected || !anotherSubject)) reject();
      if (selected && has(sentence, PARTIAL_UNITS)) reject();
      if (selected && has(sentence, "\\bесли\\b|при условии|после отдельного согласования|зависит от")) reject();

      switch (feature) {
        case "family" -> {
          // A price reduction, cot suitability or building age is not an admission age limit.
          for (String clause : sentence.split(",")) {
            boolean ancillary = has(clause, "скидк|бесплат|кроватк|здани");
            boolean age = has(clause, "(?:старше|младше|от|до|с)\\s*\\d{1,2}\\s*(?:лет|год)|исполнилось\\s*\\d|начиная с\\s+\\p{L}*летнего возраста");
            if (age && !ancillary && (selected || has(clause.trim(), "^только|^можно"))) reject();
          }
          boolean no = has(sentence, "не подходит.{0,35}(?:сем|дет)|(?:с детьми|дети).{0,25}(?:нельзя|запрещен|не допускаются)|только для взрослых|детей не принимаем|не принимаем.{0,15}дет|без детей");
          boolean yes = has(sentence, "с детьми.{0,30}(?:можно|разрешено)|принимаем детей|предусмотрено семейное размещение|возрастных ограничений нет|ограничений по возрасту детей нет");
          negative |= no;
          positive |= yes && !no;
        }
        case "courtyard" -> {
          if (!selected) continue;
          // Explicit correction within a sentence: do not treat the negated quotation as fact.
          if (has(sentence, "^не правда, что") && sentence.contains(":"))
            sentence = sentence.substring(sentence.indexOf(':') + 1);
          boolean no = has(sentence, "не все окна|часть окон|(?:окн|другое).{0,55}(?:на улицу|на дорогу|на проспект)|окн.{0,20}не.{0,15}во двор");
          boolean yes = has(sentence, "окн.{0,70}во двор");
          negative |= no;
          // Mixed windows are an explicit no, not two incompatible complete assertions.
          positive |= yes && !no;
        }
        case "step_free_access" -> {
          if (!selected) continue;
          positive |= hasFullAccess(sentence);
          var accessClauses = Arrays.stream(sentence.split(","))
              .filter(clause -> !has(clause, "(?:на|до|к) пляж|(?:на|к) (?:закрытую )?крыш")).toList();
          String accessContext = String.join(",", accessClauses);
          for (String clause : accessClauses) {
            String obstacles = clause.replaceAll("(?:без|нет) (?:ступен|лестниц)\\p{L}*", "");
            boolean steps = has(obstacles, "ступен|лестниц|поднимать вручную|перенесут коляску");
            boolean noBypass = has(accessContext, "(?:пандус|обход)\\p{L}*(?: и обхода)? нет|нет (?:пандус|обход)|без (?:пандус|обход)|обойти.{0,20}невозможно|поднимать вручную|перенесут коляску");
            boolean ramp = has(accessContext, "(?:есть|доступный) пандус|пандус есть");
            if (steps && !ramp && (noBypass || !fullAccess)) negative = true;
          }
        }
        default -> { /* Unknown features are validated by the caller. */ }
      }
    }
    if (positive && negative || value && negative || !value && positive) reject();
  }

  private static boolean hasFullAccess(String text) {
    return Arrays.stream(text.split("[,;.!?]+"))
        .filter(clause -> !has(clause, "(?:на|до|к) пляж|(?:на|к) (?:закрытую )?крыш"))
        .anyMatch(clause -> has(clause, "(?:от улицы|от тротуара|путь|проход|доступ|вход).{0,110}до (?:этого )?номера.{0,45}(?:без|нет) (?:ступен|лестниц)|(?:без|нет) (?:ступен|лестниц).{0,60}(?:от улицы|до (?:этого )?номера)"));
  }

  private static boolean has(String text, String regex) {
    return Pattern.compile("(?U)(?:" + regex + ")").matcher(text).find();
  }

  private static void reject() {
    throw new AccountProblem(400, "Выбранное значение противоречит тексту ответа или требует уточнения. Исправьте ответ либо выберите «Неизвестно» и сохраните ограничения в тексте.");
  }
}
