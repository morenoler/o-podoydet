package ru.opodoydet.server.host;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import ru.opodoydet.server.knowledge.Characteristic;

class RuleBasedAnswerExtractorTest {

  static final List<Characteristic> ROOM_AND_HOTEL =
      List.of(
          Characteristic.of("courtyard", "room", "host", "boolean"),
          Characteristic.of("step_free_access", "room", "host", "boolean"),
          Characteristic.of("family", "room", "host", "boolean"),
          Characteristic.of("step_free_route", "hotel", "route", "boolean"),
          Characteristic.of("beach_walk", "hotel", "route", "meters"));

  final RuleBasedAnswerExtractor extractor = new RuleBasedAnswerExtractor();

  Map<String, AnswerExtractor.Extraction> extract(String answer) {
    return extractor.extract(answer, ROOM_AND_HOTEL).stream()
        .collect(Collectors.toMap(AnswerExtractor.Extraction::characteristic, e -> e));
  }

  @Test
  void oneAnswerFillsSeveralFieldsWithExactQuotes() {
    String answer =
        "Во двор окон нет, а от входа до лифта всё на одном уровне. До пляжа около 50 метров без лестниц.";
    var found = extract(answer);

    assertThat(found.get("courtyard").value().asBoolean()).isFalse();
    assertThat(found.get("step_free_access").value().asBoolean()).isTrue();
    assertThat(found.get("step_free_route").value().asBoolean()).isTrue();
    assertThat(found.get("beach_walk").value().asLong()).isEqualTo(50);
    found.values().forEach(e -> assertThat(answer).contains(e.quote()));
  }

  @Test
  void stairsToTheBeachAreNotConfusedWithTheEntrance() {
    var found = extract("До пляжа примерно 100 метров, но придётся спуститься по лестнице у набережной.");

    assertThat(found.get("step_free_route").value().asBoolean()).isFalse();
    assertThat(found).doesNotContainKey("step_free_access");
    assertThat(found.get("beach_walk").value().asLong()).isEqualTo(100);
  }

  @Test
  void negativesWinOverPositiveWords() {
    assertThat(extract("У входа три ступени и пандуса нет.").get("step_free_access").value().asBoolean())
        .isFalse();
    assertThat(extract("Окна выходят на улицу.").get("courtyard").value().asBoolean()).isFalse();
    assertThat(extract("Окна Deluxe Family Twin выходят на море.").get("courtyard").value().asBoolean())
        .isFalse();
    assertThat(extract("Детей не размещаем, отель только для взрослых.").get("family").value().asBoolean())
        .isFalse();
    assertThat(extract("Номера выходят во внутренний двор.").get("courtyard").value().asBoolean())
        .isTrue();
  }

  @Test
  void hedgedAnswersGetLowConfidenceAndMinutesAreConverted() {
    var hedged = extract("Кажется, детскую кроватку можно поставить по запросу.");
    assertThat(hedged.get("family").value().asBoolean()).isTrue();
    assertThat(hedged.get("family").confidenceLevel()).isEqualTo("low");

    var minutes = extract("До моря 5 минут пешком.");
    assertThat(minutes.get("beach_walk").value().asLong()).isEqualTo(400);
    assertThat(minutes.get("beach_walk").confidenceLevel()).isEqualTo("low");
  }

  @Test
  void evasiveAnswerGivesNothingInsteadOfGuessing() {
    assertThat(extract("Спасибо за вопрос! Уточню у коллег и вернусь с ответом.")).isEmpty();
    assertThat(extract("Зависит от этажа, уточню у службы размещения.")).isEmpty();
  }

  @Test
  void contradictoryAnswerAboutOneFieldIsSkipped() {
    assertThat(extract("Окна во двор. Хотя нет, окна на улицу.")).doesNotContainKey("courtyard");
  }

  @Test
  void onlyCandidateCharacteristicsAreExtracted() {
    var hotelOnly =
        extractor.extract(
            "Во двор окон нет. До пляжа 200 метров.",
            List.of(Characteristic.of("beach_walk", "hotel", "route", "meters")));
    assertThat(hotelOnly).extracting(AnswerExtractor.Extraction::characteristic).containsExactly("beach_walk");
  }
}
