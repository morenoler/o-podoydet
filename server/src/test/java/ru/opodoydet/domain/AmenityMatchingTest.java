package ru.opodoydet.domain;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class AmenityMatchingTest {
  private final Instant now = Instant.parse("2026-10-28T00:00:00Z");
  private ObjectNode fact(boolean value) {
    return Json.obj("id","synthetic-fact","hotelId","synthetic","feature","pool","value",value,
        "method","official","sourceUrl","https://example.test/pool","quote","Synthetic explicit pool evidence",
        "obtainedAt","2026-10-20T00:00:00Z","expiresAt","2027-01-01T00:00:00Z","demo",false);
  }
  @Test void positiveNeedsWholeTripButNegativeAtCheckoutRemainsAConflict() {
    var trip = Json.obj("checkIn","2027-06-10","checkOut","2027-06-17");
    var preference = Json.obj("feature","pool","required",true);
    var partial = fact(true).put("validFrom","2027-06-11");
    assertEquals("unknown",Matching.evaluate(List.of(partial),preference,Json.obj(),trip,now).path("status").asText());
    var closed = fact(false).put("validFrom","2027-06-17").put("validTo","2027-06-17");
    assertEquals("mismatch",Matching.evaluate(List.of(closed),preference,Json.obj(),trip,now).path("status").asText());
    assertEquals("conflict",Matching.evaluate(List.of(closed,fact(true)),preference,Json.obj(),trip,now).path("status").asText());
    assertEquals("unknown",Matching.evaluate(List.of(closed.put("validFrom","2027-06-18").put("validTo","2027-06-18")),preference,Json.obj(),trip,now).path("status").asText());
  }
}
