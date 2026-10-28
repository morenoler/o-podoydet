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
    ObjectNode response = say(trip(), "Рядом с морем, и нужен бассейн");
    assertNotNull(preference(response.path("trip"), "beach_walk"));
    assertNotNull(preference(response.path("trip"), "pool"));
    assertFalse(response.path("message").asText().contains("Не применено"));
    for (String message :
        List.of(
            "Вид на море", "Бюджет до 5000", "До моря 100 метров", "Грязный воздух", "Без детей")) {
      assertFalse(say(trip(), message).path("changed").asBoolean(), message);
    }
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
        Json.array(List.of(Json.obj("feature", "unknown_feature", "enabled", true, "required", false))));
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
    String text = "Окна во двор. Нужен батут. PERSONAL_CANARY_override";
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
        say(trip().put("text", "Батут"), "Убери условие про двор").path("trip");
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
