package ru.opodoydet.accounts.clarifications;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.accounts.search.OwnerListingSearchProvider;
import ru.opodoydet.application.*;
import ru.opodoydet.shared.Json;

/**
 * Deterministic domain properties, with a day-by-day reference model independent of the production
 * interval sweep. These check declared-evidence logic, not the factual truth of owner statements.
 */
class ReportedEvidencePropertiesTest {
  @TempDir Path temp;
  private static final List<String> FEATURES = List.of("family", "courtyard", "step_free_access");
  private static final List<String> STATES = List.of("active", "stale", "scope_changed", "superseded");
  private static final List<Boolean> VALUES = Arrays.asList(true, false, null);
  private static final LocalDate START = LocalDate.of(2026, 11, 1);
  private static final ObjectNode TRIP = ClarificationServiceTest.trip("courtyard");
  private static final List<Period> PERIODS = List.of(
      new Period(null, null), new Period(-2, 6), new Period(1, 2), new Period(-4, -1),
      new Period(5, 8), new Period(0, 0), new Period(4, 4), new Period(0, 2), new Period(3, 4));
  private static final Set<String> PUBLIC_FIELDS = Set.of("method", "provenanceStatus", "feature", "value",
      "evidenceStatus", "scope", "scopeId", "recordedAt", "observedOn", "validFrom", "validTo", "recheckAt");

  private record Period(Integer from, Integer to) {
    boolean contains(int day) { return from == null || day >= from && day <= to; }
  }
  private record Statement(Boolean value, String state, Period period) {
    ObjectNode json(String feature) {
      return Json.obj("id", "PRIVATE_STATEMENT_ID", "text", "PRIVATE_DIALOGUE_TEXT", "userId", "PRIVATE_USER_ID",
          "feature", feature, "value", value, "state", state, "scope", "listing_unit", "scopeId", "unit-A",
          "recordedAt", "2026-10-25T12:00:00Z", "observedOn", null, "recheckAt", "2026-11-24T15:00:00Z",
          "validFrom", period.from == null ? null : START.plusDays(period.from).toString(),
          "validTo", period.to == null ? null : START.plusDays(period.to).toString());
    }
    boolean unresolved() { return state.equals("active") || state.equals("stale"); }
  }
  private record Reference(String status, Set<Boolean> unresolved) {}

  private static List<Statement> examples() {
    List<Statement> result = new ArrayList<>();
    for (Boolean value : VALUES) for (String state : STATES) for (Period period : PERIODS)
      result.add(new Statement(value, state, period));
    return result;
  }

  private static Reference reference(List<Statement> claims) {
    boolean negative = false, uncertainty = false, fullPositive = false, stale = false;
    Set<Boolean> unresolved = new HashSet<>();
    for (int day = 0; day <= 4; day++) {
      Set<Boolean> currentDay = new HashSet<>();
      for (Statement claim : claims) {
        if (!claim.unresolved() || !claim.period.contains(day)) continue;
        if (claim.value == null) uncertainty = true;
        else {
          unresolved.add(claim.value);
          currentDay.add(claim.value);
          if (claim.state.equals("active") && !claim.value) negative = true;
        }
      }
      // Opposite claims must concern at least one shared stay date, not disjoint periods.
      if (currentDay.size() == 2) return new Reference("conflict", unresolvedForAllDays(claims));
    }
    for (Statement claim : claims) {
      stale |= claim.state.equals("stale");
      if (!claim.state.equals("active") || !Boolean.TRUE.equals(claim.value)) continue;
      boolean everyDay = true;
      for (int day = 0; day <= 4; day++) everyDay &= claim.period.contains(day);
      fullPositive |= everyDay;
    }
    String status = negative ? "mismatch" : fullPositive ? uncertainty ? "unknown" : "match" : stale ? "stale" : "unknown";
    return new Reference(status, unresolved);
  }

  private static Set<Boolean> unresolvedForAllDays(List<Statement> claims) {
    Set<Boolean> values = new HashSet<>();
    for (int day = 0; day <= 4; day++) for (Statement claim : claims)
      if (claim.unresolved() && claim.value != null && claim.period.contains(day)) values.add(claim.value);
    return values;
  }

  private static Boolean expectedValue(String status) {
    return switch (status) { case "match" -> Boolean.TRUE; case "mismatch" -> Boolean.FALSE; default -> null; };
  }

