package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class NearbyIntentTest {
  private JsonNode one(String message) {
    NearbyIntent.Parsed parsed = NearbyIntent.parse(message);
    assertTrue(parsed.recognized(), message);
    assertEquals(1, parsed.updates().size(), message + ": " + parsed);
    assertEquals("", parsed.remainder(), message);
    assertEquals("", parsed.warning(), message);
    return parsed.updates().getFirst();
  }

  @Test
  void handlesRealUserExamplesAndCommonSynonyms() {
    Map<String, String> examples = new LinkedHashMap<>();
    examples.put("хочу отель в центре города", "city_center");
    examples.put("найди отель в центральном районе", "city_center");
    examples.put("hotel in downtown", "city_center");
    examples.put("нужен отель у Сомён", "city_center");
    examples.put("хочу рядом с кафе", "cafe");
    examples.put("нужна кофейня рядом", "cafe");
    examples.put("near coffee shop", "cafe");
    examples.put("рядом с рестораном", "restaurant");
    examples.put("недалеко от супермаркета", "supermarket");
    examples.put("у продуктового магазина", "supermarket");
    examples.put("поближе к магазину у дома", "convenience");
    examples.put("рядом с аптекой", "pharmacy");
    examples.put("около парка", "park");
    examples.put("near subway station", "subway");
    examples.put("рядом со станцией метро", "subway");
    examples.put("возле музея", "museum");
    examples.put("нужен отель возле торгового центра", "shopping_mall");
    examples.put("рядом с тц", "shopping_mall");
    examples.put("рядом с железнодорожной станцией", "train_station");
    examples.put("рядом с пляжем по прямой", "beach");
    for (var example : examples.entrySet()) {
      JsonNode edit = one(example.getKey());
      assertEquals(example.getValue(), edit.path("kind").asText(), example.getKey());
      assertEquals(NearbyIntent.definition(example.getValue()).defaultMaxMeters(), edit.path("maxMeters").asDouble());
    }
  }

  @Test
  void respectsDistanceUnitsAndHardBounds() {
    for (String message : List.of("метро до 0,8 км", "до метро 800 метров", "subway within 0.8 km", "не дальше 800 м от метро"))
      assertEquals(800, one(message).path("maxMeters").asDouble(), message);
    assertEquals(10000, one("кафе до 10 000 м").path("maxMeters").asDouble());
    assertEquals(1, one("кафе до 1 м").path("maxMeters").asDouble());
    for (String message : List.of("метро до 0 м", "метро до 10001 м", "до кафе -500 м", "до кафе 500", "кафе до 0,0001 км", "кафе в 10 минутах", "кафе до 500 м или ресторан до 700 м")) {
      var parsed = NearbyIntent.parse(message);
      assertTrue(parsed.updates().isEmpty(), message);
      assertFalse(parsed.warning().isBlank(), message);
    }
  }

  @Test
  void alternativeFarAwayAndOnsiteRequestsAreNeverInterpretedAsNear() {
    for (String message : List.of("рядом с кафе или рестораном", "или рестораном", "не рядом с кафе", "подальше от метро", "не в центре", "не в самом центре города", "не центр города", "не очень близко к метро", "без кафе", "без близости к кафе", "отель с рестораном", "кафе внутри отеля", "вид на парк", "не хочу рядом с кафе", "не ближе 500 м от кафе", "кафе от 500 м", "не менее 500 м от кафе")) {
      var parsed = NearbyIntent.parse(message);
      assertTrue(parsed.recognized(), message);
      assertTrue(parsed.updates().isEmpty(), message);
      assertFalse(parsed.warning().isBlank(), message);
    }
  }

  @Test
  void scopedRemovalAndUnknownPartsRemainExplicit() {
    for (String message : List.of("убери условие про кафе", "кафе неважно", "кафе не нужно", "кафе не обязательно"))
      assertEquals("remove", one(message).path("action").asText(), message);
    assertEquals("clear", one("убери условия рядом").path("action").asText());
    assertEquals("clear", one("убери всё рядом").path("action").asText());
    var mixed = NearbyIntent.parse("тихий отель рядом с веганским рестораном");
    assertEquals("restaurant", mixed.updates().getFirst().path("kind").asText());
    assertEquals("тихий веганским", mixed.remainder());
    assertFalse(NearbyIntent.parse("рядом с аквапарком").recognized());
    assertFalse(NearbyIntent.parse("рядом с пляжем").recognized(), "Existing beach wishes still describe walking access");
  }

  @Test
  void defaultsAndLabelsMatchSavedPlaceConfiguration() throws Exception {
    Path path = Path.of("data/busan/place-categories.json");
    if (!Files.isRegularFile(path)) path = Path.of("../data/busan/place-categories.json");
    JsonNode config = Json.read(Files.readString(path));
    assertEquals(NearbyIntent.DEFINITIONS.size(), config.size());
    for (JsonNode category : config) {
      var definition = NearbyIntent.definition(category.path("key").asText());
      assertEquals(category.path("label").asText(), definition.label());
      assertEquals(category.path("defaultMaxMeters").asInt(), definition.defaultMaxMeters());
    }
  }
}
