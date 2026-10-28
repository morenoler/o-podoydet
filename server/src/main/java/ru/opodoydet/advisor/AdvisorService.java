package ru.opodoydet.advisor;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.domain.AdmissionPolicy;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;

/** Runs Python advice against immutable server-calculated facts, with no paid provider. */
public final class AdvisorService implements AutoCloseable {
  @FunctionalInterface
  public interface Worker {
    ObjectNode execute(JsonNode context, String mode, Consumer<ObjectNode> progress)
        throws Exception;
  }

  private final Store store;
  private final SearchService search;
  private final Worker worker;
  private final ObjectNode config;
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private Future<?> activeTask;
  private String activeId;
  private boolean closed;

  public AdvisorService(Store store, SearchService search, Map<String, String> env)
      throws SQLException {
    this(store, search, env, new PythonWorker(env));
  }

  public AdvisorService(Store store, SearchService search, Map<String, String> env, Worker worker)
      throws SQLException {
    this.store = store;
    this.search = search;
    this.worker = worker;
    List<String> modes = new ArrayList<>(List.of("rules"));
    String model = env.getOrDefault("ADVISOR_LOCAL_MODEL", "");
    if (!model.isBlank() && !model.toLowerCase(java.util.Locale.ROOT).contains("cloud"))
      modes.add("local");
    config = Json.obj("modes", modes, "defaultMode", "rules", "maxModelCalls", 2, "model", model);
    store.recoverAdvisorRuns();
  }

  public ObjectNode config() {
    return config.deepCopy();
  }

  public JsonNode get(String id) throws SQLException {
    return store.advisorRun(id);
  }

  public JsonNode get(String id, String actor) throws SQLException {
    return store.advisorRun(id, actor);
  }

  public List<JsonNode> list() throws SQLException {
    return store.advisorRuns();
  }

  public List<JsonNode> list(String actor) throws SQLException {
    return store.advisorRuns(actor);
  }

  public synchronized JsonNode start(JsonNode input) throws SQLException {
    return startForActor(input, null);
  }

  public synchronized JsonNode start(JsonNode input, String actor) throws SQLException {
    if (actor == null || actor.isBlank())
      throw new IllegalArgumentException("Не задан владелец запуска помощника.");
    return startForActor(input, actor);
  }

  private JsonNode startForActor(JsonNode input, String actor) throws SQLException {
    if (closed) throw new IllegalStateException("Помощник остановлен.");
    String mode = Validation.text(input, "mode", 1, 20);
    if (Json.list(config.path("modes")).stream().noneMatch(v -> v.asText().equals(mode)))
      throw new IllegalArgumentException("Этот режим помощника не настроен.");
    JsonNode trip = Validation.trip(input.path("trip"), store.forTrip(input.path("trip")).region());
    String searchId = Validation.text(input, "searchId", 1, 100);
    // Authorize the snapshot before duplicate detection: knowing another search/run ID is not
    // access.
    ObjectNode context =
        actor == null
            ? search.advisorContext(trip, searchId)
            : search.advisorContext(trip, searchId, actor);
    if (activeId != null) {
      JsonNode active =
          actor == null ? store.advisorRun(activeId) : store.advisorRun(activeId, actor);
      if (active != null
          && active.path("context").path("trip").equals(trip)
          && Json.str(active.path("context"), "searchId").equals(searchId)
          && Json.str(active, "mode").equals(mode)) return active;
      throw new IllegalStateException(
          active == null
              ? "Помощник сейчас занят. Попробуйте запустить подбор позже."
              : "Помощник уже работает. Дождитесь результата или отмените свой запуск.");
    }
    String now = Instant.now().toString();
    ObjectNode run =
        Json.obj(
            "id",
            UUID.randomUUID().toString(),
            "mode",
            mode,
            "status",
            "queued",
            "createdAt",
            now,
            "updatedAt",
            now,
            "context",
            context,
            "events",
            List.of(),
            "report",
            null,
            "modelCalls",
            0,
            "inputTokens",
            0,
            "outputTokens",
            0,
            "warnings",
            List.of());
    run.put("model", mode.equals("local") ? Json.str(config, "model") : "");
    run.set("diagnostics", Json.array(List.of()));
    if (mode.equals("rules")) run.put("execution", "rules");
    if (actor == null) store.saveAdvisorRun(run);
    else store.createAdvisorRun(run, actor);
    activeId = Json.str(run, "id");
    String id = activeId;
    activeTask = executor.submit(() -> execute(id, context, mode));
    return run.deepCopy();
  }

