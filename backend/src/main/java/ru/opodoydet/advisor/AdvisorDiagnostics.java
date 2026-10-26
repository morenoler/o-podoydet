package ru.opodoydet.advisor;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.JsonNode;

/** Validates observable model I/O separately from the grounded recommendation contract. */
final class AdvisorDiagnostics {
  private static final Set<String> DIAGNOSTIC_FIELDS =
      Set.of(
          "id",
          "agent",
          "status",
          "startedAt",
          "finishedAt",
          "durationMs",
          "model",
          "input",
          "output",
          "inputTokens",
          "outputTokens",
          "references",
          "error");

  private AdvisorDiagnostics() {}

  static void validate(JsonNode run, String configuredModel, boolean complete) {
    if (run.has("execution")) {
      String execution = Validation.text(run, "execution", 1, 30);
      if (!Set.of("rules", "local", "rules_fallback").contains(execution)
          || (!Json.str(run, "mode").equals("local") && !execution.equals("rules")))
        throw new IllegalArgumentException("Invalid execution mode");
    } else if (complete) throw new IllegalArgumentException("Missing execution result");
    String model = Validation.text(run, "model", 0, 200);
    if (!model.equals(Json.str(run, "mode").equals("local") ? configuredModel : ""))
      throw new IllegalArgumentException("Unexpected advisor model");
    JsonNode diagnostics = run.path("diagnostics");
    if (!diagnostics.isArray() || diagnostics.size() > 2 || bytes(diagnostics) > 160 * 1024)
      throw new IllegalArgumentException("Invalid diagnostic collection");
    Set<String> ids = new HashSet<>(), agents = new HashSet<>();
    for (JsonNode diagnostic : diagnostics) {
      if (!diagnostic.isObject() || bytes(diagnostic) > 64 * 1024)
        throw new IllegalArgumentException("Diagnostic exceeds its size limit");
      diagnostic
          .propertyNames()
          .forEach(
              field -> {
                if (!DIAGNOSTIC_FIELDS.contains(field))
                  throw new IllegalArgumentException("Unknown diagnostic field");
              });
      String id = Validation.text(diagnostic, "id", 1, 100);
      String agent = Validation.text(diagnostic, "agent", 1, 30);
      String status = Validation.text(diagnostic, "status", 1, 30);
      if (!ids.add(id)
          || !agents.add(agent)
          || !Set.of("selector", "critic").contains(agent)
          || !Set.of("running", "completed", "failed").contains(status))
        throw new IllegalArgumentException("Invalid diagnostic identity or status");
      if (!Validation.text(diagnostic, "model", 1, 200).equals(configuredModel)
          || !diagnostic.has("input"))
        throw new IllegalArgumentException("Incomplete diagnostic input");
      Instant started = timestamp(diagnostic, "startedAt");
      if (!status.equals("running")) {
        if (timestamp(diagnostic, "finishedAt").isBefore(started))
          throw new IllegalArgumentException("Invalid diagnostic timestamps");
        integer(diagnostic, "durationMs", 420_000);
      } else if (complete) throw new IllegalArgumentException("Unfinished diagnostic");
      if (diagnostic.has("inputTokens")) integer(diagnostic, "inputTokens", 1_000_000);
      if (diagnostic.has("outputTokens")) integer(diagnostic, "outputTokens", 1_000_000);
      if (status.equals("completed") && !diagnostic.has("output"))
        throw new IllegalArgumentException("Missing model output");
      if (diagnostic.has("error")) Validation.text(diagnostic, "error", 1, 2000);
      if (status.equals("failed") && !diagnostic.has("error"))
        throw new IllegalArgumentException("Missing diagnostic failure");
      if (diagnostic.has("references"))
        validateReferences(diagnostic.path("references"), run.path("context"));
    }
    if (diagnostics.size() > run.path("modelCalls").asInt())
      throw new IllegalArgumentException("Diagnostic call count mismatch");
    if (complete) {
      String execution = Json.str(run, "execution");
      int calls = run.path("modelCalls").asInt();
      if (execution.equals("rules") && (calls != 0 || !diagnostics.isEmpty()))
        throw new IllegalArgumentException("Rules execution cannot hide model calls");
      if (execution.equals("local")
          && (calls != 2
              || diagnostics.size() != 2
              || Json.list(diagnostics).stream()
                  .anyMatch(d -> !Json.str(d, "status").equals("completed"))))
        throw new IllegalArgumentException("Local execution needs two completed model calls");
    }
  }

