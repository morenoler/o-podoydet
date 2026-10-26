package ru.opodoydet.accounts.clarifications;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDate;
import java.util.*;
import ru.opodoydet.shared.Json;

/** Pure, sanitized projection captured by a search snapshot. Never copies dialogue material. */
public final class ReportedEvidence {
  private ReportedEvidence() {}
  public record Assessment(String status, Boolean value, Set<Boolean> unresolvedValues,
      boolean restrictsPositiveProfile, List<JsonNode> evidence) {}
  public record Decision(String status, Boolean value, List<JsonNode> evidence) {}
  private record Interval(boolean value, LocalDate from, LocalDate to) {}

  /** One combiner is used by public search and private dialogue status. */
  public static Decision combine(Boolean profileValue, boolean profileConflict, Assessment reported) {
    boolean conflict = profileConflict || reported.status().equals("conflict")
        || profileValue != null && reported.unresolvedValues().contains(!profileValue);
    Boolean value = profileValue;
    if (Boolean.TRUE.equals(value) && reported.restrictsPositiveProfile()
        && Set.of("unknown", "stale").contains(reported.status())) value = null;
    if (value == null) value = reported.value();
    String status = conflict ? "conflict" : value != null ? value ? "match" : "mismatch"
        : reported.status().equals("stale") ? "stale" : "unknown";
    return new Decision(status, conflict ? null : value, reported.evidence());
  }

  public static Assessment assess(List<JsonNode> statements, String feature, JsonNode trip) {
    List<JsonNode> evidence = new ArrayList<>();
    Set<Boolean> values = new HashSet<>();
    Set<Boolean> unresolvedValues = new HashSet<>();
    List<Interval> intervals = new ArrayList<>();
    boolean stale = false;
    boolean unresolvedUnknown = false;
    boolean applicableStale = false;
    for (JsonNode statement : statements) {
      if (!Json.str(statement, "feature").equals(feature) || Json.str(statement, "state").equals("superseded")) continue;
      String state = Json.str(statement, "state");
      boolean applicable = statement.path("value").isBoolean() && statement.path("value").asBoolean()
          ? covers(statement, trip) : overlaps(statement, trip);
      String status = state.equals("stale") ? "stale" : !state.equals("active") || !applicable
          || statement.path("value").isNull() ? "unknown" : statement.path("value").asBoolean() ? "match" : "mismatch";
      if (status.equals("match") || status.equals("mismatch")) values.add(statement.path("value").asBoolean());
      // Age alone must not resolve an explicit contradiction; only supersession does that.
      if (Set.of("active", "stale").contains(state) && overlaps(statement, trip) && statement.path("value").isBoolean()) {
        unresolvedValues.add(statement.path("value").asBoolean());
        intervals.add(interval(statement, trip));
      }
      if (Set.of("active", "stale").contains(state) && overlaps(statement, trip) && statement.path("value").isNull())
        unresolvedUnknown = true;
      applicableStale |= state.equals("stale") && overlaps(statement, trip);
      stale |= status.equals("stale");
      evidence.add(Json.obj("method", "owner_response", "provenanceStatus", "reported", "feature", feature,
          "value", statement.path("value"), "evidenceStatus", status, "scope", "listing_unit",
          "scopeId", statement.path("scopeId"), "recordedAt", statement.path("recordedAt"),
          "observedOn", statement.path("observedOn"), "validFrom", statement.path("validFrom"),
          "validTo", statement.path("validTo"), "recheckAt", statement.path("recheckAt")));
    }
    String status = contradicts(intervals) ? "conflict" : values.contains(false) ? "mismatch"
        : values.contains(true) ? unresolvedUnknown ? "unknown" : "match"
        : stale ? "stale" : "unknown";
    return new Assessment(status, status.equals("match") ? Boolean.TRUE : status.equals("mismatch") ? Boolean.FALSE : null,
        Set.copyOf(unresolvedValues), unresolvedUnknown || applicableStale, List.copyOf(evidence));
  }

  private static boolean covers(JsonNode statement, JsonNode trip) {
    if (statement.path("validFrom").isNull() && statement.path("validTo").isNull()) return true;
    try {
      return !LocalDate.parse(Json.str(statement, "validFrom")).isAfter(LocalDate.parse(Json.str(trip, "checkIn")))
          && !LocalDate.parse(Json.str(statement, "validTo")).isBefore(LocalDate.parse(Json.str(trip, "checkOut")));
    } catch (RuntimeException invalid) { return false; }
  }

  private static boolean overlaps(JsonNode statement, JsonNode trip) {
    return interval(statement, trip) != null;
  }

  private static Interval interval(JsonNode statement, JsonNode trip) {
    try {
      // The checkout date is included: access and children policies still apply when leaving.
      LocalDate start = LocalDate.parse(Json.str(trip, "checkIn")), end = LocalDate.parse(Json.str(trip, "checkOut"));
      if (!statement.path("validFrom").isNull()) {
        LocalDate from = LocalDate.parse(Json.str(statement, "validFrom")), to = LocalDate.parse(Json.str(statement, "validTo"));
        if (from.isAfter(start)) start = from;
        if (to.isBefore(end)) end = to;
      }
      return end.isBefore(start) ? null : new Interval(statement.path("value").asBoolean(), start, end);
    } catch (RuntimeException invalid) { return null; }
  }

  private static boolean contradicts(List<Interval> intervals) {
    LocalDate latestYes = null, latestNo = null;
    for (Interval interval : intervals.stream().sorted(Comparator.comparing(Interval::from)).toList()) {
      LocalDate opposite = interval.value() ? latestNo : latestYes;
      if (opposite != null && !opposite.isBefore(interval.from())) return true;
      if (interval.value()) {
        if (latestYes == null || interval.to().isAfter(latestYes)) latestYes = interval.to();
      } else if (latestNo == null || interval.to().isAfter(latestNo)) latestNo = interval.to();
    }
    return false;
  }
}
