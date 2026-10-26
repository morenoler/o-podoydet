package ru.opodoydet.accounts.clarifications;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.sql.SQLException;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.shared.Json;
import ru.opodoydet.server.support.TestDatabases;

class ClarificationReadTest {
  @TempDir Path temp;
  private static final Instant NOW = Instant.parse("2026-10-25T12:00:00Z");

  @Test void batchedReadsPreserveCompleteOrderedHistoriesAndActorBoundariesAcrossChunks() throws Exception {
    try (var database = TestDatabases.create(Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of()))) {
      AccountDatabase db = database.accounts();
      for (String user : List.of("host", "otherhost", "guest", "otherguest"))
        db.execute("INSERT INTO account_users(id,email,password_hash,role,name,created_at) VALUES(?,?,?,?,?,?)",
            user, user + "@example.test", "unused", user.contains("host") ? "host" : "user", user, NOW.toString());
      ListingService listings = new ListingService(db);
      List<ObjectNode> ownListings = new ArrayList<>();
      List<String> scopes = new ArrayList<>();
      for (int i = 0; i < 20; i++) {
        ObjectNode own = listings.create("host", ClarificationServiceTest.listing());
        ownListings.add(own);
        scopes.add(ClarificationScope.fingerprint(own, db));
      }
      ObjectNode listing = ownListings.getFirst();
      ObjectNode unrelated = listings.create("otherhost", ClarificationServiceTest.listing());
      String id = Json.str(listing, "id"), otherId = Json.str(unrelated, "id");
      String scope = ClarificationScope.fingerprint(listing, db), otherScope = ClarificationScope.fingerprint(unrelated, db);
      db.transaction(() -> {
        for (int i = 0; i < 410; i++)
          seed(db, i, Json.str(ownListings.get(i % 20), "id"), scopes.get(i % 20), (i + i / 20) % 2 == 0 ? "guest" : "otherguest", false);
        seed(db, 410, otherId, otherScope, "otherguest", false);
        // Same listing/feature but different dates must retain its own evidence decision.
        seed(db, 411, id, scope, "guest", true);
        return null;
      });
      ClarificationService service = new ClarificationService(db, listings, Clock.fixed(NOW, ZoneOffset.UTC));
      List<ObjectNode> host = service.host("host"), guest = service.user("guest");
      assertEquals(411, host.size());
      assertEquals(206, guest.size());
      assertEquals(new ClarificationRepository(db).host("host").stream().map(q -> Json.str(q, "id")).toList(),
          host.stream().map(q -> Json.str(q, "id")).toList());
      for (JsonNode question : host) {
        assertEquals(3, question.path("history").size());
        assertEquals(3, question.path("version").asInt());
        assertEquals(question.path("history").get(2), question.path("answer"));
        assertEquals(List.of(1, 2, 3), Json.list(question.path("history")).stream().map(a -> a.path("version").asInt()).toList());
        assertEquals("superseded", Json.str(question.path("history").get(0), "state"));
        assertEquals("active", Json.str(question.path("history").get(2), "state"));
        assertEquals(host.stream().filter(q -> q.path("listingId").equals(question.path("listingId"))).count(),
            question.path("relatedStatements").size());
        assertFalse(question.has("trip"));
        assertEquals(Json.str(question, "id").equals("question-411") ? "unknown" : "match", Json.str(question, "evidenceStatus"));
      }
      String hostJson = Json.write(Json.array(host)), guestJson = Json.write(Json.array(guest));
      assertFalse(hostJson.contains("PRIVATE_TRIP_CANARY"));
      assertFalse(hostJson.contains("question-410"));
      assertFalse(hostJson.contains("OTHER_HOST_ANSWER"));
      assertFalse(guestJson.contains("OTHER_GUEST_NOTE"));
      assertFalse(guestJson.contains("OTHER_GUEST_ANSWER"));
      assertTrue(guestJson.contains("PRIVATE_TRIP_CANARY"));
      assertTrue(guest.stream().noneMatch(q -> q.has("relatedStatements")));
      assertEquals(1, service.host("otherhost").size());
      assertTrue(service.user("absent").isEmpty());
      assertTrue(service.host("absent").isEmpty());

      // Request-local reuse must never turn into stale cross-request caching.
      listings.update("host", id, ClarificationServiceTest.listing().put("address", "Changed building 2"));
      for (JsonNode question : service.user("guest")) {
        boolean changed = Json.str(question, "listingId").equals(id);
        assertEquals(changed, question.path("scopeChanged").asBoolean());
        assertEquals(changed ? "scope_changed" : "active", Json.str(question.path("answer"), "state"));
        assertEquals(changed ? "unknown" : "match", Json.str(question, "evidenceStatus"));
      }
    }
  }

  private static void seed(AccountDatabase db, int number, String listing, String scope, String user, boolean otherDates) throws SQLException {
    String id = "question-" + number;
    ObjectNode trip = ClarificationServiceTest.trip("courtyard").put("text", "PRIVATE_TRIP_CANARY");
    if (otherDates) trip.put("checkIn", "2026-12-01").put("checkOut", "2026-12-05");
    ObjectNode context = Json.obj("checkIn", trip.path("checkIn"), "checkOut", trip.path("checkOut"), "adults", 2, "children", 1);
    db.execute("INSERT INTO account_clarifications(id,listing_id,user_id,feature,question_text,note,trip,context,scope_fingerprint,created_at,request_key,payload_hash,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id, listing, user, "courtyard", "Synthetic question", user.equals("guest") ? "OWN_NOTE" : "OTHER_GUEST_NOTE", Json.write(trip), Json.write(context), scope, NOW.plusMillis(number).toString(), "ask-" + number, "synthetic", 3);
    for (int version = 1; version <= 3; version++) {
      String text = number == 410 ? "OTHER_HOST_ANSWER" : user.equals("guest") ? "OWN_ANSWER" : "OTHER_GUEST_ANSWER";
      db.execute("INSERT INTO account_clarification_answers(id,clarification_id,host_id,version,value,answer_text,observed_on,recorded_at,valid_from,valid_to,recheck_at,scope_fingerprint,supersedes,request_key,payload_hash,superseded_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          id + "-answer-" + version, id, number == 410 ? "otherhost" : "host", version, version == 3 ? 1 : 0,
          text + "-version-" + version, "2026-10-25", NOW.plusMillis(number * 3L + version).toString(),
          "2026-11-01", "2026-11-05", "2026-11-25T00:00:00Z", scope, "[]", "answer-key-" + number + "-" + version,
          "synthetic", version < 3 ? id + "-answer-" + (version + 1) : null);
    }
  }
}
