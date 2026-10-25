package ru.opodoydet.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Set;
import ru.opodoydet.shared.Json;

/** Admission can be provisional; evidence is never rewritten to make a room fit. */
public final class AdmissionPolicy {
  private AdmissionPolicy() {}

  public static boolean explore(JsonNode trip) {
    return Json.str(trip, "admissionMode").equals("explore");
  }

  public static boolean permits(String status, String evidence, JsonNode trip) {
    if (evidence.equals("conflict")) return false;
    return status.equals("match") || (explore(trip) && Set.of("unknown", "stale").contains(evidence));
  }

  public static boolean permits(JsonNode criterion, JsonNode trip) {
    return permits(Json.str(criterion, "status"), Json.str(criterion, "evidenceStatus"), trip);
  }

  public static ObjectNode decide(JsonNode capacity, List<JsonNode> criteria, JsonNode trip) {
    List<JsonNode> mandatory = criteria.stream().filter(c -> c.path("required").asBoolean()).toList();
    boolean fits = permits(Json.str(capacity, "capacityStatus"),
        Json.str(capacity, "capacityEvidenceStatus"), trip) && mandatory.stream().allMatch(c -> permits(c, trip));
    boolean provisional = fits && (!Json.str(capacity, "capacityStatus").equals("match") ||
        mandatory.stream().anyMatch(c -> !Json.str(c, "status").equals("match")));
    return Json.obj("status", fits ? "fits" : "excluded", "provisional", provisional);
  }
}
