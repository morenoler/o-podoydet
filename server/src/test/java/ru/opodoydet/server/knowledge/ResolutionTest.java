package ru.opodoydet.server.knowledge;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.NullNode;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ResolutionTest {

  static final Instant NOW = Instant.parse("2026-10-26T12:00:00Z");
  static final Map<String, Double> PRIORS =
      Map.of("official", 0.9, "geo", 0.8, "host", 0.7, "agent", 0.5, "demo", 0.0);
  static final String URL = "https://hotel.example/rooms";

  static Evidence ev(String id, JsonNode value, String method, String level) {
    return Evidence.of(
        id, "courtyard", value, method, URL, level, NOW.minus(2, ChronoUnit.DAYS),
        NOW.plus(28, ChronoUnit.DAYS), false);
  }

  static Resolution.Outcome resolve(Evidence... evidence) {
    return Resolution.compute(List.of(evidence), 30, PRIORS, NOW, false);
  }

  @Test
  void agreeingSourcesConfirmAndStrengthenEachOther() {
    Resolution.Outcome one = resolve(ev("a", BooleanNode.TRUE, "official", "medium"));
    Resolution.Outcome two =
        resolve(
            ev("a", BooleanNode.TRUE, "official", "medium"),
            ev("b", BooleanNode.TRUE, "geo", "medium"));

    assertThat(one.status()).isEqualTo(Fact.Status.confirmed);
    assertThat(one.confidence()).isCloseTo(0.63, org.assertj.core.data.Offset.offset(0.001));
    assertThat(two.status()).isEqualTo(Fact.Status.confirmed);
    assertThat(two.confidence()).isGreaterThan(one.confidence());
    assertThat(two.evidenceIds()).containsExactly("a", "b");
  }

  @Test
  void disagreeingSourcesBecomeConflictWithReducedConfidence() {
    Resolution.Outcome outcome =
        resolve(
            ev("official", BooleanNode.FALSE, "official", "high"),
            ev("host", BooleanNode.TRUE, "host", "low"));

    assertThat(outcome.status()).isEqualTo(Fact.Status.conflict);
    assertThat(outcome.value()).isEqualTo(BooleanNode.FALSE); // официальный источник весит больше
    assertThat(outcome.confidence()).isLessThan(0.9 * 0.9);
    assertThat(outcome.conflictReason()).contains("расходятся");
  }

  @Test
  void expiredEvidenceMakesFactStaleInsteadOfConfirmed() {
    Evidence old =
        Evidence.of(
            "old", "beach_walk", IntNode.valueOf(36), "geo", URL, "medium",
            NOW.minus(60, ChronoUnit.DAYS), NOW.minus(1, ChronoUnit.DAYS), false);

    Resolution.Outcome outcome = Resolution.compute(List.of(old), 30, PRIORS, NOW, false);

    assertThat(outcome.status()).isEqualTo(Fact.Status.stale);
    assertThat(outcome.value()).isEqualTo(IntNode.valueOf(36));
    assertThat(outcome.confidence()).isZero();
  }

  @Test
  void ttlOfCharacteristicAppliesWhenSourceHasNoExpiry() {
    Evidence noExpiry =
        Evidence.of(
            "e", "courtyard", BooleanNode.TRUE, "official", URL, "high",
            NOW.minus(10, ChronoUnit.DAYS), null, false);

    assertThat(Resolution.compute(List.of(noExpiry), 30, PRIORS, NOW, false).status())
        .isEqualTo(Fact.Status.confirmed);
    assertThat(Resolution.compute(List.of(noExpiry), 7, PRIORS, NOW, false).status())
        .isEqualTo(Fact.Status.stale);
  }

  @Test
  void partialSourcesWithoutValueGiveUnknownButKeepTheTrail() {
    Resolution.Outcome outcome = resolve(ev("partial", NullNode.instance, "official", "low"));

    assertThat(outcome.status()).isEqualTo(Fact.Status.unknown);
    assertThat(outcome.value()).isNull();
    assertThat(outcome.evidenceIds()).containsExactly("partial");
  }

  @Test
  void demoAndUnsourcedEvidenceIsIgnored() {
    Evidence demo =
        Evidence.of("demo", "courtyard", BooleanNode.TRUE, "official", URL, "high",
            NOW.minus(1, ChronoUnit.DAYS), null, true);
    Evidence noUrl =
        Evidence.of("nourl", "courtyard", BooleanNode.TRUE, "official", "ftp://x", "high",
            NOW.minus(1, ChronoUnit.DAYS), null, false);
    Evidence future =
        Evidence.of("future", "courtyard", BooleanNode.TRUE, "official", URL, "high",
            NOW.plus(1, ChronoUnit.DAYS), null, false);

    Resolution.Outcome outcome = Resolution.compute(List.of(demo, noUrl, future), 30, PRIORS, NOW, false);

    assertThat(outcome.status()).isEqualTo(Fact.Status.unknown);
    assertThat(outcome.evidenceIds()).isEmpty();
  }

  @Test
  void hostAnswerWithoutUrlIsAdmissibleInNewCoreButNotInLegacyView() {
    Evidence host =
        Evidence.of("host", "courtyard", BooleanNode.TRUE, "host", null, "medium",
            NOW.minus(1, ChronoUnit.DAYS), null, false);

    assertThat(EvidencePolicy.admissible(host, NOW, false)).isTrue();
    assertThat(EvidencePolicy.legacyAdmissible(host, NOW, false)).isFalse();
  }
}
