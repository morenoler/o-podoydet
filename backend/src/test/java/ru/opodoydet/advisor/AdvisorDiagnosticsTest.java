package ru.opodoydet.advisor;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.application.Agents;
import ru.opodoydet.application.Environment;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;

class AdvisorDiagnosticsTest {
  @TempDir Path directory;

  private static ObjectNode diagnostic(String agent) {
    return Json.obj(
        "id",
        "call-" + agent,
        "agent",
        agent,
        "status",
        "completed",
        "startedAt",
        "2026-10-24T12:00:00Z",
        "finishedAt",
        "2026-10-24T12:00:01Z",
        "durationMs",
        1000,
        "model",
        "test-local",
        "input",
        Json.obj("messages", List.of(Json.obj("role", "user", "content", "Наблюдаемый ввод"))),
        "output",
        Json.obj("candidateIds", List.of("c1")),
        "inputTokens",
        25,
        "outputTokens",
        5);
  }

  private static ObjectNode localRun() {
    return Json.obj(
        "mode",
        "local",
        "execution",
        "local",
        "model",
        "test-local",
        "modelCalls",
        2,
        "diagnostics",
        List.of(diagnostic("selector"), diagnostic("critic")));
  }

  @Test
  void diagnosticsRequireActualCompletedCallsForLocalSuccess() {
    assertDoesNotThrow(() -> AdvisorDiagnostics.validate(localRun(), "test-local", true));
    ObjectNode missingCalls = localRun().put("modelCalls", 0);
    missingCalls.set("diagnostics", Json.array(List.of()));
    assertThrows(
        IllegalArgumentException.class,
        () -> AdvisorDiagnostics.validate(missingCalls, "test-local", true));
    ObjectNode running = localRun();
    ((ObjectNode) running.path("diagnostics").get(1)).put("status", "running");
    assertDoesNotThrow(() -> AdvisorDiagnostics.validate(running, "test-local", false));
    assertThrows(
        IllegalArgumentException.class,
        () -> AdvisorDiagnostics.validate(running, "test-local", true));
    ObjectNode rules = localRun().put("execution", "rules");
    assertThrows(
        IllegalArgumentException.class,
        () -> AdvisorDiagnostics.validate(rules, "test-local", true));
    assertDoesNotThrow(
        () ->
            AdvisorDiagnostics.validate(
                localRun().put("execution", "rules_fallback"), "test-local", true));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            AdvisorDiagnostics.validate(localRun().put("execution", "remote"), "test-local", true));
  }

  @Test
  void diagnosticLimitsUseBytesAndRejectMalformedIdentityTimingAndUsage() {
    ObjectNode large = localRun();
    ((ObjectNode) large.path("diagnostics").get(0)).put("input", "Ж".repeat(40_000));
    assertThrows(
        IllegalArgumentException.class,
        () -> AdvisorDiagnostics.validate(large, "test-local", true));
    ObjectNode unknownAgent = localRun();
    ((ObjectNode) unknownAgent.path("diagnostics").get(0)).put("agent", "shell");
    assertThrows(
        IllegalArgumentException.class,
        () -> AdvisorDiagnostics.validate(unknownAgent, "test-local", true));
    ObjectNode negativeUsage = localRun();
    ((ObjectNode) negativeUsage.path("diagnostics").get(0)).put("inputTokens", -1);
    assertThrows(
        IllegalArgumentException.class,
        () -> AdvisorDiagnostics.validate(negativeUsage, "test-local", true));
    ObjectNode reversedTime = localRun();
    ((ObjectNode) reversedTime.path("diagnostics").get(0))
        .put("finishedAt", "2026-10-23T12:00:00Z");
    assertThrows(
        IllegalArgumentException.class,
        () -> AdvisorDiagnostics.validate(reversedTime, "test-local", true));
    ObjectNode wrongModel = localRun();
    ((ObjectNode) wrongModel.path("diagnostics").get(0)).put("model", "cloud-model");
    assertThrows(
        IllegalArgumentException.class,
        () -> AdvisorDiagnostics.validate(wrongModel, "test-local", true));
  }

  @Test
  void diagnosticAliasesResolveOnlyInsideOriginalCandidateAndEvidenceScope() {
    ObjectNode run = localRun();
    run.set(
        "context",
        Json.obj(
            "candidates",
            List.of(
                Json.obj(
                    "id", "candidate-one", "criteria", List.of(Json.obj("id", "evidence-one"))),
                Json.obj(
                    "id", "candidate-two", "criteria", List.of(Json.obj("id", "evidence-two")))),
            "scenarios",
            List.of(Json.obj("id", "scenario-one")),
            "questions",
            List.of(Json.obj("id", "question-one"))));
    ObjectNode references =
        Json.obj(
            "candidates",
            Json.obj("c1", "candidate-one", "c2", "candidate-two"),
            "evidence",
            Json.obj(
                "e1",
                List.of("candidate-one", "evidence-one"),
                "e2",
                List.of("candidate-two", "evidence-two")),
            "scenarios",
            Json.obj("s1", "scenario-one"),
            "questions",
            Json.obj("q1", "question-one"));
    ((ObjectNode) run.path("diagnostics").get(0)).set("references", references);
    assertDoesNotThrow(() -> AdvisorDiagnostics.validate(run, "test-local", true));
    ObjectNode wrongOwner = run.deepCopy();
    ((ObjectNode) wrongOwner.path("diagnostics").get(0).path("references").path("evidence"))
        .set("e1", Json.array(List.of("candidate-one", "evidence-two")));
    assertThrows(
        IllegalArgumentException.class,
        () -> AdvisorDiagnostics.validate(wrongOwner, "test-local", true));
    ObjectNode outsidePool = run.deepCopy();
    ((ObjectNode) outsidePool.path("diagnostics").get(0).path("references").path("candidates"))
        .put("c1", "lab-case-outside-model-pool");
    assertThrows(
        IllegalArgumentException.class,
        () -> AdvisorDiagnostics.validate(outsidePool, "test-local", true));
    ObjectNode badAlias = run.deepCopy();
    ((ObjectNode) badAlias.path("diagnostics").get(0).path("references").path("questions"))
        .put("q7", "question-one");
    assertThrows(
        IllegalArgumentException.class,
        () -> AdvisorDiagnostics.validate(badAlias, "test-local", true));
    assertDoesNotThrow(
        () -> AdvisorDiagnostics.validate(localRun(), "test-local", true),
        "Older records need no reference maps");
  }

  @Test
  void workerDiagnosticsArePreservedInApiRecordsAndAcrossDatabaseReopen() throws Exception {
    ObjectNode seed =
        Json.obj(
            "region",
            "Пусан",
            "evidencePolicy",
            "demo",
            "hotels",
            List.of(
                Json.obj(
                    "id",
                    "h",
                    "name",
                    "Hotel",
                    "rooms",
                    List.of(Json.obj("id", "r", "name", "Room", "capacity", 2, "demo", true)))),
            "facts",
            List.of());
    ObjectNode trip =
        Json.obj(
            "region",
            "Пусан",
            "checkIn",
            "2027-06-10",
            "checkOut",
            "2027-06-17",
            "adults",
            2,
            "children",
            0,
            "scenarios",
            List.of(),
            "preferences",
            List.of(),
            "text",
            "");
    String id;
    Path database = directory.resolve("advisor.sqlite3");
    try (Store store = new Store(database.toString(), seed)) {
      SearchService search =
          new SearchService(
              store,
              new Agents(Agents.Config.from(Map.of())),
              new Environment(directory.resolve("air.json"), directory.resolve("noise.json")));
      try (AdvisorService advisor =
          new AdvisorService(
              store,
              search,
              Map.of("ADVISOR_LOCAL_MODEL", "test-local"),
              (context, mode, progress) -> {
                ObjectNode result = localRun();
                result.remove("mode");
                result.set(
                    "report",
                    Json.obj(
                        "outcome",
                        "shortlist",
                        "summary",
                        "Проверенный результат",
                        "candidateIds",
                        List.of("h::r"),
                        "scenarioIds",
                        List.of(),
                        "questionId",
                        null,
                        "cautions",
                        List.of(),
                        "nextSteps",
                        List.of()));
                result.put("inputTokens", 50).put("outputTokens", 10);
                return result;
              })) {
        String searchId = Json.str(search.search(trip), "searchId");
        id =
            Json.str(
                advisor.start(Json.obj("trip", trip, "searchId", searchId, "mode", "local")), "id");
        long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
        while (List.of("queued", "running").contains(Json.str(advisor.get(id), "status"))
            && System.nanoTime() < deadline) Thread.sleep(5);
        JsonNode completed = advisor.get(id);
        assertEquals("completed", Json.str(completed, "status"));
        assertEquals("local", Json.str(completed, "execution"));
        assertEquals(localRun().path("diagnostics"), completed.path("diagnostics"));
        assertEquals(completed.path("diagnostics"), advisor.list().get(0).path("diagnostics"));
      }
    }
    try (Store reopened = new Store(database.toString(), seed)) {
      assertEquals(localRun().path("diagnostics"), reopened.advisorRun(id).path("diagnostics"));
      assertEquals("local", Json.str(reopened.advisorRun(id), "execution"));
    }
  }
}
