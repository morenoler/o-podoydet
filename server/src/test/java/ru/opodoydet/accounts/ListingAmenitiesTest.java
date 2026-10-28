package ru.opodoydet.accounts;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.search.OwnerListingSearchProvider;
import ru.opodoydet.accounts.clarifications.ClarificationScope;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

class ListingAmenitiesTest {
  private ObjectNode input() {
    return Json.obj("title","Синтетическая квартира","description","Есть бассейн и стиральная машина. Это тестовый текст.",
        "city","Пусан","address","Тестовая улица","roomType","Квартира","capacity",4,"pricePerNight",50000,
        "amenities",List.of("Посудомоечная машина", "Wi-Fi"),"status","published");
  }
  private ObjectNode trip(String mode) {
    return Json.obj("region","Пусан","checkIn","2027-06-10","checkOut","2027-06-17","adults",2,"children",0,
        "admissionMode",mode,"text","","scenarios",List.of(),"preferences",List.of());
  }
  @Test void ownerStatesPersistWithServerProvenanceAndUnknownNeverMeansFalse() throws Exception {
    try (var database = TestDatabases.create(Json.obj("region","Пусан","hotels",List.of(),"facts",List.of()))) {
      var db = database.accounts();
      db.execute("INSERT INTO account_users(id,email,password_hash,role,name,created_at) VALUES('amenity-host','amenity@example.test','unused','host','Владелец',?)", Instant.now().toString());
      ListingService service = new ListingService(db);
      JsonNode created = service.create("amenity-host",input());
      String id = Json.str(created,"id");
      assertTrue(created.path("amenityEvidence").isEmpty());
      assertTrue(created.path("amenityStates").path("dishwasher").isNull());
      var provider = new OwnerListingSearchProvider(db);
      List<JsonNode> preferences = List.of(Json.obj("feature","dishwasher","required",true), Json.obj("feature","washing_machine","required",true), Json.obj("feature","pool","required",true));
      JsonNode unknown = provider.snapshot(trip("explore")).apply(List.of(),preferences).getFirst().path("best");
      assertTrue(unknown.path("provisional").asBoolean());
      assertEquals("unknown",unknown.path("criteria").get(0).path("evidenceStatus").asText());
      assertEquals("excluded",provider.snapshot(trip("verified")).apply(List.of(),preferences).getFirst().path("best").path("status").asText());
      ObjectNode update = input();
      update.set("amenityStates",Json.obj("dishwasher",true,"washing_machine",false,"pool",null));
      update.set("amenityEvidence",Json.obj("dishwasher",Json.obj("source","official","obtainedAt","1900-01-01")));
      JsonNode saved = service.update("amenity-host",id,update);
      assertEquals("owner",saved.path("amenityEvidence").path("dishwasher").path("source").asText());
      assertEquals("room",saved.path("amenityEvidence").path("dishwasher").path("scope").asText());
      assertEquals("hotel",saved.path("amenityEvidence").path("pool").path("scope").asText());
      assertEquals("excluded",provider.snapshot(trip("explore")).apply(List.of(),preferences).getFirst().path("best").path("status").asText());
      JsonNode firstEvidence = saved.path("amenityEvidence").deepCopy();
      JsonNode unchanged = service.update("amenity-host",id,input());
      assertEquals(firstEvidence,unchanged.path("amenityEvidence"),"Legacy request preserves values and their original dates");
      String scope = ClarificationScope.fingerprint(unchanged,db);
      update.set("amenityStates",Json.obj("dishwasher",null,"washing_machine",true));
      JsonNode cleared = service.update("amenity-host",id,update);
      assertTrue(cleared.path("amenityStates").path("dishwasher").isNull());
      assertNotEquals(scope,ClarificationScope.fingerprint(cleared,db));
      update.set("amenityStates",Json.obj("dishwasher",true,"washing_machine",false));
      JsonNode restored = service.update("amenity-host",id,update);
      assertNotEquals(scope,ClarificationScope.fingerprint(restored,db),"Returning old values must not revive old clarification scope");
      database.restart();
      JsonNode reloaded = new ListingService(database.accounts()).published(id);
      assertEquals(restored.path("amenityEvidence"),reloaded.path("amenityEvidence"));
      update.set("amenityStates",Json.obj("dishwasher","yes"));
      assertThrows(AccountProblem.class,() -> new ListingService(database.accounts()).update("amenity-host",id,update));
    }
  }
}
