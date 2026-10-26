package ru.opodoydet.accounts.clarifications;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.accounts.AccountProblem;

/** Hand-labelled synthetic answers, independent of the parser's patterns. Not a field accuracy claim. */
class StatementTextGuardCorpusTest {
  record Example(String id, String feature, boolean value, boolean allowed, String text) {}

  // The checkbox is an explicit owner statement. Neutral prose is allowed; it need not prove
  // the condition again. Known contradictions and qualifications must not pass as a blanket yes.
  static final List<Example> EXAMPLES = List.of(
      new Example("access-neutral", "step_free_access", true, true, "Проверил сегодня лично."),
      new Example("access-elevator-neutral", "step_free_access", true, true, "Лифт есть."),
      new Example("access-full-path", "step_free_access", true, true, "От улицы до номера можно пройти без ступеней."),
      new Example("access-ramp", "step_free_access", true, true, "У входа есть ступени, рядом доступный пандус. От улицы до номера можно пройти без ступеней."),
      new Example("access-unrelated-beach", "step_free_access", true, true, "От улицы до номера путь без ступеней. На пляже есть лестница, обхода нет."),
      new Example("access-unrelated-partial", "step_free_access", true, true, "Путь от улицы до номера без ступеней. В некоторых номерах есть кофемашина."),
      new Example("access-no-stairs-no-ramp-needed", "step_free_access", true, true, "От улицы до номера нет ступеней. Пандуса нет, потому что он не нужен."),
      new Example("access-negative-consistent", "step_free_access", false, true, "Перед входом три ступени, пандуса нет."),
      new Example("access-negative-path", "step_free_access", false, true, "На пути к номеру есть лестница без обхода."),
      new Example("access-negative-neutral", "step_free_access", false, true, "Сейчас это условие не выполняется."),
      new Example("access-opposite-positive", "step_free_access", false, false, "От улицы до номера путь без ступеней."),
      new Example("access-entrance-steps", "step_free_access", true, false, "Перед входом три ступени, пандуса нет."),
      new Example("access-path-steps", "step_free_access", true, false, "На пути от улицы до номера три ступени, пандуса нет."),
      new Example("access-elevator-after-steps", "step_free_access", true, false, "До лифта нужно подняться по лестнице. Пандуса и обхода нет."),
      new Example("access-after-elevator", "step_free_access", true, false, "После лифта до номера ещё пять ступеней, обхода нет."),
      new Example("access-partial-units", "step_free_access", true, false, "Без ступеней можно попасть только в некоторые номера."),
      new Example("access-uncertain", "step_free_access", true, false, "Не знаю, есть ли ступени по пути до номера."),
      new Example("access-maybe", "step_free_access", true, false, "Кажется, путь до номера без ступеней, но я не проверял."),
      new Example("access-conditional-assistance", "step_free_access", true, false, "До номера можно попасть, если сотрудники перенесут коляску по лестнице."),
      new Example("access-standalone-unknown", "step_free_access", true, false, "Не знаю."),

      new Example("courtyard-clear", "courtyard", true, true, "Все окна этого номера выходят во двор."),
      new Example("courtyard-neutral", "courtyard", true, true, "Проверил расположение окна сегодня."),
      new Example("courtyard-unrelated-age", "courtyard", true, true, "Все окна во двор. Детям до 12 лет предоставляем скидку."),
      new Example("courtyard-unrelated-partial", "courtyard", true, true, "Все окна во двор. В некоторых номерах есть кофемашина."),
      new Example("courtyard-noise-limitation", "courtyard", true, true, "Все окна во двор, но тишину не гарантируем."),
      new Example("courtyard-other-unknown", "courtyard", true, true, "Все окна во двор. Не знаю, есть ли парковка."),
      new Example("courtyard-negative-road", "courtyard", false, true, "Окна выходят на дорогу."),
      new Example("courtyard-negative-mixed", "courtyard", false, true, "Одно окно во двор, другое на улицу."),
      new Example("courtyard-negative-neutral", "courtyard", false, true, "Проверили: нет, этому условию вариант не соответствует."),
      new Example("courtyard-negative-opposite", "courtyard", false, false, "Все окна выходят во двор."),
      new Example("courtyard-positive-road", "courtyard", true, false, "Все окна на улицу."),
      new Example("courtyard-positive-mixed", "courtyard", true, false, "Одно окно во двор, другое на улицу."),
      new Example("courtyard-partial-rooms", "courtyard", true, false, "Окна во двор есть у части номеров."),
      new Example("courtyard-partial-windows", "courtyard", true, false, "Только часть окон этого номера выходит во двор."),
      new Example("courtyard-not-all", "courtyard", true, false, "Не все окна выходят во двор."),
      new Example("courtyard-uncertain", "courtyard", true, false, "Не уверен, куда выходят окна."),
      new Example("courtyard-no-check", "courtyard", true, false, "Кажется, окна во двор, но ещё не проверяли."),
      new Example("courtyard-conditional-assignment", "courtyard", true, false, "Окна будут во двор, если такой номер останется свободным."),
      new Example("courtyard-conflicting-sentences", "courtyard", true, false, "Все окна во двор. Окна выходят на улицу."),
      new Example("courtyard-standalone-unknown", "courtyard", true, false, "Пока неизвестно."),

      new Example("family-clear", "family", true, true, "С детьми можно, возрастных ограничений нет."),
      new Example("family-neutral", "family", true, true, "Подтверждаю условие для этого размещения."),
      new Example("family-building-age", "family", true, true, "С детьми можно. Здание старше 12 лет."),
      new Example("family-discount-age", "family", true, true, "С детьми любого возраста можно. Для детей до 7 лет действует скидка."),
      new Example("family-cot-age", "family", true, true, "С детьми любого возраста можно. Детская кроватка подходит до 3 лет."),
      new Example("family-unrelated-partial", "family", true, true, "С детьми можно. В некоторых номерах есть балкон."),
      new Example("family-no-playground", "family", true, true, "С детьми можно, но детской площадки нет."),
      new Example("family-negative-adults", "family", false, true, "Только для взрослых, с детьми нельзя."),
      new Example("family-negative-neutral", "family", false, true, "На этот вопрос отвечаем отрицательно."),
      new Example("family-opposite-positive", "family", false, false, "Предусмотрено семейное размещение с детьми."),
      new Example("family-adults-only", "family", true, false, "Только для взрослых, с детьми нельзя."),
      new Example("family-not-accepted", "family", true, false, "Детей не принимаем."),
      new Example("family-minimum-age", "family", true, false, "С детьми можно только старше 12 лет."),
      new Example("family-from-age", "family", true, false, "Принимаем детей от 10 лет."),
      new Example("family-short-age", "family", true, false, "Только с 12 лет."),
      new Example("family-conditional-age", "family", true, false, "Можно, если ребёнку исполнилось 12 лет."),
      new Example("family-partial-units", "family", true, false, "С детьми разрешено только в отдельных номерах."),
      new Example("family-dependent-approval", "family", true, false, "С детьми можно только после отдельного согласования."),
      new Example("family-uncertain", "family", true, false, "Не знаю, разрешено ли размещение с детьми."),
      new Example("family-standalone-unknown", "family", true, false, "Нужно уточнить."),

      // Independently reviewed holdouts and symmetric unknown answers: selecting no must
      // not turn missing knowledge into a negative fact either.
      new Example("access-negative-unknown", "step_free_access", false, false, "Не знаю."),
      new Example("courtyard-negative-unknown", "courtyard", false, false, "Не знаю."),
      new Example("family-negative-unknown", "family", false, false, "Не знаю."),
      new Example("heldout-other-room", "courtyard", true, true, "В этом номере все окна во двор. В соседнем номере окна на улицу."),
      new Example("heldout-mixed-kitchen", "courtyard", true, false, "Окно спальни во двор, кухонное окно на проспект."),
      new Example("heldout-negated-quotation", "courtyard", false, false, "Не правда, что окна выходят на улицу: все окна этого номера во двор."),
      new Example("heldout-free-children", "family", true, true, "Ограничений по возрасту детей нет; дети младше 6 лет размещаются бесплатно."),
      new Example("heldout-spelled-age", "family", true, false, "Размещаем с детьми начиная с семилетнего возраста."),
      new Example("heldout-negative-checking", "family", false, false, "Пока выясняю правила проживания с детьми."),
      new Example("heldout-side-entrance", "step_free_access", true, true, "Главный вход со ступенями. От тротуара через боковой вход и лифт до этого номера можно пройти без ступеней."),
      new Example("heldout-manual-carry", "step_free_access", true, false, "Лифт есть, но коляску придётся поднимать вручную на крыльцо."),
      new Example("heldout-after-lift", "step_free_access", false, true, "От лифта до этого номера две ступеньки, обойти их невозможно."),
      new Example("heldout-unrelated-roof", "step_free_access", true, true, "Путь от улицы до этого номера без ступеней. Лестница ведёт только на закрытую крышу."),
      new Example("review-age-and-discount", "family", true, false, "Принимаем детей только от 12 лет, предоставляем скидку."),
      new Example("review-steps-and-beach", "step_free_access", true, false, "До номера три ступени без обхода, а до пляжа можно пройти без ступеней."),
      new Example("review-other-feature-unknown", "courtyard", true, true, "Все окна во двор. Не знаю, разрешено ли размещение с детьми."),
      new Example("review-other-access-unknown", "family", true, true, "С детьми можно. Не знаю, есть ли ступени."),
      new Example("review-unrelated-ramp", "step_free_access", true, false, "До номера три ступени без обхода, на пляже есть пандус."),
      new Example("review-path-versus-beach", "step_free_access", true, false, "Путь до номера со ступенями, до пляжа без ступеней.")
  );

