package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.shared.Json;

class SearchConversationTest {
  private final Agents agents = new Agents(new Agents.Config("", "", ""));
  private final SearchConversation chat = new SearchConversation(agents);

  private ObjectNode trip() {
    return Json.obj(
        "region",
        "Пусан",
        "checkIn",
        "2027-06-10",
        "checkOut",
        "2027-06-17",
        "adults",
        2,
        "children",
        0,
        "preferences",
        List.of(),
        "scenarios",
        List.of(),
        "text",
        "");
  }

  private ObjectNode say(JsonNode trip, String message) {
    return chat.refine(trip, message, Json.array(List.of()));
  }

  private JsonNode preference(JsonNode trip, String feature) {
    return Json.list(agents.interpret(trip).path("preferences")).stream()
        .filter(p -> Json.str(p, "feature").equals(feature))
        .findFirst()
        .orElse(null);
  }

  @Test
  void successiveMessagesAccumulateAndCanRelaxOrRemoveCriteria() {
    ObjectNode initial = trip();
    JsonNode first = say(initial, "Хочу поближе к морю").path("trip");
    JsonNode second = say(first, "И ещё обязательно тихо").path("trip");
    assertNotNull(preference(second, "beach_walk"));
    assertTrue(preference(second, "low_noise").path("required").asBoolean());
    assertNull(preference(second, "courtyard"));
    JsonNode third = say(second, "Тишина не обязательна").path("trip");
    assertFalse(preference(third, "low_noise").path("required").asBoolean());
    JsonNode fourth = say(third, "Убери условие про пляж").path("trip");
    assertNull(preference(fourth, "beach_walk"));
    assertNotNull(preference(fourth, "low_noise"));
    for (String key : List.of("region", "checkIn", "checkOut", "adults", "children"))
      assertEquals(initial.path(key), fourth.path(key));
  }

  @Test
  void editsOverrideOldTextWithoutDestroyingOtherDetails() {
    ObjectNode initial = trip().put("text", "Обязательно рядом с пляжем. Нужен второй этаж");
    JsonNode relaxed = say(initial, "Пляж не обязателен").path("trip");
    assertFalse(preference(relaxed, "beach_walk").path("required").asBoolean());
    JsonNode removed = say(relaxed, "Пляж не нужен").path("trip");
    assertNull(preference(removed, "beach_walk"));
    assertEquals(initial.path("text"), removed.path("text"));
    JsonNode readded = say(removed, "Снова хочу рядом с морем").path("trip");
    assertFalse(preference(readded, "beach_walk").path("required").asBoolean());
  }

  @Test
  void referringToPreviousWishUsesConversationFocus() {
    ObjectNode first = say(trip(), "Окна во двор");
    ObjectNode second =
        chat.refine(first.path("trip"), "Это обязательно", first.path("focusFeatures"));
    assertTrue(preference(second.path("trip"), "courtyard").path("required").asBoolean());
    assertFalse(say(trip(), "Это обязательно").path("changed").asBoolean());
  }

  @Test
  void unsupportedAndMixedRequestsAreNotSilentlyClaimedAsApplied() {
    ObjectNode response = say(trip(), "Рядом с морем, и нужен аквапарк");
    assertNotNull(preference(response.path("trip"), "beach_walk"));
    assertTrue(response.path("message").asText().contains("Не применено"));
    for (String message :
        List.of(
            "Вид на море", "Бюджет до 5000", "До моря -100 метров", "Грязный воздух", "Без детей")) {
      assertFalse(say(trip(), message).path("changed").asBoolean(), message);
    }
  }

