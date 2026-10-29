package ru.opodoydet.server.knowledge;

import static org.junit.jupiter.api.Assertions.*;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

class ScheduledResolutionTest {
  @Test void scheduledRefreshPersistsClosingAnExistingConflict() throws Exception {
    var positive = Json.obj("id", "positive", "hotelId", "hotel", "feature", "step_free_route", "value", true,
        "method", "official", "demo", false, "sourceUrl", "https://example.test/evidence", "quote", "Synthetic statement",
        "obtainedAt", Instant.now().minusSeconds(3600).toString(), "expiresAt", Instant.now().plusSeconds(86400).toString());
    var negative = positive.deepCopy().put("id", "negative").put("value", false);
    var seed = Json.obj("region", "Пусан", "evidencePolicy", "verified-only", "hotels",
        List.of(Json.obj("id", "hotel", "name", "Synthetic hotel", "rooms", List.of())), "facts", List.of(positive, negative));
    try (var db = TestDatabases.create(seed)) {
      var resolver = db.context().getBean(FactResolver.class);
      resolver.resolveAll();
      assertEquals(1L, db.jdbc().sql("SELECT count(*) FROM conflict WHERE resolved_at IS NULL").query(Long.class).single());
      db.jdbc().sql("UPDATE evidence SET active = false WHERE id='negative'").update();
      resolver.scheduled();
      assertEquals(Fact.Status.confirmed, resolver.fact(new Subject("hotel", null, "step_free_route")).orElseThrow().getStatus());
      assertEquals(0L, db.jdbc().sql("SELECT count(*) FROM conflict WHERE resolved_at IS NULL").query(Long.class).single());
      assertEquals(1L, db.jdbc().sql("SELECT count(*) FROM conflict WHERE resolved_at IS NOT NULL").query(Long.class).single());
      resolver.scheduled();
      assertEquals(1L, db.jdbc().sql("SELECT count(*) FROM conflict").query(Long.class).single());
    }
  }
}
