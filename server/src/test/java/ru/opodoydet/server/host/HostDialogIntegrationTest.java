package ru.opodoydet.server.host;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import ru.opodoydet.server.knowledge.EvidencePolicy;
import ru.opodoydet.server.knowledge.Fact;
import ru.opodoydet.server.knowledge.FactResolver;
import ru.opodoydet.server.knowledge.KnowledgeCommands;
import ru.opodoydet.server.knowledge.KnowledgeQueries;
import ru.opodoydet.server.knowledge.Subject;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.server.support.TestDatabases.Database;
import ru.opodoydet.shared.Json;

/** Fictional fixtures only: a simulated hotelier must never impersonate a real Busan hotel. */
class HostDialogIntegrationTest {
  static final String HARBOR = "demo-harbor", DUNES = "demo-dunes";

  private static ObjectNode hotel(String id, boolean demo) {
    return Json.obj("id", id, "name", "Вымышленный учебный объект " + id, "demo", demo,
        "lodgingType", "hotel", "rooms", List.of(Json.obj("id", id + "-room", "name", "Учебная категория",
            "capacity", 3, "demo", demo)));
  }
  private static ObjectNode evidence(String hotel, String room, String feature, Object value) {
    return Json.obj("id", hotel + "-" + feature, "hotelId", hotel, "roomId", room,
        "feature", feature, "value", value, "demo", true, "method", "geo", "confidence", "medium",
        "source", "Synthetic fixture", "sourceUrl", "https://example.test/fixture", "quote", "Учебные данные",
        "obtainedAt", Instant.now().minusSeconds(3600).toString(),
        "expiresAt", Instant.now().plusSeconds(86400).toString());
  }
  private static ObjectNode seed() {
    List<JsonNode> facts = new ArrayList<>();
    for (String id : List.of(HARBOR, DUNES)) {
      facts.add(evidence(id, null, "beach_walk", id.equals(HARBOR) ? 36 : 276));
      facts.add(evidence(id, null, "step_free_route", null));
      facts.add(evidence(id, id + "-room", "family", true));
      facts.add(evidence(id, id + "-room", "courtyard", null));
      facts.add(evidence(id, id + "-room", "step_free_access", null));
    }
    return Json.obj("region", "Пусан", "evidencePolicy", "demo", "hotels",
        List.of(hotel(HARBOR, true), hotel(DUNES, true)), "facts", facts);
  }
  private static Database fixture() throws Exception {
    Database db = TestDatabases.start(seed(), Map.of("LAB_MODE", "true", "ACCOUNT_MODE", "false"));
    db.context().getBean(FactResolver.class).resolveAll();
    return db;
  }
  private static Fact fact(Database db, String hotel, String room, String feature) {
    return db.context().getBean(FactResolver.class).fact(new Subject(hotel, room, feature)).orElseThrow();
  }
  private static long count(Database db, String sql) { return db.jdbc().sql(sql).query(Long.class).single(); }
  private static int request(Database db, String method, String path, String body) throws Exception {
    var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + db.port() + path));
    if (method.equals("GET")) request.GET();
    else request.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body));
    var response = HttpClient.newBuilder().proxy(HttpClient.Builder.NO_PROXY).build()
        .send(request.build(), HttpResponse.BodyHandlers.ofString());
    assertTrue(response.headers().firstValue("Cache-Control").orElse("").contains("no-store"));
    return response.statusCode();
  }

  @Test void plannerAsksAboutGapsWithContextAndWithoutDuplicates() throws Exception {
    try (Database db = fixture()) {
      var planner = db.context().getBean(QuestionPlanner.class);
      var created = planner.plan(HARBOR, 50);
      assertEquals(3, created.size());
      assertEquals(java.util.Set.of("courtyard", "step_free_access", "step_free_route"),
          created.stream().map(HostQuestion::getCharacteristic).collect(java.util.stream.Collectors.toSet()));
      assertTrue(created.stream().filter(q -> q.getRoomId() != null).allMatch(q -> q.getText().startsWith("Категория «Учебная")));
      assertTrue(planner.plan(HARBOR, 50).isEmpty());
    }
  }

  @Test void simulatedAnswersFillOnlyFictionalGapsAndAlwaysExposeTheirProvenance() throws Exception {
    try (Database db = fixture()) {
      var round = db.context().getBean(SimulatedHotelier.class).answerOpenQuestions(HARBOR);
      assertFalse(round.answers().isEmpty());
      assertEquals(Fact.Status.confirmed, fact(db, HARBOR, HARBOR + "-room", "courtyard").getStatus());
      assertTrue(fact(db, HARBOR, HARBOR + "-room", "courtyard").getValue().asBoolean());
      assertTrue(count(db, "SELECT count(*) FROM evidence WHERE simulated AND demo AND raw::jsonb->>'demo'='true' AND raw::jsonb->>'simulated'='true'") > 0);
      assertEquals(0, count(db, "SELECT count(*) FROM evidence WHERE simulated AND NOT demo"));
      assertTrue(db.context().getBean(HostDialogService.class).queue(HARBOR, List.of(HostQuestion.Status.open)).isEmpty());
    }
  }

  @Test void independentConflictingAnswersStayUntilAnExplicitCorrectionOfTheirOwnQuestion() throws Exception {
    try (Database db = fixture()) {
      var hotelier = db.context().getBean(SimulatedHotelier.class);
      var first = hotelier.answerOpenQuestions(DUNES);
      assertEquals(Fact.Status.conflict, fact(db, DUNES, null, "beach_walk").getStatus());
      UUID original = first.answers().stream().filter(a -> a.changes().stream()
          .anyMatch(c -> c.characteristic().equals("beach_walk") && c.extracted().asLong() == 100))
          .findFirst().orElseThrow().question().getId();
      assertTrue(first.answers().stream().flatMap(a -> a.followUps().stream()).anyMatch(q -> q.getCharacteristic().equals("beach_walk")));
      hotelier.answerOpenQuestions(DUNES);
      assertEquals(Fact.Status.conflict, fact(db, DUNES, null, "beach_walk").getStatus());
      assertEquals(0, count(db, "SELECT count(*) FROM evidence WHERE superseded_by IS NOT NULL"));
      db.context().getBean(HostDialogService.class).answer(original,
          "От главного входа по тротуару до пляжа около 250 метров.", "simulated");
      assertEquals(Fact.Status.confirmed, fact(db, DUNES, null, "beach_walk").getStatus());
      assertEquals(1, count(db, "SELECT count(*) FROM evidence WHERE superseded_by IS NOT NULL"));
    }
  }

  @Test void evasiveAnswerLeavesQuestionUnresolvedAndCreatesNoFacts() throws Exception {
    try (Database db = fixture()) {
      var question = db.context().getBean(QuestionPlanner.class).plan(HARBOR, 1).getFirst();
      long before = count(db, "SELECT count(*) FROM evidence");
      var result = db.context().getBean(HostDialogService.class).answer(question.getId(),
          "Уточню у коллег и вернусь с ответом.", "cabinet");
      assertEquals(HostQuestion.Status.unresolved, result.question().getStatus());
      assertTrue(result.changes().isEmpty());
      assertEquals(before, count(db, "SELECT count(*) FROM evidence"));
    }
  }

  @Test void experimentalReadsAndMutationsRejectNonLabAndRealCatalogsOverHttp() throws Exception {
    for (boolean lab : List.of(false, true)) {
      ObjectNode data = lab ? seed().put("evidencePolicy", "verified-only") : seed();
      try (var db = TestDatabases.start(data, Map.of("LAB_MODE", Boolean.toString(lab)))) {
        assertEquals(403, request(db, "POST", "/api/v2/questions/plan", "{}"));
        assertEquals(403, request(db, "GET", "/api/v2/questions", ""));
        assertEquals(403, request(db, "GET", "/api/v2/questions/" + UUID.randomUUID(), ""));
        assertEquals(403, request(db, "POST", "/api/v2/questions/" + UUID.randomUUID() + "/answer", "{\"text\":\"Ответ\"}"));
        assertEquals(403, request(db, "POST", "/api/v2/host/" + HARBOR + "/simulate", "{}"));
        assertEquals(403, request(db, "POST", "/api/v2/knowledge/resolve", "{}"));
        assertEquals(0, count(db, "SELECT count(*) FROM host_question"));
        assertEquals(0, count(db, "SELECT count(*) FROM evidence WHERE origin='host'"));
      }
    }
  }

  @Test void explicitSyntheticLaboratoryRetainsItsHttpDemoFlow() throws Exception {
    try (Database db = fixture()) {
      assertEquals(200, request(db, "POST", "/api/v2/questions/plan?hotelId=" + HARBOR, "{}"));
      assertEquals(200, request(db, "GET", "/api/v2/questions?hotelId=" + HARBOR, ""));
      assertEquals(200, request(db, "POST", "/api/v2/host/" + HARBOR + "/simulate", "{}"));
      assertEquals(200, request(db, "POST", "/api/v2/knowledge/resolve", "{}"));
      assertTrue(count(db, "SELECT count(*) FROM evidence WHERE simulated AND demo") > 0);
    }
  }

  @Test void labModeAloneCannotAttachSimulationToRealHotelIdentifiersOrUnscriptedObjects() throws Exception {
    ObjectNode data = seed();
    ((com.fasterxml.jackson.databind.node.ArrayNode) data.path("hotels")).add(hotel("way-real-hotel", false)).add(hotel("demo-unscripted", true));
    try (var db = TestDatabases.start(data, Map.of("LAB_MODE", "true"))) {
      var simulator = db.context().getBean(SimulatedHotelier.class);
      assertThrows(ResponseStatusException.class, () -> simulator.answerOpenQuestions("way-real-hotel"));
      assertThrows(IllegalArgumentException.class, () -> simulator.answerOpenQuestions("demo-unscripted"));
      assertEquals(0, count(db, "SELECT count(*) FROM evidence WHERE origin='host'"));
    }
  }

  @Test void simulatedAndManualVersionsCannotSupersedeOneAnotherAndPolicyRejectsMislabelledSimulation() throws Exception {
    try (Database db = fixture()) {
      var question = db.context().getBean(QuestionPlanner.class).plan(HARBOR, 50).stream()
          .filter(q -> q.getCharacteristic().equals("courtyard")).findFirst().orElseThrow();
      var commands = db.context().getBean(KnowledgeCommands.class);
      String simulated = commands.recordHostStatement(new KnowledgeCommands.HostStatement(HARBOR, HARBOR + "-room", "courtyard",
          BooleanNode.TRUE, "Учебное утверждение", "medium", "fixture", "Demo", true, question.getId()));
      commands.recordHostStatement(new KnowledgeCommands.HostStatement(HARBOR, HARBOR + "-room", "courtyard",
          BooleanNode.FALSE, "Учебное ручное утверждение", "medium", "fixture", "Demo", false, question.getId()));
      assertEquals(2, count(db, "SELECT count(*) FROM evidence WHERE origin='host' AND superseded_by IS NULL"));
      // Defence in depth: even a legacy row with an incorrect demo flag cannot pass verified policy.
      db.jdbc().sql("UPDATE evidence SET demo=FALSE WHERE id=?").param(simulated).update();
      var evidence = db.context().getBean(KnowledgeQueries.class).evidenceById(List.of(simulated)).get(simulated);
      assertFalse(EvidencePolicy.admissible(evidence, Instant.now(), false));
      assertFalse(EvidencePolicy.legacyAdmissible(evidence, Instant.now(), false));
    }
  }
}