  @Test
  void structuredFiltersAccumulateAndClearWithoutChangingDatesOrOtherFields() {
    JsonNode first = say(trip(), "Только апартаменты; до 100 000 KRW за ночь; до пляжа 0,5 км").path("trip");
    assertEquals("apartment", first.path("hotelFilters").path("lodgingTypes").path(0).asText());
    assertEquals(100000, first.path("hotelFilters").path("maxPricePerNight").asDouble());
    assertEquals(500, first.path("hotelFilters").path("maxBeachMeters").asDouble());
    JsonNode second = say(first, "Ищи «балкон, море и кухня»").path("trip");
    assertEquals("балкон, море и кухня", second.path("hotelFilters").path("query").asText());
    assertTrue(second.path("preferences").isEmpty());
    JsonNode third = say(second, "Убери бюджет").path("trip");
    assertFalse(third.path("hotelFilters").has("maxPricePerNight"));
    assertEquals(500, third.path("hotelFilters").path("maxBeachMeters").asDouble());
    assertEquals(trip().path("checkIn"), third.path("checkIn"));
    Validation.tripDraft(third, "Пусан");
  }

  @Test
  void floorsAndWindowDirectionUseExistingOwnerGrammarWithoutInventingEvidence() {
    ObjectNode reply = say(trip(), "Не выше 3 этажа; окна на восток");
    assertTrue(reply.path("changed").asBoolean());
    assertEquals("не выше 3 этажа. окна на восток", reply.path("trip").path("text").asText());
    assertTrue(reply.path("warnings").toString().contains("Неизвестные данные"));
    assertTrue(reply.path("trip").path("preferences").isEmpty());
    assertFalse(say(trip(), "Не выше 999 этажа").path("changed").asBoolean());
  }

  @Test
  void unrecognizedPartOfSameClauseIsReportedAndNegationDoesNotLeakAcrossConjunction() {
    ObjectNode mixed = say(trip(), "Тихий отель с аквапарком");
    assertNotNull(preference(mixed.path("trip"), "low_noise"));
    assertTrue(mixed.path("message").asText().contains("Не применено"));
    JsonNode split = say(trip(), "Пляж не нужен и окна во двор обязательны").path("trip");
    assertNull(preference(split, "beach_walk"));
    assertTrue(preference(split, "courtyard").path("required").asBoolean());
    assertFalse(say(trip(), "Не тихий отель").path("changed").asBoolean());
  }

  @Test
  void limitsAndUnsupportedCurrenciesAreNeverApproximated() {
    for (String message : List.of("До 100 долларов", "До 0 KRW", "До пляжа 0 м", "До пляжа 100001 м", "Не хочу апартаменты", "До моря 10 минут", "До 100000001 KRW"))
      assertFalse(say(trip(), message).path("changed").asBoolean(), message);
    assertEquals(150000, say(trip(), "Бюджет до 150 тыс вон").path("trip").path("hotelFilters").path("maxPricePerNight").asDouble());
    assertEquals(100, say(trip(), "До моря 100 метров").path("trip").path("hotelFilters").path("maxBeachMeters").asDouble());
  }

  @Test
  void naturalNamesAndAmenitiesAreSourceQueriesWithExplicitLimits() {
    for (String message : List.of("Найди Signiel", "Найди отель Signiel"))
      assertEquals("signiel", say(trip(), message).path("trip").path("hotelFilters").path("query").asText());
    ObjectNode response = say(trip(), "Хочу номер с балконом и нужна кухня");
    assertEquals("балкон кухня", response.path("trip").path("hotelFilters").path("query").asText());
    assertTrue(response.path("warnings").toString().contains("не подтверждает"));
    for (String message : List.of("Без бассейна", "Не хочу балкон", "Не нужны бассейн и парковка", "Без бассейна и балкона", "Нужна кухня для детского питания", "Найди отель без бассейна"))
      assertFalse(say(trip(), message).path("changed").asBoolean(), message);
    assertEquals("бассейн", say(trip(), "С бассейном").path("trip").path("hotelFilters").path("query").asText());
  }

  @Test
  void unknownWishClearsAmbiguousPronounFocus() {
    JsonNode quiet = say(trip(), "Тихо");
    JsonNode unknown = chat.refine(quiet.path("trip"), "Аквапарк", quiet.path("focusFeatures"));
    assertTrue(unknown.path("focusFeatures").isEmpty());
    JsonNode pronoun = chat.refine(unknown.path("trip"), "Это обязательно", unknown.path("focusFeatures"));
    assertFalse(pronoun.path("changed").asBoolean());
    assertFalse(preference(pronoun.path("trip"), "low_noise").path("required").asBoolean());
  }

