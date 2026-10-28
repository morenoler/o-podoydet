package ru.opodoydet.accounts;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.accounts.clarifications.ClarificationScope;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.accounts.search.OwnerListingSearchProvider;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

class ListingAccommodationTest {
  private static ObjectNode empty(String status) {
    return Json.obj("title", "Тестовая расстановка", "description", "Вымышленное размещение для проверки расстановки.",
        "city", "Пусан", "address", "Тестовая улица 5", "roomType", "Семейный номер", "capacity", 4,
        "pricePerNight", 120000, "status", status, "amenities", List.of("Wi-Fi"));
  }

  private static ObjectNode bed(String type, int count, int places, String room) {
    return Json.obj("type", type, "count", count, "placesPerUnit", places, "room", room);
  }

  private static ObjectNode complete(String status) {
    ObjectNode input = empty(status).put("sleepingPlaces", 4);
    input.set("coordinates", Json.array(List.of(129.16, 35.16)));
    input.set("beds", Json.array(List.of(bed("double", 1, 2, "  Спальня 1  "),
        bed("single", 2, 1, "Спальня 2"), bed("crib", 1, 1, "Спальня 1"))));
    return input;
  }

  private static TestDatabases.Database database() throws Exception {
    var database = TestDatabases.create(Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of()));
    for (String host : List.of("host", "other"))
      database.accounts().execute("INSERT INTO account_users(id,email,password_hash,role,name,created_at) VALUES(?,?,?,'host',?,?)",
          host, host + "@example.test", "unused", host, "2026-10-25T00:00:00Z");
    return database;
  }

  @Test void layoutAndLocationRoundTripWithOwnerProvenanceAndOmittedFieldsArePreserved() throws Exception {
    try (var database = database()) {
      AccountDatabase db = database.accounts();
      ListingService service = new ListingService(db);
      ObjectNode input = complete("published").put("demo", true);
      input.set("searchProfile", Json.obj("notes", "PRIVATE_LAYOUT_NOTE"));
      JsonNode created = service.create("host", input);
      String id = Json.str(created, "id");
      assertFalse(created.path("demo").asBoolean(), "API cannot spoof the fixture marker");
      assertEquals(4, created.path("sleepingPlaces").asInt(), "crib must not inflate the capacity");
      assertEquals("Спальня 1", Json.str(created.path("beds").get(0), "room"));
      JsonNode saved = service.update("host", id, empty("published").put("title", "Сохранённая расстановка"));
      assertEquals(created.path("beds"), saved.path("beds"));
      assertEquals(created.path("coordinates"), saved.path("coordinates"));
      assertEquals(404, assertThrows(AccountProblem.class,
          () -> service.update("other", id, complete("published"))).status);
      assertFalse(service.published(id).toString().contains("PRIVATE_LAYOUT_NOTE"));
      assertEquals(0, service.owned("other").size());
      JsonNode match = new OwnerListingSearchProvider(db).snapshot(Json.obj("region", "Пусан", "adults", 2, "children", 2, "text", ""))
          .apply(List.of(), List.of()).getFirst();
      assertEquals(created.path("coordinates"), match.path("hotel").path("coordinates"));
      assertEquals(saved.path("beds"), match.path("best").path("room").path("beds"));
      assertEquals(4, match.path("best").path("room").path("sleepingPlaces").asInt());
      assertEquals(saved.path("amenities"), match.path("best").path("room").path("amenities"));
      assertTrue(match.path("hotel").path("route").isNull());
      assertTrue(match.path("hotel").path("noise").isEmpty());
      assertEquals("unknown", Json.str(match.path("best").path("room"), "evidenceStatus"));
      assertEquals("owner", Json.str(match.path("best"), "capacitySource"));
      assertFalse(match.toString().contains("PRIVATE_LAYOUT_NOTE"));
      // Fixture provenance survives ordinary edits and is projected independently of UUID shape.
      db.execute("UPDATE account_listings SET demo=TRUE WHERE id=?", id);
      assertTrue(service.update("host", id, empty("published").put("demo", false)).path("demo").asBoolean());
      JsonNode demo = new OwnerListingSearchProvider(db).snapshot(Json.obj("region", "Пусан", "adults", 1, "children", 0, "text", ""))
          .apply(List.of(), List.of()).getFirst();
      assertTrue(demo.path("hotel").path("synthetic").asBoolean());
      assertTrue(demo.path("best").path("room").path("demo").asBoolean());
      database.restart();
      JsonNode reloaded = new ListingService(database.accounts()).published(id);
      assertEquals(saved.path("beds"), reloaded.path("beds"));
      assertEquals(saved.path("coordinates"), reloaded.path("coordinates"));
      assertEquals(4, reloaded.path("sleepingPlaces").asInt());
    }
  }

  @Test void publicationRequiresCompleteBedsWhileDraftsAndLegacyUnknownsRemainHonest() throws Exception {
    try (var database = database()) {
      ListingService service = new ListingService(database.accounts());
      assertEquals(400, assertThrows(AccountProblem.class, () -> service.create("host", empty("published"))).status);
      JsonNode draft = service.create("host", empty("draft"));
      String id = Json.str(draft, "id");
      assertTrue(draft.path("coordinates").isNull());
      assertTrue(draft.path("sleepingPlaces").isNull());
      assertTrue(draft.path("beds").isEmpty());
      assertTrue(service.published().isEmpty());
      assertEquals(404, assertThrows(AccountProblem.class, () -> service.published(id)).status);
      assertEquals(400, assertThrows(AccountProblem.class, () -> service.update("host", id, empty("published"))).status);
      JsonNode published = service.update("host", id, complete("published"));
      ObjectNode clearPublished = empty("published").putNull("sleepingPlaces");
      clearPublished.set("beds", Json.array(List.of()));
      assertThrows(AccountProblem.class, () -> service.update("host", id, clearPublished));
      ObjectNode clearMap = empty("published").putNull("coordinates");
      JsonNode withoutMap = service.update("host", id, clearMap);
      assertTrue(withoutMap.path("coordinates").isNull());
      assertEquals(published.path("beds"), withoutMap.path("beds"));
      ObjectNode clearDraft = clearPublished.deepCopy().put("status", "draft");
      assertTrue(service.update("host", id, clearDraft).path("beds").isEmpty());
      // Simulates an existing pre-V7 published row, not a bypass in the public API.
      database.accounts().execute("UPDATE account_listings SET status='published' WHERE id=?", id);
      JsonNode legacy = service.published(id);
      String oldScope = ClarificationScope.fingerprint(legacy);
      ObjectNode oldShape = legacy.deepCopy(); oldShape.remove(List.of("coordinates", "sleepingPlaces", "beds"));
      assertEquals(ClarificationScope.fingerprint(oldShape), oldScope);
      JsonNode preserved = service.update("host", id, empty("published").put("title", "Новый заголовок"));
      assertTrue(preserved.path("sleepingPlaces").isNull());
      assertTrue(preserved.path("beds").isEmpty());
      assertEquals(oldScope, ClarificationScope.fingerprint(preserved));
      assertThrows(AccountProblem.class, () -> service.update("host", id, empty("published").put("capacity", 5)));
      assertThrows(AccountProblem.class, () -> service.update("host", id, clearPublished));
    }
  }

  @Test void invalidLocationsAndLayoutsCannotPartiallyUpdateTheOffer() throws Exception {
    try (var database = database()) {
      ListingService service = new ListingService(database.accounts());
      JsonNode original = service.create("host", complete("published"));
      String id = Json.str(original, "id");
      List<ObjectNode> invalid = new ArrayList<>();
      for (JsonNode coordinates : List.of(Json.array(List.of(181, 0)), Json.array(List.of(0, -91)),
          Json.array(List.of(0)), Json.array(List.of(0, 0, 0)), Json.array(List.of("129.16", 35.16)),
          Json.obj("longitude", 129, "latitude", 35), Json.array(List.of(Double.NaN, 35)))) {
        ObjectNode form = complete("published"); form.set("coordinates", coordinates); invalid.add(form);
      }
      for (JsonNode beds : List.of(Json.obj(), Json.MAPPER.nullNode(), Json.array(List.of()),
          Json.array(List.of(bed("unknown", 4, 1, ""))), Json.array(List.of(bed("single", 0, 1, ""))),
          Json.array(List.of(bed("single", 21, 1, ""))), Json.array(List.of(bed("single", 2, 2, ""))),
          Json.array(List.of(bed("double", 4, 1, ""))), Json.array(List.of(bed("bunk", 4, 1, ""))),
          Json.array(List.of(bed("sofa", 1, 5, ""))), Json.array(List.of(bed("other", 1, 0, ""))),
          Json.array(List.of(bed("single", 4, 1, "x".repeat(61)))),
          Json.array(List.of(bed("single", 4, 1, "").put("room", 3))),
          Json.array(List.of(bed("single", 4, 1, "").put("count", 1.5))),
          Json.array(List.of(bed("sofa", 2, 2, "").put("placesPerUnit", 2.5))),
          Json.array(java.util.Collections.nCopies(21, bed("single", 1, 1, ""))))) {
        ObjectNode form = complete("published"); form.set("beds", beds); invalid.add(form);
      }
      invalid.add(complete("published").put("sleepingPlaces", 5));
      invalid.add(complete("published").put("sleepingPlaces", 0));
      invalid.add(complete("published").put("sleepingPlaces", 41));
      invalid.add(complete("published").put("sleepingPlaces", 4.5));
      invalid.add(complete("published").putNull("sleepingPlaces"));
      invalid.add(complete("published").put("capacity", 5));
      for (ObjectNode input : invalid) {
        input.put("title", "Ошибка не должна сохраниться");
        assertEquals(400, assertThrows(AccountProblem.class, () -> service.update("host", id, input), input.toString()).status);
        JsonNode unchanged = service.published(id);
        assertEquals(original.path("title"), unchanged.path("title"));
        assertEquals(original.path("beds"), unchanged.path("beds"));
        assertEquals(original.path("coordinates"), unchanged.path("coordinates"));
      }
      ObjectNode bounds = complete("published"); bounds.set("coordinates", Json.array(List.of(-180, 90)));
      assertEquals(-180, service.update("host", id, bounds).path("coordinates").get(0).asDouble());
      for (String type : List.of("sofa", "futon", "other", "folding", "bunk")) {
        ObjectNode valid = complete("published");
        valid.set("beds", Json.array(List.of(bed(type, type.equals("folding") ? 4 : 2, type.equals("folding") ? 1 : 2, "Комната"))));
        assertEquals(type, Json.str(service.update("host", id, valid).path("beds").get(0), "type"));
      }
    }
  }
}