  private void execute(String id, JsonNode context, String mode) {
    try {
      synchronized (this) {
        if (!id.equals(activeId)) return;
        ObjectNode run = (ObjectNode) store.advisorRun(id);
        run.put("status", "running");
        save(run);
      }
      ObjectNode result = worker.execute(context, mode, update -> update(id, update, false));
      update(id, result, true);
    } catch (Exception error) {
      synchronized (this) {
        if (id.equals(activeId))
          try {
            ObjectNode run = (ObjectNode) store.advisorRun(id);
            run.put("status", "failed")
                .put(
                    "error",
                    "Помощник не завершил работу. Проверьте Python и локальную модель. Платные API"
                        + " не использовались.");
            finishInterruptedDiagnostics(run, "Вызов прерван до получения результата.");
            save(run);
          } catch (SQLException persistenceError) {
            System.err.println("Advisor persistence failed");
          }
      }
      if (error instanceof InterruptedException) Thread.currentThread().interrupt();
    } finally {
      synchronized (this) {
        if (id.equals(activeId)) {
          activeId = null;
          activeTask = null;
        }
      }
    }
  }

  private synchronized void update(String id, ObjectNode update, boolean complete) {
    if (!id.equals(activeId)) return;
    try {
      ObjectNode run = (ObjectNode) store.advisorRun(id);
      if (!Json.str(run, "status").equals("running")) return;
      for (String field :
          List.of(
              "events",
              "report",
              "warnings",
              "modelCalls",
              "inputTokens",
              "outputTokens",
              "execution",
              "model",
              "diagnostics")) if (update.has(field)) run.set(field, update.get(field).deepCopy());
      for (String field : List.of("events", "warnings"))
        if (!run.path(field).isArray() || run.path(field).size() > 100)
          throw new IllegalArgumentException("Invalid advisor output");
      for (String field : List.of("modelCalls", "inputTokens", "outputTokens"))
        if (!run.path(field).isIntegralNumber()
            || !run.path(field).canConvertToInt()
            || run.path(field).asInt() < 0)
          throw new IllegalArgumentException("Invalid advisor usage");
      if (run.path("modelCalls").asInt() > 2)
        throw new IllegalArgumentException("Advisor budget exceeded");
      AdvisorDiagnostics.validateEvents(run);
      AdvisorDiagnostics.validate(run, Json.str(config, "model"), complete);
      if (run.hasNonNull("report"))
        run.set("report", checkedReport(run.path("context"), run.path("report")));
      if (complete) {
        if (!run.hasNonNull("report")) throw new IllegalArgumentException("Missing advisor report");
        run.put("status", "completed");
      }
      save(run);
    } catch (SQLException error) {
      throw new IllegalStateException("Advisor persistence failed", error);
    }
  }

  public static ObjectNode checkedReport(JsonNode context, JsonNode raw) {
    if (!raw.isObject()) throw new IllegalArgumentException("Invalid report");
    ObjectNode report = raw.deepCopy();
    String expected =
        !context.path("conflicts").isEmpty()
            ? "clarification_needed"
            : context.path("fitCount").asInt() > 0 ? "shortlist" : "no_matches";
    if (!Json.str(report, "outcome").equals(expected))
      throw new IllegalArgumentException("Invalid outcome");
    Validation.text(report, "summary", 1, 1800);
    Set<String> candidateIds = references(report, "candidateIds", context.path("candidates"));
    references(report, "scenarioIds", context.path("scenarios"));
    if (candidateIds.size() > 3) throw new IllegalArgumentException("Shortlist is too large");
    if (expected.equals("clarification_needed") && !candidateIds.isEmpty())
      throw new IllegalArgumentException("Hidden relaxation");
    if (expected.equals("shortlist") && candidateIds.isEmpty())
      throw new IllegalArgumentException("Missing shortlist");
    if (!report.path("questionId").isNull()
        && Json.list(context.path("questions")).stream()
            .noneMatch(q -> q.path("id").equals(report.path("questionId"))))
      throw new IllegalArgumentException("Unknown question");
    if (!report.path("nextSteps").isArray() || report.path("nextSteps").size() > 6)
      throw new IllegalArgumentException("Invalid next steps");
    for (JsonNode step : report.path("nextSteps"))
      if (!step.isTextual() || step.asText().length() > 1000)
        throw new IllegalArgumentException("Invalid next step");
    List<JsonNode> cautions = new ArrayList<>();
    boolean selectedProvisional = false;
    boolean roomScope = Json.str(context, "matchingScope").equals("rooms");
    for (JsonNode candidate : context.path("candidates")) {
      if (!candidateIds.contains(Json.str(candidate, "id"))) continue;
      boolean preliminary =
          AdmissionPolicy.explore(context.path("trip"))
              && candidate.path("provisional").asBoolean();
      selectedProvisional |= preliminary;
      if (expected.equals("shortlist")
          && roomScope
          && (Json.str(candidate, "roomId").isBlank()
              || Json.str(candidate, "roomName").isBlank()
              || candidate.path("provisional").asBoolean()
              || Json.list(candidate.path("criteria")).stream()
                  .anyMatch(
                      c ->
                          !Json.str(c, "status").equals("match")
                              || !Json.str(c, "evidenceStatus").equals("match")
                              || (c.path("assumed").asBoolean()
                                  && !Json.str(candidate, "hotelId")
                                      .startsWith("account-listing:")))))
        throw new IllegalArgumentException("Unconfirmed room recommendation");
      if (expected.equals("shortlist")
          && (!Json.str(candidate, "status").equals("fits")
              || Json.list(candidate.path("criteria")).stream()
                  .anyMatch(
                      c ->
                          c.path("required").asBoolean()
                              && (Json.str(c, "evidenceStatus").equals("conflict")
                                  || (!Json.str(c, "status").equals("match")
                                      && !(preliminary
                                          && AdmissionPolicy.permits(c, context.path("trip"))))))))
        throw new IllegalArgumentException("Excluded recommendation");
      if (expected.equals("no_matches") && !Json.str(candidate, "status").equals("excluded"))
        throw new IllegalArgumentException("Invalid excluded alternative");
      List<String> evidence =
          Json.list(candidate.path("criteria")).stream()
              .filter(
                  c ->
                      (c.path("assumed").asBoolean()
                          || !Json.str(c, "evidenceStatus").equals("match")
                          || !Json.str(c, "status").equals("match")))
              .map(c -> Json.str(c, "id"))
              .toList();
      if (!evidence.isEmpty())
        cautions.add(Json.obj("candidateId", candidate.path("id"), "evidenceIds", evidence));
    }
    // Rebuild every risky criterion from server evidence, including optional tradeoffs.
    report.set("cautions", Json.array(cautions));
    if (expected.equals("shortlist") && selectedProvisional)
      report.put(
          "summary",
          "В подборе есть предварительные варианты. Неизвестные или устаревшие условия и"
              + " вместимость требуют уточнения; это не подтверждение соответствия всем"
              + " пожеланиям.");
    String personalNotice =
        ru.opodoydet.application.PersonalWishes.notice(context.path("personalWishes"));
    if (!personalNotice.isBlank() && !Json.str(report, "summary").startsWith(personalNotice)) {
      String summary = Json.str(report, "summary");
      int budget = 1800 - personalNotice.length() - 1;
      if (summary.length() > budget) {
        int end = budget - 1;
        if (Character.isHighSurrogate(summary.charAt(end - 1))) end--;
        summary = summary.substring(0, end).stripTrailing() + "…";
      }
      report.put("summary", personalNotice + " " + summary);
    }
    return report;
  }

