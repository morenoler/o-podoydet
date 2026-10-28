package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.server.support.TestDatabases.Database;
import ru.opodoydet.shared.Json;

class PersonalWishesTest {
  private static List<JsonNode> selected() {
    return List.of(Json.obj("feature", "family", "required", false));
  }

  @Test
  void selectedChipsDoNotPretendToRecognizeEmptyOrUnsupportedPersonalText() {
    JsonNode blank = Agents.parseRules("  ", selected());
    assertEquals("not_requested", blank.path("personalWishes").path("status").asText());
    assertTrue(blank.path("personalWishes").path("features").isEmpty());
    JsonNode unknown = Agents.parseRules("Нужен батут с горками", selected());
    assertEquals("unrecognized", unknown.path("personalWishes").path("status").asText());
    assertTrue(unknown.path("personalWishes").path("features").isEmpty());
    assertEquals("family", unknown.path("preferences").path(0).path("feature").asText());
  }

  @Test
  void knownWishAlongsideUnsupportedWishNeverClaimsCompleteRecognitionOrCopiesText() {
    String text = "Тихо и батут. PERSONAL_CANARY_e88";
    JsonNode wishes = Agents.parseRules(text, selected()).path("personalWishes");
    assertEquals("recognized", wishes.path("status").asText());
    assertEquals("unverified", wishes.path("completeness").asText());
    assertEquals(Set.of("courtyard", "low_noise"),
        Set.copyOf(Json.list(wishes.path("features")).stream().map(JsonNode::asText).toList()));
    assertFalse(wishes.toString().contains("family"));
    assertFalse(wishes.toString().contains("батут"));
    assertFalse(wishes.toString().contains("PERSONAL_CANARY_e88"));
  }

  @Test
  void recognizedExclusionsRemainSeparateFromPositiveConditionsAndPreserveConflicts() {
    JsonNode result = Agents.parseRules("Окна во двор не нужны",
        List.of(Json.obj("feature", "courtyard", "required", true)));
    assertEquals("recognized", result.path("personalWishes").path("status").asText());
    assertTrue(result.path("personalWishes").path("features").isEmpty());
    assertEquals("courtyard", result.path("personalWishes").path("excludedFeatures").path(0).asText());
    assertFalse(result.path("conflicts").isEmpty());
  }

  @Test
  void recognitionDoesNotCertifyAnyRoomAndSearchDetailAndSnapshotShareTheMetadata() throws Exception {
    ObjectNode seed = Json.obj("region", "Пусан", "hotels", List.of(
        Json.obj("id", "h", "name", "Hotel", "rooms", List.of(
            Json.obj("id", "r", "name", "Room", "capacity", 3, "demo", false)))),
        "facts", List.of());
    ObjectNode trip = Json.obj("region", "Пусан", "checkIn", "2027-06-10", "checkOut", "2027-06-15",
        "adults", 2, "children", 0, "scenarios", List.of("family"), "preferences", selected(),
        "text", "Тихо и батут. PERSONAL_CANARY_e88", "admissionMode", "explore");
    try (var database = TestDatabases.create(seed)) {
      Store store = database.store();
      SearchService service = new SearchService(store, new Agents(Agents.Config.from(Map.of())),
          new Environment(Path.of("missing-air"), Path.of("missing-noise")));
      JsonNode result = service.search(trip);
      JsonNode wishes = result.path("personalWishes");
      JsonNode match = result.path("results").path(0);
      assertEquals(wishes, match.path("personalWishes"));
      assertEquals(wishes, service.detail("h", trip).path("personalWishes"));
      assertEquals(wishes, service.advisorContext(trip, Json.str(result, "searchId")).path("personalWishes"));
      assertFalse(result.toString().contains("PERSONAL_CANARY_e88"));
      assertTrue(Json.list(match.path("best").path("criteria")).stream()
          .filter(criterion -> !Json.str(criterion, "feature").equals("family"))
          .allMatch(criterion -> Json.str(criterion, "evidenceStatus").equals("unknown")));
    }
  }

  @Test
  void ownerOnlyRecognitionDoesNotAddAnUnsupportedCatalogFeature() {
    ObjectNode interpreted = Agents.parseRules("Не выше 3 этажа", selected());
    assertEquals("unrecognized", interpreted.path("personalWishes").path("status").asText());
    PersonalWishes.includeOwnerCriteria(interpreted, List.of(Json.obj(
        "id", "floor-0", "feature", "floor", "label", "Этаж не выше 3", "required", true)));
    JsonNode wishes = interpreted.path("personalWishes");
    assertEquals("recognized", wishes.path("status").asText());
    assertTrue(wishes.path("features").isEmpty());
    assertEquals("floor-0", wishes.path("ownerCriteria").path(0).path("id").asText());
  }
}