  @Test
  void amenitiesAppendToCurrentNameWhileExplicitSearchReplacesIt() {
    ObjectNode initial = trip();
    initial.set("hotelFilters", Json.obj("query", "Signiel"));
    JsonNode appended = say(initial, "Нужен балкон").path("trip");
    assertEquals("Signiel балкон", appended.path("hotelFilters").path("query").asText());
    assertEquals("Signiel", initial.path("hotelFilters").path("query").asText(), "Journal's original trip must remain intact");
    JsonNode multiple = say(appended, "Нужен балкон и нужна кухня").path("trip");
    assertEquals("Signiel балкон кухня", multiple.path("hotelFilters").path("query").asText());
    JsonNode named = say(multiple, "Найди Hilton").path("trip");
    assertEquals("hilton", named.path("hotelFilters").path("query").asText());
    JsonNode quoted = say(multiple, "Ищи «терраса»").path("trip");
    assertEquals("терраса", quoted.path("hotelFilters").path("query").asText());
    assertFalse(say(multiple, "Очисти текстовый поиск").path("trip").has("hotelFilters"));
    assertEquals("кухня", say(multiple, "Очисти текстовый поиск; нужна кухня").path("trip").path("hotelFilters").path("query").asText());
    assertEquals("hilton кухня", say(multiple, "Нужен балкон; найди Hilton; нужна кухня").path("trip").path("hotelFilters").path("query").asText());
  }

  @Test
  void appendedSearchDeduplicatesLiteralWordsAndRejectsOverflowAtomically() {
    ObjectNode initial = trip();
    initial.set("hotelFilters", Json.obj("query", "Signiel БАЛКОН"));
    assertFalse(say(initial, "Нужен балкон").path("changed").asBoolean());
    String longQuery = "x".repeat(229);
    initial.set("hotelFilters", Json.obj("query", longQuery));
    JsonNode reply = say(initial, "Нужен балкон и нужна кухня");
    assertFalse(reply.path("changed").asBoolean(), "An oversized append must not apply only its first amenity");
    assertEquals(longQuery, reply.path("trip").path("hotelFilters").path("query").asText());
    assertTrue(reply.path("warnings").toString().contains("240"));
  }

  @Test
  void ordinaryAddNeverWeakensAnExistingMandatoryCriterion() {
    JsonNode initial = say(trip(), "Обязательно тихо").path("trip");
    assertTrue(
        preference(say(initial, "И ещё хочу тишины").path("trip"), "low_noise")
            .path("required")
            .asBoolean());
  }

  @Test
  void bookingVerbIsNotARequestToRemoveACriterion() {
    JsonNode result = say(trip(), "Хочу снять номер у моря").path("trip");
    assertNotNull(preference(result, "beach_walk"));
  }

  @Test
  void negatingUnwantedNoiseOrStepsDoesNotRemoveThePositiveCriterion() {
    JsonNode initial = say(trip(), "Обязательно тихо").path("trip");
    JsonNode quiet = say(initial, "Не хочу шума").path("trip");
    assertNotNull(preference(quiet, "low_noise"));
    assertTrue(preference(quiet, "low_noise").path("required").asBoolean());
    JsonNode accessible = say(trip(), "Не нужны ступени у входа").path("trip");
    assertNotNull(preference(accessible, "step_free_access"));
  }

  @Test
  void supportedSafetyAndQuietPhrasesAreNotRejectedAsUnsupportedSubstrings() {
    assertNotNull(preference(say(trip(), "Хочу безопасный район").path("trip"), "area_safety"));
    assertNotNull(preference(say(trip(), "Нужен не шумный отель").path("trip"), "low_noise"));
    assertNotNull(preference(say(trip(), "Хочу выспаться").path("trip"), "low_noise"));
  }

