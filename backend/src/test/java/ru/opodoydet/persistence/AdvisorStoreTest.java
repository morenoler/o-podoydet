package ru.opodoydet.persistence;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.node.ObjectNode;

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
    String database = temp.resolve("research.sqlite3").toString();
    try (Store store = new Store(database, seed())) {
      store.saveAdvisorRun(run("active", "running"));
      store.saveAdvisorRun(run("done", "completed"));
      store.saveAdvisorRun(run("cancelled", "cancelled"));
    }
    try (Store store = new Store(database, seed())) {
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
    String database = temp.resolve("regions.sqlite3").toString();
    try (Store store = new Store(database, seed())) {
      store.saveAdvisorRun(run("same", "queued"));
      store.saveAdvisorRun(run("same", "completed"));
      assertEquals(1, store.advisorRuns().size());
      assertEquals("completed", store.advisorRun("same").path("status").asText());
    }
    try (Store store = new Store(database, seed().put("region", "Другой регион"))) {
      assertNull(store.advisorRun("same"));
      assertTrue(store.advisorRuns().isEmpty());
    }
  }
}
