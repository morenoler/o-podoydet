package ru.opodoydet.server.knowledge;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.BooleanNode;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ResolutionNullConfidenceTest {
  @Test void optionalMissingConfidenceUsesDocumentedDefaultWithoutDiscardingEvidence() {
    Instant now = Instant.parse("2026-10-26T12:00:00Z");
    for (String confidence : java.util.Arrays.asList(null, "unspecified")) {
      Evidence evidence = Evidence.of("known", "courtyard", BooleanNode.TRUE, "official",
          "https://example.test/source", confidence, now.minusSeconds(60), now.plusSeconds(86400), false);
      Resolution.Outcome outcome = Resolution.compute(List.of(evidence), 30, Map.of("official", 0.9), now, false);
      assertEquals(Fact.Status.confirmed, outcome.status());
      assertEquals(BooleanNode.TRUE, outcome.value());
      assertEquals(0.45, outcome.confidence(), 0.000001);
      assertEquals(List.of("known"), outcome.evidenceIds());
    }
  }
}