  @Test
  void multipleClausesHaveIndependentPriorities() {
    JsonNode result = say(trip(), "Обязательно пляж рядом, а окна во двор желательно").path("trip");
    assertTrue(preference(result, "beach_walk").path("required").asBoolean());
    assertFalse(preference(result, "courtyard").path("required").asBoolean());
  }

  @Test
  void canCollectWishesBeforeDatesAndValidateOverridePayloads() {
    ObjectNode draft = trip().put("checkIn", "").put("checkOut", "");
    Validation.tripDraft(draft, "Пусан");
    assertThrows(IllegalArgumentException.class, () -> Validation.trip(draft, "Пусан"));
    ObjectNode response = say(draft, "Тихий отель");
    assertTrue(response.path("message").asText().contains("Выберите даты"));
    assertEquals("", response.path("trip").path("checkIn").asText());
    draft.set(
        "preferenceOverrides",
        Json.array(List.of(Json.obj("feature", "pool", "enabled", true, "required", false))));
    assertThrows(IllegalArgumentException.class, () -> Validation.tripDraft(draft, "Пусан"));
  }

  @Test
  void editsPreserveAdmissionModeAndKeepPersonalWishesConsistentWithAppliedFilters() {
    ObjectNode initial =
        trip()
            .put("admissionMode", "explore")
            .put("text", "Обязательно окна во двор. Хочу семейный номер");
    JsonNode removed = say(initial, "Убери условие про двор").path("trip");
    assertEquals("explore", removed.path("admissionMode").asText());
    ObjectNode interpreted = agents.interpret(removed);
    assertEquals("recognized", interpreted.path("personalWishes").path("status").asText());
    assertFalse(
        Json.list(interpreted.path("personalWishes").path("features")).stream()
            .anyMatch(feature -> feature.asText().equals("courtyard")));
    assertTrue(
        Json.list(interpreted.path("personalWishes").path("features")).stream()
            .anyMatch(feature -> feature.asText().equals("family")));
    Validation.tripDraft(removed, "Пусан");
    initial.put("admissionMode", "anything");
    assertThrows(IllegalArgumentException.class, () -> Validation.tripDraft(initial, "Пусан"));
  }

  @Test
  void removingTheLastRecognizedConditionKeepsUnrecognizedPersonalTextDisclosed() {
    String text = "Окна во двор. Нужен бассейн. PERSONAL_CANARY_override";
    ObjectNode initial = trip().put("text", text);
    JsonNode removed = say(initial, "Убери условие про двор").path("trip");
    JsonNode interpreted = agents.interpret(removed);
    JsonNode wishes = interpreted.path("personalWishes");
    assertEquals("unrecognized", wishes.path("status").asText());
    assertEquals("unverified", wishes.path("completeness").asText());
    assertTrue(wishes.path("features").isEmpty());
    assertTrue(wishes.path("excludedFeatures").isEmpty());
    assertEquals(text, removed.path("text").asText());
    assertFalse(wishes.toString().contains("PERSONAL_CANARY_override"));
    assertTrue(PersonalWishes.notice(wishes).contains("ничего не распознано"));
    assertNull(preference(interpreted, "courtyard"));

    JsonNode unsupported =
        say(trip().put("text", "Бассейн"), "Убери условие про двор").path("trip");
    assertEquals(
        "unrecognized",
        agents.interpret(unsupported).path("personalWishes").path("status").asText());
    JsonNode blank = say(trip(), "Окна во двор").path("trip");
    assertEquals(
        "not_requested", agents.interpret(blank).path("personalWishes").path("status").asText());

    JsonNode withExclusion =
        say(trip().put("text", "Окна во двор. Семейный номер не нужен"), "Убери условие про двор")
            .path("trip");
    JsonNode excludedWishes = agents.interpret(withExclusion).path("personalWishes");
    assertEquals("recognized", excludedWishes.path("status").asText());
    assertEquals("family", excludedWishes.path("excludedFeatures").path(0).asText());
  }
}
