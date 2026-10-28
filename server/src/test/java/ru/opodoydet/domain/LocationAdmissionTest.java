package ru.opodoydet.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

class LocationAdmissionTest {
  private ObjectNode match() {
    ObjectNode room = Json.obj("room", Json.obj("id", "unit", "name", "Synthetic unit"),
        "status", "fits", "provisional", false, "score", 0, "criteria", List.of(),
        "capacityStatus", "match", "capacityEvidenceStatus", "match");
    return Json.obj("hotel", Json.obj("id", "test-building", "accountListingId", "test-listing"),
        "rooms", List.of(room), "best", room.deepCopy());
  }

  private JsonNode condition(String status, boolean required) {
    return Json.obj("id", "near-cafe", "query", "кафе", "label", "Кафе рядом", "required", required,
        "status", status, "evidenceStatus", status);
  }

  @Test
  void requiredUnknownIsOnlyProvisionalInExploreAndNeverAnExactRecommendation() {
    ObjectNode original = match();
    ObjectNode explore = LocationAdmission.apply(original, List.of(condition("unknown", true)), Json.obj("admissionMode", "explore"));
    assertEquals("fits", explore.path("best").path("status").asText());
    assertTrue(explore.path("best").path("provisional").asBoolean());
    assertFalse(original.has("locationCriteria"));
    assertEquals(0, original.path("best").path("score").asInt());
    var selection = RoomRecommendations.select(List.of(explore), Instant.now(), "verified-only");
    assertTrue(selection.recommendations().isEmpty());
    assertEquals(1, selection.alternatives().size());
    assertEquals(explore.path("locationCriteria"), selection.alternatives().getFirst().path("locationCriteria"));
    ObjectNode verified = LocationAdmission.apply(original, List.of(condition("unknown", true)), Json.obj("admissionMode", "verified"));
    assertEquals("excluded", verified.path("best").path("status").asText());
    assertTrue(RoomRecommendations.select(List.of(verified), Instant.now(), "verified-only").alternatives().isEmpty());
  }

  @Test
  void knownRequiredMismatchCannotReenterThroughAlternatives() {
    ObjectNode result = LocationAdmission.apply(match(), List.of(condition("mismatch", true)), Json.obj("admissionMode", "explore"));
    var selection = RoomRecommendations.select(List.of(result), Instant.now(), "verified-only");
    assertTrue(selection.recommendations().isEmpty());
    assertTrue(selection.alternatives().isEmpty());
    assertEquals("excluded", result.path("best").path("status").asText());
  }

  @Test
  void optionalLocationFailureRemainsAnAlternativeAndCannotUndoRoomExclusion() {
    ObjectNode result = LocationAdmission.apply(match(), List.of(condition("mismatch", false)), Json.obj("admissionMode", "explore"));
    assertEquals(1, RoomRecommendations.select(List.of(result), Instant.now(), "verified-only").alternatives().size());
    ObjectNode excluded = match();
    ((ObjectNode) excluded.path("rooms").get(0)).put("status", "excluded");
    result = LocationAdmission.apply(excluded, List.of(condition("match", true)), Json.obj("admissionMode", "explore"));
    assertEquals("excluded", result.path("best").path("status").asText());
  }

  @Test
  void allSourcedLocationsAreIncludedInExactRoomRecommendations() {
    ObjectNode result = LocationAdmission.apply(match(), List.of(condition("match", true)), Json.obj("admissionMode", "verified"));
    var selection = RoomRecommendations.select(List.of(result), Instant.now(), "verified-only");
    assertEquals(1, selection.recommendations().size());
    assertEquals("match", selection.recommendations().getFirst().path("locationCriteria").get(0).path("evidenceStatus").asText());
  }
}