  private static void compare(Reference expected, ReportedEvidence.Assessment actual, String context) {
    assertEquals(expected.status, actual.status(), context);
    assertEquals(expectedValue(expected.status), actual.value(), context);
    assertEquals(expected.unresolved, actual.unresolvedValues(), context);
  }

  @Test void exhaustiveSingleAndPairMatrixMatchesIndependentCalendarOracleAndIsOrderInvariant() {
    List<Statement> examples = examples();
    int singles = 0, pairs = 0;
    for (String feature : FEATURES) {
      for (Statement first : examples) {
        compare(reference(List.of(first)), ReportedEvidence.assess(List.of(first.json(feature)), feature, TRIP), first.toString());
        singles++;
        for (Statement second : examples) {
          String context = feature + ": " + first + " / " + second;
          Reference expected = reference(List.of(first, second));
          ReportedEvidence.Assessment forward = ReportedEvidence.assess(List.of(first.json(feature), second.json(feature)), feature, TRIP);
          ReportedEvidence.Assessment reverse = ReportedEvidence.assess(List.of(second.json(feature), first.json(feature)), feature, TRIP);
          compare(expected, forward, context);
          compare(expected, reverse, context + " reversed");
          assertEquals(new HashSet<>(forward.evidence()), new HashSet<>(reverse.evidence()), context);
          pairs++;
        }
      }
    }
    assertEquals(324, singles);
    assertEquals(34992, pairs);
  }

  @Test void aFreshNegativeOnAnyStayDayNeverProducesPositiveAdmission() {
    int comparisons = 0;
    for (String feature : FEATURES) for (Statement baseline : examples()) for (Period period : PERIODS) {
      if (!java.util.stream.IntStream.rangeClosed(0, 4).anyMatch(period::contains)) continue;
      Statement negative = new Statement(false, "active", period);
      var result = ReportedEvidence.assess(List.of(baseline.json(feature), negative.json(feature)), feature, TRIP);
      assertTrue(Set.of("mismatch", "conflict").contains(result.status()), baseline + " + " + period);
      assertNotEquals(Boolean.TRUE, result.value());
      comparisons++;
    }
    assertEquals(2268, comparisons);
  }

  @Test void otherFeaturesAndObsoleteScopesCannotChangeCurrentEvidence() {
    int comparisons = 0;
    for (String feature : FEATURES) for (Statement baseline : examples()) {
      var expected = ReportedEvidence.assess(List.of(baseline.json(feature)), feature, TRIP);
      for (String other : FEATURES) if (!other.equals(feature)) for (Boolean value : VALUES) {
        var ignored = new Statement(value, "active", PERIODS.getFirst()).json(other);
        var actual = ReportedEvidence.assess(List.of(ignored, baseline.json(feature)), feature, TRIP);
        assertEquals(expected, actual);
        comparisons++;
      }
      for (String obsolete : List.of("scope_changed", "superseded")) for (Boolean value : VALUES) {
        var ignored = new Statement(value, obsolete, PERIODS.getFirst()).json(feature);
        var actual = ReportedEvidence.assess(List.of(ignored, baseline.json(feature)), feature, TRIP);
        assertEquals(expected.status(), actual.status());
        assertEquals(expected.value(), actual.value());
        assertEquals(expected.unresolvedValues(), actual.unresolvedValues());
        comparisons++;
      }
    }
    assertEquals(3888, comparisons);
  }

  @Test void obsoleteReportsDoNotDowngradeCurrentPositiveProfileButApplicableUnknownsDo() {
    for (Boolean value : VALUES) for (String state : List.of("scope_changed", "superseded")) {
      var assessment = ReportedEvidence.assess(List.of(new Statement(value, state, PERIODS.getFirst()).json("courtyard")), "courtyard", TRIP);
      assertEquals("match", ReportedEvidence.combine(true, false, assessment).status(), state + ":" + value);
    }
    for (String state : List.of("active", "stale")) {
      var assessment = ReportedEvidence.assess(List.of(new Statement(null, state, PERIODS.getFirst()).json("courtyard")), "courtyard", TRIP);
      assertNotEquals("match", ReportedEvidence.combine(true, false, assessment).status());
    }
    for (String state : List.of("active", "stale")) for (Boolean value : VALUES) {
      var assessment = ReportedEvidence.assess(List.of(new Statement(value, state, new Period(5, 8)).json("courtyard")), "courtyard", TRIP);
      assertEquals("match", ReportedEvidence.combine(true, false, assessment).status(), "Outside trip: " + state + value);
    }
  }

