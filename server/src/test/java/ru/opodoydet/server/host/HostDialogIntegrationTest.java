package ru.opodoydet.server.host;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import ru.opodoydet.server.catalog.SeedImporter;
import ru.opodoydet.server.knowledge.Fact;
import ru.opodoydet.server.knowledge.FactResolver;
import ru.opodoydet.server.knowledge.Subject;
import ru.opodoydet.server.support.FixedClockConfig;

/** Сквозной сценарий демо на настоящих данных Пусана и имитированных отельерах. */
@SpringBootTest(properties = {"LLM_API_KEY=", "LLM_MODEL="})
@Import(FixedClockConfig.class)
class HostDialogIntegrationTest {

  static final String GRAND_JOSUN = "way-843161717";
  static final String SHILLA = "way-627150752";

  @Autowired SeedImporter importer;
  @Autowired FactResolver resolver;
  @Autowired QuestionPlanner planner;
  @Autowired HostDialogService dialog;
  @Autowired SimulatedHotelier hotelier;
  @Autowired JdbcClient jdbc;

  @BeforeEach
  void freshKnowledge() throws Exception {
    jdbc.sql("UPDATE evidence SET superseded_by = NULL").update();
    jdbc.sql("DELETE FROM evidence WHERE origin <> 'seed'").update();
    jdbc.sql("DELETE FROM host_question").update();
    jdbc.sql("DELETE FROM conflict").update();
    importer.importFile(Path.of("../data/verified-hotels.json"));
    resolver.resolveAll();
  }

  @Test
  void plannerAsksAboutGapsWithContextAndWithoutDuplicates() {
    List<HostQuestion> created = planner.plan(GRAND_JOSUN, 50);

    // courtyard и step_free_access для двух детских категорий + дорога без лестниц.
    assertThat(created).hasSize(5);
    assertThat(created)
        .extracting(HostQuestion::getCharacteristic)
        .containsOnly("courtyard", "step_free_access", "step_free_route");
    HostQuestion courtyard =
        created.stream().filter(q -> q.getCharacteristic().equals("courtyard")).findFirst().orElseThrow();
    assertThat(courtyard.getText()).startsWith("Категория «Kids").contains("Сейчас известно");
    // Подтверждённое (семейное размещение, путь до пляжа) не спрашиваем; повтор не создаёт дублей.
    assertThat(planner.plan(GRAND_JOSUN, 50)).isEmpty();
  }

  @Test
  void hotelierFillsGapsAndCorroboratesTheMap() {
    double beachBefore = fact(GRAND_JOSUN, null, "beach_walk").getConfidence().doubleValue();

    SimulatedHotelier.Round round = hotelier.answerOpenQuestions(GRAND_JOSUN);

    assertThat(round.answers()).isNotEmpty();
    Fact courtyard = fact(GRAND_JOSUN, GRAND_JOSUN + "-real-kids-deluxe", "courtyard");
    assertThat(courtyard.getStatus()).isEqualTo(Fact.Status.confirmed);
    assertThat(courtyard.getValue().asBoolean()).isFalse();
    assertThat(fact(GRAND_JOSUN, null, "step_free_route").getValue().asBoolean()).isTrue();
    // Отель назвал 50 м, карта — 36 м: это одно утверждение, и уверенность выросла.
    Fact beach = fact(GRAND_JOSUN, null, "beach_walk");
    assertThat(beach.getStatus()).isEqualTo(Fact.Status.confirmed);
    assertThat(beach.getConfidence().doubleValue()).isGreaterThan(beachBefore);
    assertThat(count("SELECT count(*) FROM evidence WHERE simulated")).isPositive();
    assertThat(dialog.queue(GRAND_JOSUN, List.of(HostQuestion.Status.open))).isEmpty();
  }

  @Test
  void conflictIsNoticedAskedAboutAndResolved() {
    // Раунд 1: отель говорит «100 м и лестница», карта — 276 м.
    SimulatedHotelier.Round first = hotelier.answerOpenQuestions(SHILLA);

    assertThat(fact(SHILLA, null, "beach_walk").getStatus()).isEqualTo(Fact.Status.conflict);
    assertThat(fact(SHILLA, null, "step_free_route").getValue().asBoolean()).isFalse();
    List<HostQuestion> followUps =
        first.answers().stream().flatMap(a -> a.followUps().stream()).toList();
    assertThat(followUps).hasSize(1);
    assertThat(followUps.getFirst().getCharacteristic()).isEqualTo("beach_walk");
    assertThat(followUps.getFirst().getText()).contains("расходятся").contains("276 м").contains("100 м");
    assertThat(count("SELECT count(*) FROM conflict WHERE resolved_at IS NULL")).isEqualTo(1);

    // Раунд 2: на уточнение отель исправляется — 250 м. Прежний ответ заменён, конфликт закрыт.
    // Уклончиво отвеченное («зависит от этажа») повторно не спрашиваем.
    SimulatedHotelier.Round second = hotelier.answerOpenQuestions(SHILLA);
    assertThat(second.planned()).isZero();
    assertThat(second.answers()).hasSize(1);

    Fact beach = fact(SHILLA, null, "beach_walk");
    assertThat(beach.getStatus()).isEqualTo(Fact.Status.confirmed);
    assertThat(beach.getValue().asLong()).isEqualTo(276);
    assertThat(count("SELECT count(*) FROM conflict WHERE resolved_at IS NULL")).isZero();
    assertThat(count("SELECT count(*) FROM conflict")).isEqualTo(1);
    assertThat(count("SELECT count(*) FROM evidence WHERE superseded_by IS NOT NULL")).isEqualTo(1);
  }

  @Test
  void evasiveAnswerLeavesQuestionUnresolvedAndCreatesNoFacts() {
    HostQuestion question =
        planner.plan(GRAND_JOSUN, 1).getFirst();
    long evidence = count("SELECT count(*) FROM evidence");

    HostDialogService.AnswerResult result =
        dialog.answer(question.getId(), "Уточню у коллег и вернусь с ответом.", "cabinet");

    assertThat(result.question().getStatus()).isEqualTo(HostQuestion.Status.unresolved);
    assertThat(result.changes()).isEmpty();
    assertThat(count("SELECT count(*) FROM evidence")).isEqualTo(evidence);
  }

  private Fact fact(String hotel, String room, String characteristic) {
    return resolver.fact(new Subject(hotel, room, characteristic)).orElseThrow();
  }

  private long count(String sql) {
    return jdbc.sql(sql).query(Long.class).single();
  }

  @SuppressWarnings("unused")
  private Map<String, Object> row(String sql) {
    return jdbc.sql(sql).query().singleRow();
  }
}
