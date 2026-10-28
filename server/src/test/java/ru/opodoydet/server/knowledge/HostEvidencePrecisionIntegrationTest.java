package ru.opodoydet.server.knowledge;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.BooleanNode;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.application.Agents;
import ru.opodoydet.application.Environment;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.server.host.DemoHostGuard;
import ru.opodoydet.server.search.SearchOverlay;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

class HostEvidencePrecisionIntegrationTest {
  @Test void databasePrecisionCannotTurnAnImmediateContradictionIntoFutureEvidence() throws Exception {
    Instant now = Instant.now().minusSeconds(5).truncatedTo(ChronoUnit.SECONDS).plusNanos(123_456_789);
    Clock clock = Clock.fixed(now, ZoneOffset.UTC);
    var room = Json.obj("id", "room", "name", "Synthetic test category", "capacity", 2, "demo", false,
        "evidenceStatus", "verified", "scope", "room_category", "sourceUrl", "https://example.test/room",
        "quote", "Synthetic test category", "obtainedAt", now.minusSeconds(3600).toString());
    var seed = Json.obj("region", "Пусан", "evidencePolicy", "verified-only", "hotels",
        List.of(Json.obj("id", "hotel", "name", "Synthetic precision fixture", "rooms", List.of(room))), "facts", List.of());
    try (var db = TestDatabases.create(seed)) {
      var commands = new KnowledgeCommands(db.jdbc(), db.context().getBean(CharacteristicRepository.class),
          db.context().getBean(ObjectMapper.class), clock, db.context().getBean(DemoHostGuard.class));
      var service = new SearchService(db.store(), new Agents(Agents.Config.from(java.util.Map.of())),
          new Environment(db.directory().resolve("air.json"), db.directory().resolve("noise.json")),
          clock, null, db.context().getBean(SearchOverlay.class));
      var trip = Json.obj("region", "Пусан", "checkIn", "2027-06-01", "checkOut", "2027-06-02",
          "adults", 2, "children", 0, "scenarios", List.of(), "text", "", "admissionMode", "verified",
          "preferences", List.of(Json.obj("feature", "courtyard", "required", true)));
      String positive = commands.recordHostStatement(statement(true));
      Evidence stored = db.context().getBean(EvidenceRepository.class).findById(positive).orElseThrow();
      assertFalse(stored.getObtainedAt().isAfter(now), "PostgreSQL precision must not round a received statement into the future");
      assertEquals(stored.getObtainedAt(), Instant.parse(Json.read(stored.getRaw()).path("obtainedAt").asText()));
      assertEquals(1, service.search(trip).path("results").size());
      commands.recordHostStatement(statement(false));
      var contradicted = service.search(trip);
      assertTrue(contradicted.path("results").isEmpty(), contradicted::toString);
      var criterion = contradicted.path("excluded").get(0).path("best").path("criteria").get(0);
      assertEquals("conflict", criterion.path("evidenceStatus").asText());
      assertEquals(2, criterion.path("facts").size());
    }
  }

  private static KnowledgeCommands.HostStatement statement(boolean value) {
    return new KnowledgeCommands.HostStatement("hotel", "room", "courtyard", BooleanNode.valueOf(value),
        "Synthetic precision test statement", "medium", "Synthetic test", "Synthetic test source", false, null);
  }
}
