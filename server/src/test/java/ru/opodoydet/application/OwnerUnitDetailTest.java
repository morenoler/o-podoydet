package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.server.support.TestDatabases.Database;
import ru.opodoydet.shared.Json;

class OwnerUnitDetailTest {
  @TempDir Path directory;

  private ObjectNode trip() {
    return Json.obj("region", "Пусан", "checkIn", "2027-01-01", "checkOut", "2027-01-03",
        "adults", 2, "children", 0, "scenarios", List.of(), "text", "", "admissionMode", "explore",
        "preferences", List.of(Json.obj("feature", "courtyard", "required", true)));
  }

  @Test
  void publishedUnitGetsExpandedEvidenceWithoutChangingItsSearchDecision() throws Exception {
    AtomicInteger snapshots = new AtomicInteger();
    SearchExtension extension = ignored -> {
      snapshots.incrementAndGet();
      return new SearchExtension.Snapshot() {
        public int additionalHotels() { return 2; }
        public List<JsonNode> apply(List<JsonNode> baseline, List<JsonNode> preferences) {
          List<JsonNode> result = new ArrayList<>(baseline);
          for (String unit : List.of("first", "second")) {
            ObjectNode room = Json.obj("id", "account-room:" + unit, "name", unit, "capacity", 2);
            List<JsonNode> criteria = preferences.stream().map(p -> (JsonNode) Json.obj(
                "feature", p.path("feature"), "required", p.path("required"),
                "status", "mismatch", "evidenceStatus", "unknown", "assumed", true,
                "facts", List.of())).toList();
            // Expansion intentionally changes score/status. Detail must preserve the selected query.
            ObjectNode best = Json.obj("room", room, "criteria", criteria, "score", -2 * preferences.size(),
                "status", preferences.size() == 1 ? "fits" : "excluded", "provisional", true);
            result.add(Json.obj("hotel", Json.obj("id", "account-listing:" + unit,
                "accountListingId", unit, "rooms", List.of(room)), "best", best,
                "rooms", List.of(best.deepCopy())));
          }
          return result;
        }
      };
    };
    try (var database = TestDatabases.create(Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of()))) {
      Store store = database.store();
      SearchService service = new SearchService(store, new Agents(Agents.Config.from(Map.of())),
          new Environment(directory.resolve("air.json"), directory.resolve("noise.json")),
          Clock.fixed(Instant.parse("2026-10-25T12:00:00Z"), ZoneOffset.UTC), extension);
      JsonNode detail = service.detail("account-listing:first", trip());
      assertNotNull(detail);
      assertEquals(1, snapshots.get(), "Expanded evidence uses the same immutable source snapshot");
      assertEquals("account-room:first", Json.str(detail.path("best").path("room"), "id"));
      assertEquals("fits", Json.str(detail.path("best"), "status"));
      assertEquals(-2, detail.path("best").path("score").asInt());
      assertTrue(detail.path("best").path("provisional").asBoolean());
      assertEquals(ru.opodoydet.domain.Features.ids().size(), detail.path("best").path("criteria").size());
      assertEquals(detail.path("best"), detail.path("rooms").get(0));
      assertEquals(1, detail.path("preferences").size());
      assertNull(service.detail("account-listing:private-or-missing", trip()));
      assertNull(service.detail("nonexistent-research-hotel", trip()));
    }
  }
}