  @Test void consistentStatementsAndUnrelatedQualificationsRemainAcceptable() {
    for (Example example : EXAMPLES) if (example.allowed())
      assertDoesNotThrow(() -> StatementTextGuard.check(example.feature(), example.value(), example.text()), example.id() + ": " + example.text());
  }

  @Test void explicitContradictionsAndSelectedConditionQualificationsCannotConfirmTheUnit() {
    for (Example example : EXAMPLES) if (!example.allowed()) {
      AccountProblem rejected = assertThrows(AccountProblem.class,
          () -> StatementTextGuard.check(example.feature(), example.value(), example.text()), example.id() + ": " + example.text());
      assertEquals(400, rejected.status, example.id());
    }
  }

  @Test void typographyVariantsDoNotChangeTheGuardDecision() {
    for (Example example : EXAMPLES) {
      for (String variant : List.of(example.text().toUpperCase(java.util.Locale.ROOT),
          example.text().replace(" ", "\u00a0"), example.text().replace(". ", ".\n"))) {
        boolean accepted;
        try { StatementTextGuard.check(example.feature(), example.value(), variant); accepted = true; }
        catch (AccountProblem expected) { accepted = false; }
        assertEquals(example.allowed(), accepted, example.id() + ": " + variant);
      }
    }
  }
}
