package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import ru.opodoydet.domain.Amenities;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.shared.Json;

class AmenityWishesTest {
  private final Agents agents = new Agents(new Agents.Config("", "", ""));
  private ObjectNode trip() {
    return Json.obj("region", "Пусан", "checkIn", "2027-06-10", "checkOut", "2027-06-17",
        "adults", 2, "children", 0, "scenarios", List.of(), "preferences", List.of(), "text", "");
  }
  private JsonNode preference(JsonNode result, String id) {
    return Json.list(result.path("preferences")).stream().filter(p -> Json.str(p,"feature").equals(id)).findFirst().orElseThrow();
  }
  @Test void parsesMandatoryListsAndIndependentNegations() {
    JsonNode parsed = Agents.parseRules("Обязательно посудомойка, стиральная машина и бассейн. Парковка не нужна, а кухня желательно", List.of());
    for (String id : List.of("dishwasher", "washing_machine", "pool")) assertTrue(preference(parsed,id).path("required").asBoolean(), id);
    assertFalse(preference(parsed,"kitchen").path("required").asBoolean());
    assertEquals(Json.array(List.of("parking")), parsed.path("personalWishes").path("excludedFeatures"));
  }
  @Test void chatAddsRelaxesAndRemovesAmenitiesWithoutChangingTravelDates() {
    SearchConversation chat = new SearchConversation(agents);
    JsonNode initial = trip().put("text", "Обязательно посудомойка, стиральная машина и бассейн");
    JsonNode next = chat.refine(initial, "Бассейн не обязателен, а стиральную машину убери", Json.array(List.of())).path("trip");
    JsonNode parsed = agents.interpret(next);
    assertTrue(preference(parsed,"dishwasher").path("required").asBoolean());
    assertFalse(preference(parsed,"pool").path("required").asBoolean());
    assertFalse(Json.list(parsed.path("preferences")).stream().anyMatch(p -> Json.str(p,"feature").equals("washing_machine")));
    assertEquals(initial.path("checkIn"), next.path("checkIn"));
    assertEquals(initial.path("checkOut"), next.path("checkOut"));
    Validation.trip(next, "Пусан");
  }
  @Test void allAmenityIdsWorkInCatalogButPublicReplyCannotCreateEvidence() {
    ObjectNode input = trip();
    input.set("preferences", Json.array(Amenities.definitions().keySet().stream().map(id -> Json.obj("feature",id,"required",true)).toList()));
    Validation.trip(input, "Пусан");
    for (String id : Amenities.definitions().keySet())
      assertTrue(agents.extract("Да, есть",id).path("extractions").isEmpty(), id);
  }
  @Test void englishDishwasherDoesNotAlsoRequestAWashingMachine() {
    JsonNode parsed = Agents.parseRules("dishwasher required", List.of());
    assertEquals(1, parsed.path("preferences").size());
    assertTrue(preference(parsed,"dishwasher").path("required").asBoolean());
    JsonNode edited = new SearchConversation(agents).refine(trip(),"dishwasher required",Json.array(List.of()));
    assertEquals(1, edited.path("trip").path("preferences").size());
    assertTrue(preference(edited.path("trip"),"dishwasher").path("required").asBoolean());
    JsonNode relaxed = Agents.parseRules("washer not required", List.of());
    assertFalse(preference(relaxed,"washing_machine").path("required").asBoolean());
  }
  @Test void absenceIsNeverInvertedIntoAPositiveAmenityAndMixedDatesStayUntouched() {
    for (String text : List.of("Без бассейна", "Не должно быть бассейна", "Обязательно бесплатная парковка", "Бассейн с подогревом", "Wi-Fi 100 мбит", "Общая кухня", "shared kitchen", "Стиральная машина в общей прачечной", "Wi-Fi в лобби")) {
      assertTrue(Agents.parseRules(text,List.of()).path("preferences").isEmpty());
      assertFalse(new SearchConversation(agents).refine(trip(),text,Json.array(List.of())).path("changed").asBoolean());
    }
    JsonNode initial = trip();
    JsonNode changed = new SearchConversation(agents).refine(initial,"Заезд 12 июня, обязательно посудомойка и стиральная машина",Json.array(List.of()));
    assertEquals(initial.path("checkIn"),changed.path("trip").path("checkIn"));
    assertTrue(changed.path("message").asText().contains("Не применено"));
    assertTrue(preference(agents.interpret(changed.path("trip")),"dishwasher").path("required").asBoolean());
    assertTrue(preference(agents.interpret(changed.path("trip")),"washing_machine").path("required").asBoolean());
  }
  @Test void modelUsesTheSameAmenityCatalogForInitialWishesAndFollowUpEdits() throws Exception {
    AtomicReference<JsonNode> lastRequest = new AtomicReference<>();
    HttpServer model = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    model.createContext("/responses", exchange -> {
      JsonNode request = Json.read(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));
      lastRequest.set(request);
      boolean edit = request.path("text").path("format").path("name").asText().equals("search_conversation");
      JsonNode answer = edit ? Json.obj("updates",List.of(Json.obj("feature","pool","action","remove")),"unhandled",List.of())
          : Json.obj("preferences",List.of(Json.obj("feature","dishwasher","required",true),Json.obj("feature","washing_machine","required",true),Json.obj("feature","pool","required",false)),"excluded",List.of(),"warnings",List.of());
      byte[] bytes = Json.write(Json.obj("status","completed","output",List.of(Json.obj("content",List.of(Json.obj("type","output_text","text",Json.write(answer))))))).getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200,bytes.length);
      exchange.getResponseBody().write(bytes);
      exchange.close();
    });
    model.start();
    try {
      Agents configured = new Agents(new Agents.Config("synthetic-test-key","test-model","http://127.0.0.1:"+model.getAddress().getPort(), Agents.Protocol.RESPONSES));
      ObjectNode query = trip().put("text","Обязательно посудомойка и стиральная машина, бассейн желательно");
      JsonNode parsed = configured.interpret(query);
      assertEquals("llm",parsed.path("mode").asText());
      assertTrue(preference(parsed,"dishwasher").path("required").asBoolean());
      JsonNode catalog = Json.read(lastRequest.get().path("input").asText()).path("features");
      for (String id : Amenities.definitions().keySet()) assertTrue(catalog.has(id),id);
      JsonNode edited = new SearchConversation(configured).refine(query,"Убери бассейн",Json.array(List.of()));
      assertEquals("llm",edited.path("mode").asText());
      assertEquals(query.path("checkIn"),edited.path("trip").path("checkIn"));
      assertFalse(Json.list(edited.path("trip").path("preferences")).stream().anyMatch(p -> Json.str(p,"feature").equals("pool")));
    } finally { model.stop(0); }
  }
}
