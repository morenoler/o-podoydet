package ru.opodoydet.persistence;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.shared.Json;
import ru.opodoydet.server.support.TestDatabases;

class AdvisorStoreTest {
  @TempDir Path temp;

  private ObjectNode seed() {
    return Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of());
  }

  private ObjectNode run(String id, String status) {
    return Json.obj("id", id, "status", status, "createdAt", "2026-10-24T15:00:00Z");
  }

  @Test
  void preservesHistoryAndFailsInterruptedRunsWithoutTouchingCatalog() throws Exception {
    try (var database = TestDatabases.create(seed())) {
      Store store = database.store();
      store.saveAdvisorRun(run("active", "running"));
      store.saveAdvisorRun(run("done", "completed"));
      store.saveAdvisorRun(run("cancelled", "cancelled"));
      database.restart();
      store = database.store();
      store.recoverAdvisorRuns();
      assertEquals("failed", store.advisorRun("active").path("status").asText());
      assertEquals("completed", store.advisorRun("done").path("status").asText());
      assertEquals("cancelled", store.advisorRun("cancelled").path("status").asText());
      assertEquals(3, store.advisorRuns().size());
      assertTrue(store.facts().isEmpty());
      assertTrue(store.hotels().isEmpty());
      store.recoverAdvisorRuns();
      assertEquals(3, store.advisorRuns().size());
    }
  }

  @Test
  void scopesRunsByRegionAndUpdatesWithoutDuplicating() throws Exception {
    try (var database = TestDatabases.create(seed())) {
      Store store = database.store();
      store.saveAdvisorRun(run("same", "queued"));
      store.saveAdvisorRun(run("same", "completed"));
      assertEquals(1, store.advisorRuns().size());
      assertEquals("completed", store.advisorRun("same").path("status").asText());
      database.importSeed(seed().put("region", "Другой регион"));
      assertNull(store.advisorRun("same"));
      assertTrue(store.advisorRuns().isEmpty());
      assertThrows(IllegalArgumentException.class, () -> store.saveAdvisorRun(run("same", "failed")));
      database.importSeed(seed());
      assertEquals("completed", store.advisorRun("same").path("status").asText());
      assertEquals(1, store.advisorRuns().size());
    }
  }
}