  private static Set<String> references(JsonNode report, String field, JsonNode available) {
    if (!report.path(field).isArray() || report.path(field).size() > 8)
      throw new IllegalArgumentException("Invalid references");
    Set<String> known =
        Json.list(available).stream().map(v -> Json.str(v, "id")).collect(Collectors.toSet());
    List<String> values = new ArrayList<>();
    for (JsonNode value : report.path(field)) {
      if (!value.isTextual() || !known.contains(value.asText()) || values.contains(value.asText()))
        throw new IllegalArgumentException("Unknown or repeated reference");
      values.add(value.asText());
    }
    return Set.copyOf(values);
  }

  public synchronized JsonNode cancel(String id) throws SQLException {
    JsonNode existing = store.advisorRun(id);
    return cancelExisting(id, existing);
  }

  public synchronized JsonNode cancel(String id, String actor) throws SQLException {
    return cancelExisting(id, store.advisorRun(id, actor));
  }

  private JsonNode cancelExisting(String id, JsonNode existing) throws SQLException {
    if (existing == null) return null;
    if (!Set.of("queued", "running").contains(Json.str(existing, "status"))) return existing;
    ObjectNode run = existing.deepCopy();
    run.put("status", "cancelled");
    finishInterruptedDiagnostics(run, "Вызов отменён вместе с запуском помощника.");
    save(run);
    if (id.equals(activeId)) {
      activeId = null;
      if (activeTask != null) activeTask.cancel(true);
      activeTask = null;
    }
    return run;
  }

  private void save(ObjectNode run) throws SQLException {
    run.put("updatedAt", Instant.now().toString());
    store.saveAdvisorRun(run);
  }

  private static void finishInterruptedDiagnostics(ObjectNode run, String message) {
    Instant finished = Instant.now();
    for (JsonNode entry : run.path("diagnostics")) {
      if (!entry.isObject() || !Json.str(entry, "status").equals("running")) continue;
      ObjectNode diagnostic = (ObjectNode) entry;
      Instant started = Instant.parse(Json.str(entry, "startedAt"));
      long elapsed =
          Math.max(0, Math.min(420_000, java.time.Duration.between(started, finished).toMillis()));
      diagnostic
          .put("status", "failed")
          .put("finishedAt", finished.toString())
          .put("durationMs", elapsed)
          .put("error", message);
    }
  }

  @Override
  public void close() {
    synchronized (this) {
      closed = true;
      if (activeId != null)
        try {
          cancel(activeId);
        } catch (SQLException error) {
          if (activeTask != null) activeTask.cancel(true);
        }
      executor.shutdownNow();
    }
    try {
      executor.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS);
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
    }
  }
}