  @Test void publicProjectionHasOnlyAllowlistedFieldsAndNeverMutatesOrLeaksInput() {
    for (String feature : FEATURES) for (Statement statement : examples()) {
      ObjectNode input = statement.json(feature), before = input.deepCopy();
      var result = ReportedEvidence.assess(List.of(input), feature, TRIP);
      assertEquals(before, input);
      for (JsonNode evidence : result.evidence()) {
        Set<String> fields = new HashSet<>(); evidence.fieldNames().forEachRemaining(fields::add);
        assertEquals(PUBLIC_FIELDS, fields);
        assertFalse(evidence.toString().contains("PRIVATE_"));
        assertEquals("owner_response", Json.str(evidence, "method"));
        assertEquals("reported", Json.str(evidence, "provenanceStatus"));
      }
    }
  }

  @Test void exhaustiveTwentySevenUnitsKeepEveryMandatoryCombinationInsideItsOwnUnit() throws Exception {
    Clock clock = ClarificationServiceTest.CLOCK;
    try (AccountDatabase db = new AccountDatabase(temp.resolve("unit-combinations.sqlite3").toString())) {
      for (String user : List.of("host", "guest"))
        db.execute("INSERT INTO account_users(id,email,password_hash,role,name,created_at) VALUES(?,?,?,?,?,?)",
            user, user + "@example.test", "unused", user.equals("host") ? "host" : "user", user, clock.instant().toString());
      ListingService listings = new ListingService(db);
      ClarificationService clarifications = new ClarificationService(db, listings, clock);
      Map<String, List<Boolean>> units = new LinkedHashMap<>();
      for (Boolean family : VALUES) for (Boolean courtyard : VALUES) for (Boolean access : VALUES) {
        String id = Json.str(listings.create("host", ClarificationServiceTest.listing()), "id");
        List<Boolean> claims = Arrays.asList(family, courtyard, access); units.put(id, claims);
        for (int index = 0; index < FEATURES.size(); index++) {
          JsonNode question = clarifications.ask("guest", id, ClarificationServiceTest.request(FEATURES.get(index)));
          clarifications.answer("host", Json.str(question, "id"), ClarificationServiceTest.response(0, claims.get(index)));
        }
      }
      OwnerListingSearchProvider provider = new OwnerListingSearchProvider(db, clock);
      int checked = 0;
      for (String mode : List.of("explore", "verified")) for (int subset = 1; subset < 8; subset++) {
        List<JsonNode> preferences = new ArrayList<>();
        for (int index = 0; index < FEATURES.size(); index++) if ((subset & 1 << index) != 0)
          preferences.add(Json.obj("feature", FEATURES.get(index), "required", true));
        ObjectNode trip = TRIP.deepCopy().put("admissionMode", mode); trip.set("preferences", Json.array(preferences));
        var results = provider.snapshot(trip).apply(List.of(), preferences);
        assertEquals(27, results.size());
        for (JsonNode result : results) {
          String id = Json.str(result.path("hotel"), "accountListingId");
          List<Boolean> values = units.get(id);
          boolean admitted = true, unknown = false;
          for (int index = 0; index < FEATURES.size(); index++) if ((subset & 1 << index) != 0) {
            Boolean value = values.get(index);
            admitted &= Boolean.TRUE.equals(value) || value == null && mode.equals("explore");
            unknown |= value == null;
          }
          assertEquals(admitted ? "fits" : "excluded", Json.str(result.path("best"), "status"), id + mode + subset);
          assertEquals(admitted && unknown, result.path("best").path("provisional").asBoolean());
          assertEquals("account-room:" + id, Json.str(result.path("best").path("room"), "id"));
          for (JsonNode criterion : result.path("best").path("criteria"))
            for (JsonNode evidence : criterion.path("reportedEvidence")) assertEquals(id, Json.str(evidence, "scopeId"));
          checked++;
        }
      }
      assertEquals(378, checked);
    }
  }
}