  static void validateEvents(JsonNode run) {
    for (JsonNode event : run.path("events")) {
      if (!event.isObject()
          || !Set.of("coordinator", "needs", "selector", "critic")
              .contains(Json.str(event, "agent"))
          || !Set.of("running", "completed", "warning").contains(Json.str(event, "status")))
        throw new IllegalArgumentException("Invalid advisor event");
      Validation.text(event, "detail", 1, 2000);
      timestamp(event, "at");
    }
    for (JsonNode warning : run.path("warnings"))
      if (!warning.isTextual() || warning.asText().length() > 2000)
        throw new IllegalArgumentException("Invalid advisor warning");
  }

  private static void validateReferences(JsonNode references, JsonNode context) {
    Set<String> fields = Set.of("candidates", "evidence", "scenarios", "questions");
    if (!references.isObject() || references.size() != fields.size())
      throw new IllegalArgumentException("Invalid diagnostic reference map");
    references
        .propertyNames()
        .forEach(
            field -> {
              if (!fields.contains(field))
                throw new IllegalArgumentException("Unknown reference category");
            });
    Set<String> candidates =
        aliasMap(references.path("candidates"), "c", 8, context.path("candidates"));
    aliasMap(references.path("scenarios"), "s", 6, context.path("scenarios"));
    aliasMap(references.path("questions"), "q", 6, context.path("questions"));
    JsonNode evidence = references.path("evidence");
    if (!evidence.isObject() || evidence.size() > 72)
      throw new IllegalArgumentException("Invalid evidence reference map");
    Set<String> seen = new HashSet<>();
    evidence
        .properties()
        .forEach(
            entry -> {
              alias(entry.getKey(), "e", 72);
              JsonNode pair = entry.getValue();
              if (!pair.isArray()
                  || pair.size() != 2
                  || !pair.get(0).isTextual()
                  || !pair.get(1).isTextual()
                  || !candidates.contains(pair.get(0).asText())
                  || !seen.add(Json.write(pair)))
                throw new IllegalArgumentException("Invalid evidence ownership");
              JsonNode owner =
                  Json.list(context.path("candidates")).stream()
                      .filter(candidate -> Json.str(candidate, "id").equals(pair.get(0).asText()))
                      .findFirst()
                      .orElseThrow();
              if (Json.list(owner.path("criteria")).stream()
                  .noneMatch(criterion -> Json.str(criterion, "id").equals(pair.get(1).asText())))
                throw new IllegalArgumentException(
                    "Evidence does not belong to referenced candidate");
            });
  }

  private static Set<String> aliasMap(
      JsonNode mapping, String prefix, int maximum, JsonNode source) {
    if (!mapping.isObject() || mapping.size() > maximum)
      throw new IllegalArgumentException("Invalid alias map");
    Set<String> available =
        Json.list(source).stream().map(value -> Json.str(value, "id")).collect(Collectors.toSet());
    Set<String> values = new HashSet<>();
    mapping
        .properties()
        .forEach(
            entry -> {
              alias(entry.getKey(), prefix, maximum);
              JsonNode target = entry.getValue();
              if (!target.isTextual()
                  || !available.contains(target.asText())
                  || !values.add(target.asText()))
                throw new IllegalArgumentException("Unknown or duplicated diagnostic reference");
            });
    return values;
  }

  private static void alias(String value, String prefix, int maximum) {
    if (value.length() > 4
        || !value.matches(prefix + "[1-9][0-9]*")
        || Integer.parseInt(value.substring(prefix.length())) > maximum)
      throw new IllegalArgumentException("Invalid diagnostic alias");
  }

  private static int bytes(JsonNode value) {
    return Json.write(value).getBytes(StandardCharsets.UTF_8).length;
  }

  private static Instant timestamp(JsonNode value, String field) {
    try {
      return Instant.parse(Validation.text(value, field, 1, 50));
    } catch (DateTimeParseException error) {
      throw new IllegalArgumentException("Invalid diagnostic time");
    }
  }

  private static void integer(JsonNode value, String field, int max) {
    JsonNode number = value.path(field);
    if (!number.isIntegralNumber()
        || !number.canConvertToInt()
        || number.asInt() < 0
        || number.asInt() > max) throw new IllegalArgumentException("Invalid diagnostic number");
  }
}
