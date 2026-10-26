package ru.opodoydet.domain;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class AdmissionPolicyTest {
  @Test void sharedTsJavaFixturesPreserveRawEvidenceAndLegacyDefault() throws Exception {
    JsonNode fixtures = Json.MAPPER.readTree(Path.of("../tests/fixtures/admission-cases.json").toFile());
    for (JsonNode fixture : fixtures) for (String mode : List.of("", "verified", "explore")) {
      ObjectNode trip = Json.obj();
      if (!mode.isEmpty()) trip.put("admissionMode",mode);
      ObjectNode capacity = Json.obj("capacityStatus", Json.str(fixture,"capacity").equals("match") ? "match":"mismatch",
          "capacityEvidenceStatus",fixture.path("capacity"));
      JsonNode criterion = Json.obj("required",fixture.path("required"), "status",Json.str(fixture,"criterion").equals("match") ? "match":"mismatch",
          "evidenceStatus",fixture.path("criterion"));
      JsonNode before = capacity.deepCopy(), original = criterion.deepCopy();
      ObjectNode result = AdmissionPolicy.decide(capacity,List.of(criterion),trip);
      assertEquals(Json.str(fixture,mode.equals("explore")?"explore":"verified"),Json.str(result,"status"),Json.str(fixture,"name"));
      assertEquals(mode.equals("explore") && fixture.path("provisional").asBoolean(),result.path("provisional").asBoolean());
      assertEquals(before,capacity); assertEquals(original,criterion);
    }
  }

  @Test void roomRankingPrefersConfirmedAdmissionAndNeverTransfersRoomFacts() {
    var unknown = Json.obj("id","unknown","name","Unknown","capacity",null,"demo",true);
    var known = Json.obj("id","known","name","Known","capacity",4,"demo",true);
    var hotel = Json.obj("id","h","rooms",List.of(unknown,known));
    var trip = Json.obj("adults",2,"children",1,"admissionMode","explore");
    JsonNode preference = Json.obj("feature","family","required",false);
    var fact = Json.obj("hotelId","h","roomId","unknown","feature","family","value",true,"expiresAt","2099-01-01T00:00:00Z");
    JsonNode result = Matching.rank(List.of(hotel),List.of(fact),List.of(preference),trip,Instant.parse("2026-10-25T12:00:00Z"),Map.of(),"demo").getFirst();
    assertEquals("known",Json.str(result.path("best").path("room"),"id"));
    assertFalse(result.path("best").path("provisional").asBoolean());
    assertEquals("unknown",Json.str(result.path("best").path("criteria").get(0),"evidenceStatus"));
    assertTrue(result.path("rooms").get(1).path("provisional").asBoolean());
    assertEquals("unknown",Json.str(result.path("rooms").get(1),"capacityEvidenceStatus"));
  }

  @Test void invalidAdmissionModeIsRejected() {
    var trip = Json.obj("region","Пусан","checkIn","2027-06-10","checkOut","2027-06-11","adults",2,"children",0,
        "scenarios",List.of(),"preferences",List.of(),"text","");
    assertSame(trip,Validation.trip(trip,"Пусан"));
    assertSame(trip,Validation.trip(trip.put("admissionMode","explore"),"Пусан"));
    assertThrows(IllegalArgumentException.class,()->Validation.trip(trip.put("admissionMode","relaxed"),"Пусан"));
    assertThrows(IllegalArgumentException.class,()->Validation.trip(trip.putNull("admissionMode"),"Пусан"));
  }
}
