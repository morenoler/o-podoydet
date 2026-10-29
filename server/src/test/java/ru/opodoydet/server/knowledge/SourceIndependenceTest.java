package ru.opodoydet.server.knowledge;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.BooleanNode;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class SourceIndependenceTest {
  private static final Instant NOW = Instant.parse("2026-10-29T00:00:00Z");
  private static Evidence evidence(String id, String url, boolean value) {
    return Evidence.of(id, "courtyard", BooleanNode.valueOf(value), "geo", url,
        "medium", NOW.minusSeconds(60), NOW.plusSeconds(86400), false);
  }
  private static Resolution.Outcome resolve(Evidence... evidence) {
    return Resolution.compute(List.of(evidence), 30, Map.of("geo", 0.8), NOW, false);
  }

  @Test void duplicatePagesFromOnePublisherCannotIncreaseConfidence() {
    Evidence original = evidence("original", "https://www.example.org/rooms", true);
    Evidence copy = evidence("copy", "https://example.org/rooms?language=en#view", true);
    assertEquals(resolve(original).confidence(), resolve(original, copy).confidence());
    assertEquals(List.of("original", "copy"), resolve(original, copy).evidenceIds());
  }

  @Test void declaredAggregatorProvenanceAndOsmMirrorCountAsOneSource() {
    Evidence original = evidence("osm", "https://www.openstreetmap.org/way/123", true);
    Evidence copy = evidence("copy", "https://aggregator.example/hotel", true);
    ReflectionTestUtils.setField(copy, "raw",
        "{\"provenance\":{\"originalSourceUrl\":\"https://openstreetmap.org/way/123\"}}");
    Evidence mirror = evidence("mirror", "https://overpass-api.de/api/interpreter", true);
    assertEquals(resolve(original).confidence(), resolve(original, copy, mirror).confidence());
  }

  @Test void independentPublisherStillAddsEvidence() {
    Evidence a = evidence("a", "https://example.org/report", true);
    Evidence b = evidence("b", "https://survey.example/report", true);
    assertTrue(resolve(a, b).confidence() > resolve(a).confidence());
  }

  @Test void conflictingCopiesRemainAConflict() {
    Resolution.Outcome result = resolve(evidence("a", "https://example.org/1", true),
        evidence("b", "https://example.org/2", false));
    assertEquals(Fact.Status.conflict, result.status());
    assertEquals(List.of("a", "b"), result.evidenceIds());
  }

  @Test void repeatedAnswersFromOneOwnerDoNotImplyIndependentWitnesses() {
    Evidence a = evidence("a", null, true), b = evidence("b", null, true);
    ReflectionTestUtils.setField(a, "method", "host");
    ReflectionTestUtils.setField(b, "method", "host");
    var one = Resolution.compute(List.of(a), 30, Map.of("host", 0.7), NOW, false);
    var two = Resolution.compute(List.of(a, b), 30, Map.of("host", 0.7), NOW, false);
    assertEquals(one.confidence(), two.confidence());
  }
}
