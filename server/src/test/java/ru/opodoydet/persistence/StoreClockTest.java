package ru.opodoydet.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.server.catalog.CatalogService;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.shared.Json;

class StoreClockTest {
  @Test
  void sourceEligibilityAndPersistedTimestampsUseTheInjectedClock() throws Exception {
    Instant now = Instant.parse("2050-05-20T10:00:00Z");
    JsonNode source = Json.obj("id", "clock-evidence", "hotelId", "clock-hotel", "roomId", "room",
        "feature", "courtyard", "value", true, "demo", false, "method", "official",
        "sourceUrl", "https://example.org/clock-fixture", "quote", "Synthetic clock fixture",
        "obtainedAt", now.minusSeconds(60).toString());
    JsonNode seed = Json.obj("region", "Clock fixture", "evidencePolicy", "verified-only",
        "hotels", List.of(Json.obj("id", "clock-hotel", "name", "Synthetic clock fixture",
            "rooms", List.of(Json.obj("id", "room", "name", "Synthetic room", "capacity", 2)))),
        "facts", List.of(source));
    try (var database = TestDatabases.create(seed)) {
      CatalogService catalog = database.context().getBean(CatalogService.class);
      Store store = new Store(database.jdbc(), catalog, database.tx(), Clock.fixed(now, ZoneOffset.UTC));
      Store earlier = new Store(database.jdbc(), catalog, database.tx(),
          Clock.fixed(now.minusSeconds(120), ZoneOffset.UTC));
      assertThat(store.matchingFacts()).containsExactly(source);
      assertThat(earlier.matchingFacts()).isEmpty();

      JsonNode question = store.ask(Json.obj("hotelId", "clock-hotel", "roomId", "room",
          "feature", "courtyard", "text", "Куда выходят окна?"));
      assertThat(question.path("createdAt").asText()).isEqualTo(now.toString());
      String answer = "Все окна во двор.";
      store.saveDraft(Json.obj("id", "clock-draft", "questionId", question.path("id"),
          "text", answer, "mode", "rules", "warnings", List.of(), "extractions",
          List.of(Json.obj("feature", "courtyard", "value", true, "quote", answer))), now.toString());
      JsonNode saved = store.confirm("clock-draft", false).getFirst();
      assertThat(saved.path("obtainedAt").asText()).isEqualTo(now.toString());
      store.createAdvisorRun(Json.obj("id", "clock-run", "createdAt", now.minusSeconds(30).toString(),
          "status", "running"), "visitor:fixture");
      store.recoverAdvisorRuns();
      assertThat(store.advisorRun("clock-run", "visitor:fixture").path("updatedAt").asText())
          .isEqualTo(now.toString());
    }
  }
}
