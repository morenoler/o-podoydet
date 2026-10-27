package ru.opodoydet.accounts.clarifications;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.accounts.search.OwnerListingSearchProvider;
import ru.opodoydet.application.*;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;
import ru.opodoydet.server.support.TestDatabases;

class ClarificationServiceTest {
  @TempDir Path temp;
  static final Instant NOW = Instant.parse("2026-10-25T12:00:00Z");
  static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
  static final String NOTE = "PRIVATE_GUEST_NOTE_6f73", TEXT = "PRIVATE_OWNER_ANSWER_a8b9", QUERY = "PRIVATE_TRIP_TEXT_0a1b";

  private final class Fixture implements AutoCloseable {
    final TestDatabases.Database database;
    final Store store;
    final AccountDatabase db;
    final ListingService listings;
    final ClarificationService service;
    final SearchService search;
    final String id;
    Fixture() throws Exception {
      database = TestDatabases.create(Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of()));
      store = database.store();
      db = database.accounts();
      for (String user : List.of("host", "otherhost", "guest", "otherguest"))
        db.execute("INSERT INTO account_users(id,email,password_hash,role,name,created_at) VALUES(?,?,?,?,?,?)",
            user, user + "@example.test", "unused", user.contains("host") ? "host" : "user", user, NOW.toString());
      listings = new ListingService(db);
      id = Json.str(listings.create("host", listing()), "id");
      service = new ClarificationService(db, listings, CLOCK);
      search = new SearchService(store, new Agents(Agents.Config.from(Map.of())), new Environment(temp.resolve("none.json"), temp.resolve("none2.json")), CLOCK, new OwnerListingSearchProvider(db, CLOCK));
    }
    ObjectNode ask(String feature) throws Exception { return service.ask("guest", id, request(feature)); }
    ObjectNode answer(JsonNode question, Boolean value) throws Exception { return service.answer("host", Json.str(question, "id"), response(question.path("version").asInt(), value)); }
    JsonNode criterion(String feature, String mode) throws Exception {
      JsonNode result = search.search(trip(feature).put("admissionMode", mode));
      JsonNode match = result.path("results").isEmpty() ? result.path("excluded").get(0) : result.path("results").get(0);
      return match.path("best").path("criteria").get(0);
    }
    public void close() throws Exception { database.close(); }
  }
  static ObjectNode listing() {
    return Json.obj("title", "Объявление для изолированного теста", "description", "Один предлагаемый вариант размещения для проверки уточнений.",
        "city", "Пусан", "address", "Тестовая улица 1", "roomType", "Семейный номер", "capacity", 3,
        "sleepingPlaces", 3, "beds", List.of(Json.obj("type", "single", "count", 3, "placesPerUnit", 1)),
        "pricePerNight", 10000, "amenities", List.of(), "status", "published", "floor", 2, "windowDirections", List.of("south"));
  }
  static ObjectNode trip(String feature) {
    return Json.obj("region", "Пусан", "checkIn", "2026-11-01", "checkOut", "2026-11-05", "adults", 2, "children", 1,
        "scenarios", List.of(), "preferences", List.of(Json.obj("feature", feature, "required", true)), "text", QUERY);
  }
  static ObjectNode request(String feature) {
    return Json.obj("feature", feature, "trip", trip(feature), "note", NOTE, "requestKey", UUID.randomUUID().toString());
  }
  static ObjectNode response(int version, Boolean value) {
    return Json.obj("expectedVersion", version, "requestKey", UUID.randomUUID().toString(), "value", value, "text", TEXT,
        "observedOn", null, "validFrom", null, "validTo", null, "validForDays", 30, "supersedes", List.of());
  }
  static void problem(int status, org.junit.jupiter.api.function.Executable call) {
    assertEquals(status, assertThrows(AccountProblem.class, call).status);
  }

  @Test void privateDialogueDoesNotEnterPublicQaAndHostNeverSeesOriginalTrip() throws Exception {
    try (Fixture f = new Fixture()) {
      ObjectNode question = f.ask("courtyard");
      assertEquals(QUERY, Json.str(f.service.user("guest").getFirst().path("trip"), "text"));
      JsonNode host = f.service.host("host").getFirst();
      assertFalse(host.has("trip"));
      assertFalse(host.toString().contains(QUERY));
      assertTrue(host.toString().contains(NOTE));
      assertEquals(0, f.service.user("otherguest").size());
      assertEquals(0, f.service.host("otherhost").size());
      f.answer(question, true);
      assertEquals(0, f.db.rows("SELECT * FROM account_questions").size());
      assertEquals(0, f.store.facts().size());
    }
  }

  @Test void sochiObservationDateAndRecheckUseMoscowAndPreserveStoredTimezones() throws Exception {
    try (Fixture f = new Fixture()) {
      f.listings.update("host", f.id, listing().put("city", "Сочи"));
      var clock = Clock.fixed(Instant.parse("2026-10-27T18:30:00Z"), ZoneOffset.UTC);
      var service = new ClarificationService(f.db, f.listings, clock);
      var request = request("family");
      request.set("trip", trip("family").put("region", "Сочи"));
      var question = service.ask("guest", f.id, request);
      assertEquals("Сочи", question.path("region").asText());
      assertEquals("Europe/Moscow", question.path("timeZone").asText());
      var invalid = response(0, true).put("observedOn", "2026-10-28");
      problem(400, () -> service.answer("host", question.path("id").asText(), invalid));
      var answered = service.answer("host", question.path("id").asText(), response(0, true).put("observedOn", "2026-10-27"));
      assertEquals("2026-11-25T21:00:00Z", answered.path("answer").path("recheckAt").asText());
      assertEquals("Europe/Moscow", answered.path("answer").path("timeZone").asText());
      var projected = new OwnerListingSearchProvider(f.db, clock).snapshot(request.path("trip"))
          .apply(List.of(), List.of(Json.obj("feature", "family", "required", true))).getFirst();
      assertEquals("Europe/Moscow", projected.path("best").path("criteria").get(0).path("reportedEvidence").get(0).path("timeZone").asText());
      // A later city edit invalidates scope but cannot rewrite the historical timestamp or zone.
      f.listings.update("host", f.id, listing());
      var historical = service.host("host").getFirst().path("history").get(0);
      assertEquals("2026-11-25T21:00:00Z", historical.path("recheckAt").asText());
      assertEquals("Europe/Moscow", historical.path("timeZone").asText());
    }
  }

  @Test void booleanAndUnknownAnswerStatesRespectBothAdmissionModesForEverySupportedFeature() throws Exception {
    for (String feature : ClarificationService.FEATURES) for (Boolean value : Arrays.asList(true, false, null)) {
      try (Fixture f = new Fixture()) {
        JsonNode question = f.ask(feature);
        f.answer(question, value);
        for (String mode : List.of("explore", "verified")) {
          JsonNode result = f.search.search(trip(feature).put("admissionMode", mode));
          boolean admitted = Boolean.TRUE.equals(value) || value == null && mode.equals("explore");
          assertEquals(admitted ? 1 : 0, result.path("results").size(), feature + value + mode);
          JsonNode match = result.path(admitted ? "results" : "excluded").get(0);
          assertEquals(admitted && value == null, match.path("best").path("provisional").asBoolean());
          JsonNode criterion = match.path("best").path("criteria").get(0);
          assertEquals(value == null ? "unknown" : value ? "match" : "mismatch", Json.str(criterion, "evidenceStatus"));
          assertTrue(criterion.path("assumed").asBoolean());
          assertEquals("reported", Json.str(criterion.path("reportedEvidence").get(0), "provenanceStatus"));
        }
      }
    }
  }

  @Test void sanitizedSearchAndAdvisorContainNoDialogueCanariesOrQuestionAndAnswerIds() throws Exception {
    try (Fixture f = new Fixture()) {
      JsonNode question = f.ask("courtyard"), answered = f.answer(question, true);
      ObjectNode query = trip("courtyard");
      JsonNode result = f.search.search(query), advisor = f.search.advisorContext(query, Json.str(result, "searchId"));
      for (JsonNode publicDto : List.of(result, advisor, Json.array(f.listings.published())))
        for (String forbidden : List.of(NOTE, TEXT, Json.str(question, "id"), Json.str(answered.path("answer"), "id"), "guest@example.test"))
          assertFalse(publicDto.toString().contains(forbidden), forbidden);
      assertTrue(result.path("results").get(0).path("best").path("criteria").get(0).path("facts").isEmpty());
    }
  }

  @Test void sameDialogueRevisionReplacesButPreservesHistoryAndUnknownDoesNotReviveOldPositive() throws Exception {
    try (Fixture f = new Fixture()) {
      JsonNode question = f.ask("courtyard"), first = f.answer(question, true);
      JsonNode second = f.answer(first, null);
      assertEquals(2, second.path("version").asInt());
      assertEquals(2, second.path("history").size());
      assertEquals("superseded", Json.str(second.path("history").get(0), "state"));
      assertEquals(TEXT, Json.str(second.path("history").get(0), "text"));
      assertEquals("unknown", Json.str(f.criterion("courtyard", "explore"), "evidenceStatus"));
      assertEquals(1, f.criterion("courtyard", "explore").path("reportedEvidence").size());
    }
  }

  @Test void crossDialogueConflictNeedsExplicitSupersessionAndExpiryDoesNotResolveIt() throws Exception {
    try (Fixture f = new Fixture()) {
      JsonNode yes = f.answer(f.ask("courtyard"), true), noQuestion = f.ask("courtyard");
      JsonNode no = f.service.answer("host", Json.str(noQuestion, "id"), response(0, false).put("observedOn", "2026-08-01"));
      assertEquals("conflict", Json.str(f.criterion("courtyard", "explore"), "evidenceStatus"));
      assertEquals("mismatch", Json.str(f.criterion("courtyard", "explore"), "status"));
      ObjectNode resolve = response(1, true);
      resolve.set("supersedes", Json.array(List.of(Json.str(yes.path("answer"), "id"))));
      f.service.answer("host", Json.str(no, "id"), resolve);
      assertEquals("match", Json.str(f.criterion("courtyard", "verified"), "evidenceStatus"));
      assertEquals("superseded", Json.str(f.service.user("guest").stream().filter(q -> Json.str(q, "id").equals(Json.str(yes, "id"))).findFirst().orElseThrow().path("answer"), "state"));
    }
  }

  @Test void privateProfileContradictionCannotBeSilentlyOverwrittenByNewPublicProjection() throws Exception {
    try (Fixture f = new Fixture()) {
      ObjectNode listing = listing();
      listing.set("searchProfile", Json.obj("notes", "Окна на улицу. PRIVATE_PROFILE_CANARY"));
      f.listings.update("host", f.id, listing);
      f.answer(f.ask("courtyard"), true);
      JsonNode criterion = f.criterion("courtyard", "explore");
      assertEquals("conflict", Json.str(criterion, "evidenceStatus"));
      assertFalse(criterion.toString().contains("PRIVATE_PROFILE_CANARY"));
    }
  }

  @Test void explicitUnknownOrExpiredClarificationCannotBeConfirmedByTimelessPositiveProfile() throws Exception {
    try (Fixture f = new Fixture()) {
      ObjectNode listing = listing(); listing.set("searchProfile", Json.obj("notes", "Все окна во двор."));
      f.listings.update("host", f.id, listing);
      JsonNode q = f.ask("courtyard"); f.answer(q, null);
      assertEquals("unknown", Json.str(f.criterion("courtyard", "verified"), "evidenceStatus"));
      f.service.answer("host", Json.str(q, "id"), response(1, true).put("observedOn", "2026-08-01"));
      assertEquals("stale", Json.str(f.criterion("courtyard", "verified"), "evidenceStatus"));
    }
  }

  @Test void newSearchChangesButPreviouslyCapturedAdvisorSnapshotRemainsIdentical() throws Exception {
    try (Fixture f = new Fixture()) {
      ObjectNode query = trip("courtyard").put("admissionMode", "explore");
      JsonNode old = f.search.search(query), context = f.search.advisorContext(query, Json.str(old, "searchId"));
      f.answer(f.ask("courtyard"), false);
      assertEquals(context, f.search.advisorContext(query, Json.str(old, "searchId")));
      assertEquals(0, f.search.search(query).path("results").size());
      assertEquals(1, old.path("results").size());
    }
  }

  @Test void idempotentAskAndAnswerReplayDoNotDuplicateAndChangedPayloadGetsConflict() throws Exception {
    try (Fixture f = new Fixture()) {
      ObjectNode ask = request("courtyard");
      JsonNode question = f.service.ask("guest", f.id, ask);
      assertEquals(question, f.service.ask("guest", f.id, ask.deepCopy()));
      problem(409, () -> f.service.ask("guest", f.id, ask.deepCopy().put("note", "different")));
      ObjectNode response = response(0, true);
      JsonNode saved = f.service.answer("host", Json.str(question, "id"), response);
      assertEquals(saved, f.service.answer("host", Json.str(question, "id"), response.deepCopy()));
      problem(409, () -> f.service.answer("host", Json.str(question, "id"), response.deepCopy().put("value", false)));
      assertEquals(1, f.db.rows("SELECT * FROM account_clarification_answers").size());
    }
  }

  @Test void twoConcurrentAnswersWithSameVersionHaveExactlyOneWinner() throws Exception {
    try (Fixture f = new Fixture(); ExecutorService pool = Executors.newFixedThreadPool(2)) {
      JsonNode q = f.ask("courtyard");
      CountDownLatch ready = new CountDownLatch(2), start = new CountDownLatch(1);
      List<Future<Integer>> futures = new ArrayList<>();
      for (boolean value : List.of(true, false)) futures.add(pool.submit(() -> {
        ready.countDown(); start.await();
        try { f.service.answer("host", Json.str(q, "id"), response(0, value)); return 200; }
        catch (AccountProblem problem) { return problem.status; }
      }));
      assertTrue(ready.await(5, TimeUnit.SECONDS)); start.countDown();
      assertEquals(List.of(200, 409), futures.stream().map(future -> {
        try { return future.get(5, TimeUnit.SECONDS); } catch (Exception e) { throw new RuntimeException(e); }
      }).sorted().toList());
      assertEquals(1, f.db.rows("SELECT * FROM account_clarification_answers").size());
    }
  }

  @Test void concurrentRetriesWithOneRequestKeyAreIdempotentAcrossConnections() throws Exception {
    try (Fixture f = new Fixture(); ExecutorService pool = Executors.newFixedThreadPool(2)) {
      ObjectNode input = request("courtyard");
      CountDownLatch start = new CountDownLatch(1);
      List<Future<ObjectNode>> asks = new ArrayList<>();
      for (int i = 0; i < 2; i++) asks.add(pool.submit(() -> {
        start.await();
        return f.service.ask("guest", f.id, input.deepCopy());
      }));
      start.countDown();
      ObjectNode question = asks.getFirst().get(10, TimeUnit.SECONDS);
      assertEquals(question, asks.getLast().get(10, TimeUnit.SECONDS));
      assertEquals(1, f.db.rows("SELECT * FROM account_clarifications").size());
      ObjectNode reply = response(0, true);
      CountDownLatch answersStart = new CountDownLatch(1);
      List<Future<ObjectNode>> answers = new ArrayList<>();
      for (int i = 0; i < 2; i++) answers.add(pool.submit(() -> {
        answersStart.await();
        return f.service.answer("host", Json.str(question, "id"), reply.deepCopy());
      }));
      answersStart.countDown();
      assertEquals(answers.getFirst().get(10, TimeUnit.SECONDS), answers.getLast().get(10, TimeUnit.SECONDS));
      assertEquals(1, f.db.rows("SELECT * FROM account_clarification_answers").size());
    }
  }

  @Test void readProjectionKeepsOneSnapshotWhileAnotherConnectionCommitsAnAnswer() throws Exception {
    try (Fixture f = new Fixture(); ExecutorService pool = Executors.newSingleThreadExecutor()) {
      JsonNode question = f.ask("courtyard");
      f.db.readTransaction(() -> {
        assertEquals(0, f.db.rows("SELECT * FROM account_clarification_answers").size());
        try {
          pool.submit(() -> f.answer(question, true)).get(10, TimeUnit.SECONDS);
        } catch (Exception failure) {
          throw new AssertionError(failure);
        }
        assertEquals(0, f.db.rows("SELECT * FROM account_clarification_answers").size());
        assertEquals(0, f.db.one("SELECT version FROM account_clarifications WHERE id=?", Json.str(question, "id")).path("version").asInt());
        return null;
      });
      assertEquals(1, f.service.user("guest").getFirst().path("history").size());
    }
  }

  @Test void overlappingBookingsCannotBothBeConfirmedFromConcurrentConnections() throws Exception {
    try (Fixture f = new Fixture(); ExecutorService pool = Executors.newFixedThreadPool(2)) {
      var bookings = new ru.opodoydet.accounts.bookings.BookingService(f.db, f.listings);
      LocalDate from = LocalDate.now(ZoneId.of("Asia/Seoul")).plusDays(10);
      ObjectNode input = Json.obj("checkIn", from.toString(), "checkOut", from.plusDays(2).toString(), "guests", 2, "note", "");
      List<String> ids = List.of(
          Json.str(bookings.request("guest", f.id, input), "id"),
          Json.str(bookings.request("otherguest", f.id, input), "id"));
      CountDownLatch start = new CountDownLatch(1);
      List<Future<Integer>> futures = new ArrayList<>();
      for (String id : ids) futures.add(pool.submit(() -> {
        start.await();
        try { bookings.status("host", id, Json.obj("status", "confirmed")); return 200; }
        catch (AccountProblem problem) { return problem.status; }
      }));
      start.countDown();
      List<Integer> statuses = new ArrayList<>();
      for (Future<Integer> future : futures) statuses.add(future.get(10, TimeUnit.SECONDS));
      statuses.sort(Integer::compareTo);
      assertEquals(List.of(200, 409), statuses);
      assertEquals(1, f.db.rows("SELECT * FROM account_bookings WHERE status='confirmed'").size());
    }
  }

  @Test void expiryAndValidityBoundariesNormalizeBeforeAdmission() throws Exception {
    try (Fixture f = new Fixture()) {
      JsonNode q = f.ask("courtyard");
      ObjectNode input = response(0, true).put("observedOn", "2026-09-25");
      f.service.answer("host", Json.str(q, "id"), input);
      assertEquals("stale", Json.str(f.criterion("courtyard", "verified"), "evidenceStatus"));
      input = response(1, true).put("validFrom", "2026-11-01").put("validTo", "2026-11-05");
      f.service.answer("host", Json.str(q, "id"), input);
      assertEquals("match", Json.str(f.criterion("courtyard", "verified"), "evidenceStatus"));
      f.service.answer("host", Json.str(q, "id"), response(2, true).put("validFrom", "2026-11-02").put("validTo", "2026-11-05"));
      assertEquals("unknown", Json.str(f.criterion("courtyard", "verified"), "evidenceStatus"));
    }
  }

  @Test void negativeOverlapBlocksEvenForPartOfStayWhilePositiveRequiresFullCoverage() throws Exception {
    for (String[] interval : List.of(new String[]{"2026-11-03", "2026-11-04"}, new String[]{"2026-11-05", "2026-11-05"})) {
      try (Fixture f = new Fixture()) {
        JsonNode q = f.ask("courtyard");
        f.service.answer("host", Json.str(q, "id"), response(0, false).put("validFrom", interval[0]).put("validTo", interval[1]));
        assertEquals("mismatch", Json.str(f.criterion("courtyard", "explore"), "evidenceStatus"));
        assertEquals(0, f.search.search(trip("courtyard").put("admissionMode", "explore")).path("results").size());
        JsonNode yes = f.answer(f.ask("courtyard"), true);
        assertEquals("conflict", Json.str(f.criterion("courtyard", "verified"), "evidenceStatus"));
        assertEquals("conflict", Json.str(yes, "evidenceStatus"));
      }
    }
    try (Fixture f = new Fixture()) {
      JsonNode q = f.ask("courtyard");
      f.service.answer("host", Json.str(q, "id"), response(0, false).put("validFrom", "2026-11-06").put("validTo", "2026-11-08"));
      assertEquals("unknown", Json.str(f.criterion("courtyard", "explore"), "evidenceStatus"));
      f.service.answer("host", Json.str(q, "id"), response(1, true).put("validFrom", "2026-11-03").put("validTo", "2026-11-04"));
      assertEquals("unknown", Json.str(f.criterion("courtyard", "explore"), "evidenceStatus"));
    }
  }

  @Test void unresolvedUnknownFromAnotherDialogueSuppressesPositiveButDoesNotEraseNegative() throws Exception {
    try (Fixture f = new Fixture()) {
      JsonNode yes = f.answer(f.ask("courtyard"), true);
      JsonNode unknownQuestion = f.ask("courtyard"), unknown = f.answer(unknownQuestion, null);
      assertEquals("unknown", Json.str(unknown, "evidenceStatus"));
      assertEquals("unknown", Json.str(f.criterion("courtyard", "explore"), "evidenceStatus"));
      ObjectNode correction = response(1, false);
      correction.set("supersedes", Json.array(List.of(Json.str(yes.path("answer"), "id"))));
      f.service.answer("host", Json.str(unknownQuestion, "id"), correction);
      JsonNode anotherUnknown = f.answer(f.ask("courtyard"), null);
      assertEquals("mismatch", Json.str(anotherUnknown, "evidenceStatus"));
      assertEquals("mismatch", Json.str(f.criterion("courtyard", "explore"), "evidenceStatus"));
    }
  }

  @Test void oppositePartialPeriodsConflictOnlyWhenTheirApplicableDatesOverlap() throws Exception {
    for (boolean overlap : List.of(true, false)) {
      try (Fixture f = new Fixture()) {
        JsonNode yes = f.ask("courtyard");
        f.service.answer("host", Json.str(yes, "id"), response(0, true).put("validFrom", "2026-11-01").put("validTo", "2026-11-02"));
        JsonNode no = f.ask("courtyard");
        f.service.answer("host", Json.str(no, "id"), response(0, false).put("validFrom", overlap ? "2026-11-02" : "2026-11-03").put("validTo", "2026-11-04"));
        assertEquals(overlap ? "conflict" : "mismatch", Json.str(f.criterion("courtyard", "explore"), "evidenceStatus"));
      }
    }
  }

  @Test void materialEditAndRevertNeverReactivatesAnOldScopeButPriceChangePreservesIt() throws Exception {
    try (Fixture f = new Fixture()) {
      JsonNode question = f.ask("courtyard"); f.answer(question, true);
      f.listings.update("host", f.id, listing().put("pricePerNight", 20000));
      assertEquals("match", Json.str(f.criterion("courtyard", "verified"), "evidenceStatus"));
      f.listings.update("host", f.id, listing().put("address", "Другое здание 2"));
      f.listings.update("host", f.id, listing());
      assertEquals("unknown", Json.str(f.criterion("courtyard", "verified"), "evidenceStatus"));
      assertEquals("scope_changed", Json.str(f.service.user("guest").getFirst().path("answer"), "state"));
      assertTrue(f.service.user("guest").getFirst().path("scopeChanged").asBoolean());
      problem(409, () -> f.service.answer("host", Json.str(question, "id"), response(1, true)));
      f.answer(f.ask("courtyard"), true);
      assertEquals("match", Json.str(f.criterion("courtyard", "verified"), "evidenceStatus"));
    }
  }

  @Test void locationAndBedLayoutChangesThenRevertsRequireFreshClarification() throws Exception {
    try (Fixture f = new Fixture()) {
      ObjectNode original = listing();
      original.set("coordinates", Json.array(List.of(129.16, 35.16)));
      f.listings.update("host", f.id, original);
      List<ObjectNode> changes = new ArrayList<>();
      ObjectNode moved = original.deepCopy(); moved.set("coordinates", Json.array(List.of(129.17, 35.16))); changes.add(moved);
      changes.add(original.deepCopy().putNull("coordinates"));
      ObjectNode rearranged = original.deepCopy();
      rearranged.set("beds", Json.array(List.of(Json.obj("type", "double", "count", 1, "placesPerUnit", 2),
          Json.obj("type", "single", "count", 1, "placesPerUnit", 1)))); changes.add(rearranged);
      ObjectNode morePlaces = original.deepCopy().put("sleepingPlaces", 4);
      morePlaces.set("beds", Json.array(List.of(Json.obj("type", "single", "count", 4, "placesPerUnit", 1)))); changes.add(morePlaces);
      ObjectNode rooms = original.deepCopy();
      ((ObjectNode) rooms.path("beds").get(0)).put("room", "Спальня 2"); changes.add(rooms);
      for (ObjectNode changed : changes) {
        JsonNode question = f.ask("courtyard"); f.answer(question, true);
        assertEquals("match", Json.str(f.criterion("courtyard", "verified"), "evidenceStatus"));
        f.listings.update("host", f.id, changed);
        f.listings.update("host", f.id, original);
        assertEquals("unknown", Json.str(f.criterion("courtyard", "verified"), "evidenceStatus"));
        JsonNode stale = f.service.user("guest").stream().filter(q -> Json.str(q, "id").equals(Json.str(question, "id"))).findFirst().orElseThrow();
        assertEquals("scope_changed", Json.str(stale.path("answer"), "state"));
        problem(409, () -> f.service.answer("host", Json.str(question, "id"), response(1, true)));
      }
    }
  }

  @Test void unrelatedListingFeatureAndHostCannotBeSupersededAndFailureIsAtomic() throws Exception {
    try (Fixture f = new Fixture()) {
      String other = Json.str(f.listings.create("host", listing()), "id");
      JsonNode otherQuestion = f.service.ask("guest", other, request("courtyard"));
      JsonNode otherAnswer = f.answer(otherQuestion, true);
      JsonNode q = f.ask("courtyard");
      ObjectNode input = response(0, false);
      input.set("supersedes", Json.array(List.of(Json.str(otherAnswer.path("answer"), "id"))));
      problem(409, () -> f.service.answer("host", Json.str(q, "id"), input));
      problem(404, () -> f.service.answer("otherhost", Json.str(q, "id"), response(0, true)));
      assertEquals(1, f.db.rows("SELECT * FROM account_clarification_answers").size());
      assertEquals(0, f.service.user("guest").stream().filter(v -> Json.str(v, "id").equals(Json.str(q, "id"))).findFirst().orElseThrow().path("version").asInt());
      assertEquals("active", Json.str(f.service.user("guest").stream().filter(v -> Json.str(v, "id").equals(Json.str(otherQuestion, "id"))).findFirst().orElseThrow().path("answer"), "state"));
    }
  }

  @Test void strictValidationRejectsAreaClaimsSpoofedScopeDatesValuesAndDuplicateCorrections() throws Exception {
    try (Fixture f = new Fixture()) {
      for (String feature : List.of("area_safety", "low_noise", "clean_air", "beach_walk"))
        problem(400, () -> f.service.ask("guest", f.id, request(feature)));
      problem(400, () -> f.service.ask("guest", f.id, request("courtyard").put("roomId", "invented")));
      JsonNode q = f.ask("courtyard");
      List<ObjectNode> invalid = List.of(response(0, true).put("value", "true"), response(0, true).put("validForDays", 91),
          response(0, true).put("observedOn", "2026-10-26"), response(0, true).put("validFrom", "2026-11-01"),
          response(0, true).put("validFrom", "2026-11-10").put("validTo", "2026-11-05"),
          response(0, true).put("scopeId", "foreign"), response(0, true).put("requestKey", "short"));
      for (JsonNode input : invalid) problem(400, () -> f.service.answer("host", Json.str(q, "id"), input));
      ObjectNode duplicate = response(0, true); duplicate.set("supersedes", Json.array(List.of("same-id", "same-id")));
      problem(400, () -> f.service.answer("host", Json.str(q, "id"), duplicate));
      assertEquals(0, f.db.rows("SELECT * FROM account_clarification_answers").size());
    }
  }

  @Test void explicitTextContradictionsAreRejectedForSelectedFeatureButUnknownAndOtherFeaturesAreAllowed() throws Exception {
    try (Fixture f = new Fixture()) {
      Map<String, String> negatives = Map.of("courtyard", "Все окна выходят на улицу.",
          "family", "Не подходит для семей с детьми.", "step_free_access", "Перед входом три ступени, пандуса нет.");
      for (var pair : negatives.entrySet()) {
        JsonNode q = f.ask(pair.getKey());
        problem(400, () -> f.service.answer("host", Json.str(q, "id"), response(0, true).put("text", pair.getValue())));
        assertEquals(1, f.service.answer("host", Json.str(q, "id"), response(0, null).put("text", pair.getValue())).path("version").asInt());
      }
      JsonNode q = f.ask("courtyard");
      problem(400, () -> f.service.answer("host", Json.str(q, "id"), response(0, true).put("text", "Окна во двор. Окна на улицу.")));
      problem(400, () -> f.service.answer("host", Json.str(q, "id"), response(0, false).put("text", "Все окна во двор.")));
      assertEquals(1, f.service.answer("host", Json.str(q, "id"), response(0, true).put("text", "Не подходит для семей с детьми. Все окна во двор.")).path("version").asInt());
    }
  }

  @Test void explicitPartialScopeAgeLimitsAndStepsWithoutBypassCannotBecomeUnqualifiedPositives() throws Exception {
    try (Fixture f = new Fixture()) {
      Map<String, String> limited = Map.of("courtyard", "Окна во двор есть у части номеров.",
          "family", "С детьми можно только старше 12 лет.", "step_free_access", "На пути от улицы до номера три ступени, пандуса нет.");
      for (var pair : limited.entrySet()) {
        JsonNode q = f.ask(pair.getKey());
        problem(400, () -> f.service.answer("host", Json.str(q, "id"), response(0, true).put("text", pair.getValue())));
        assertEquals(1, f.service.answer("host", Json.str(q, "id"), response(0, null).put("text", pair.getValue())).path("version").asInt());
      }
    }
  }

  @Test void additiveSchemaReopenPreservesHistoryWithoutConvertingLegacyPublicQa() throws Exception {
    try (Fixture f = new Fixture()) {
      String listingId = f.id;
      f.db.execute("INSERT INTO account_questions(id,listing_id,user_id,text,answer,created_at,answered_at) VALUES(?,?,?,?,?,?,?)",
          "legacy-public", f.id, "guest", "Обычный вопрос", "Окна во двор.", NOW.toString(), NOW.toString());
      JsonNode q = f.ask("courtyard"); f.answer(q, false);
      f.database.restart();
      AccountDatabase db = f.database.accounts();
      ClarificationService service = new ClarificationService(db, new ListingService(db), CLOCK);
      assertEquals(1, service.user("guest").size());
      assertFalse(service.user("guest").getFirst().path("answer").path("value").asBoolean());
      assertEquals(1, db.rows("SELECT * FROM account_questions WHERE listing_id=?", listingId).size());
      assertEquals(1, db.rows("SELECT * FROM account_clarification_answers").size());
    }
  }
}
