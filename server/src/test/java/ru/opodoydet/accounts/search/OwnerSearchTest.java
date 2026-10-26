package ru.opodoydet.accounts.search;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.application.*;
import ru.opodoydet.domain.Features;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;
import ru.opodoydet.server.support.TestDatabases;

class OwnerSearchTest {
  @TempDir Path temp;
  private static final String CANARY = "PRIVATE_CANARY_7f1_owner_text";
  private static final String NOTES =
      "Предусмотрено семейное размещение. Все окна выходят во двор. Путь от улицы до номера без"
          + " ступеней. Дорога до пляжа без лестниц. До пляжа 700 м пешком. "
          + CANARY;

  private static ObjectNode trip(String text, boolean required) {
    return Json.obj(
        "region",
        "Пусан",
        "checkIn",
        "2027-06-10",
        "checkOut",
        "2027-06-15",
        "adults",
        2,
        "children",
        0,
        "scenarios",
        List.of(),
        "preferences",
        List.of(Json.obj("feature", "courtyard", "required", required)),
        "text",
        text);
  }

  private static ObjectNode input(
      String title, String status, String notes, Integer floor, String... directions) {
    return Json.obj(
        "title",
        title,
        "description",
        "Просторный номер для поездки и спокойного отдыха.",
        "city",
        "Пусан",
        "address",
        "Хэундэ, дом 10",
        "roomType",
        "Номер",
        "capacity",
        3,
        "pricePerNight",
        90000,
        "amenities",
        List.of(),
        "status",
        status,
        "searchProfile",
        Json.obj("notes", notes, "floor", floor, "windowDirections", List.of(directions)));
  }

  private static void user(AccountDatabase db) throws Exception {
    db.execute(
        "INSERT INTO account_users(id,email,password_hash,role,name,created_at)"
            + " VALUES('host','host@example.test','unused','host','Отельер',?)",
        Instant.now().toString());
  }

  private static ObjectNode seed() {
    ObjectNode hotel =
        Json.obj(
            "id",
            "verified-hotel",
            "name",
            "Каталог",
            "lodgingType",
            "hotel",
            "address",
            "Пусан",
            "coordinates",
            List.of(129.16, 35.16),
            "route",
            null,
            "noise",
            List.of(),
            "rooms",
            List.of(Json.obj("id", "room", "name", "Категория", "capacity", 2, "demo", false)));
    return Json.obj("region", "Пусан", "hotels", List.of(hotel), "facts", List.of());
  }

  private SearchService search(Store store, AccountDatabase db) {
    return new SearchService(
        store,
        new Agents(Agents.Config.from(Map.of())),
        new Environment(temp.resolve("area.json"), temp.resolve("noise.json")),
        Clock.systemUTC(),
        new OwnerListingSearchProvider(db));
  }

  private static JsonNode owner(JsonNode result, String field, String id) {
    return Json.list(result.path(field)).stream()
        .filter(match -> Json.str(match.path("hotel"), "accountListingId").equals(id))
        .findFirst()
        .orElse(null);
  }

  private static void privateAbsent(JsonNode value) {
    String json = value.toString();
    for (String token : List.of(CANARY, "searchProfile", "\"notes\"", "window_directions", NOTES))
      assertFalse(json.contains(token), token + " leaked");
  }

  @Test
  void localExtractionIsConservativeAndNeverReturnsSourceText() {
    Map<String, Boolean> extracted = OwnerNotesExtractor.extract(NOTES);
    for (String feature :
        List.of("family", "courtyard", "step_free_access", "step_free_route", "beach_walk"))
      assertEquals(true, extracted.get(feature), feature);
    assertEquals(false, OwnerNotesExtractor.extract("Окна выходят на улицу.").get("courtyard"));
    assertEquals(
        false, OwnerNotesExtractor.extract("Не подходит для семей с детьми.").get("family"));
    assertEquals(false, OwnerNotesExtractor.extract("Не разрешено проживание с детьми.").get("family"));
    assertEquals(false, OwnerNotesExtractor.extract("Окна на улицу. Возможно, есть детская кроватка.").get("courtyard"));
    assertEquals(false, OwnerNotesExtractor.extract("Не подходит для семей с детьми. Есть лифт?").get("family"));
    assertTrue(OwnerNotesExtractor.extract("Окна на улицу?").isEmpty());
    assertTrue(OwnerNotesExtractor.extract("Возможно, окна на улицу.").isEmpty());
    assertTrue(OwnerNotesExtractor.extract("Не уверен. Окна на улицу.").isEmpty());
    assertEquals(false, OwnerNotesExtractor.extract("Лифт есть, но до номера есть лестница.").get("step_free_access"));
    assertEquals(false, OwnerNotesExtractor.extract("Перед входом три ступени, пандуса нет.").get("step_free_access"));
    for (String scoped : List.of("Возможно, перед входом три ступени, пандуса нет.",
        "Если перед входом три ступени, пандуса нет.",
        "Перед входом в другой корпус три ступени, пандуса нет.",
        "До номера 203 есть лестница.", "У части номеров перед входом три ступени, пандуса нет."))
      assertTrue(OwnerNotesExtractor.extract(scoped).isEmpty(), scoped);
    assertEquals(false, OwnerNotesExtractor.extract("До пляжа 2 км пешком.").get("beach_walk"));
    assertNull(OwnerNotesExtractor.extract("Окна во двор. Окна на улицу.").get("courtyard"));
    for (String notes :
        List.of(
            "Подходит для семинаров.",
            "Предусмотрено место для деталей.",
            "Если окна во двор.",
            "Путь до номера не без ступеней.",
            "Маршрут до пляжа не без ступеней.",
            "Не уверен. Окна во двор.",
            "До пляжа 500 м по прямой, пешком 2 км.",
            "Окна во двор?",
            "До пляжа 500 м не пешком.",
            "Окна во двор, но не всегда.",
            "Есть пандус у входа."))
      assertTrue(OwnerNotesExtractor.extract(notes).isEmpty(), notes);
    assertFalse(extracted.toString().contains(CANARY));
  }

  @Test
  void guestConstraintsRespectNegationUnknownAndOptionalRules() {
    assertFalse(OwnerRequirements.parse("Температура не выше 25").any());
    assertFalse(OwnerRequirements.parse("Цена не выше 100").any());
    assertFalse(OwnerRequirements.parse("Этаж не важен и цена не выше 100").any());
    var negative = OwnerRequirements.parse("Не на 2-м этаже").decisions(2, Set.of(), true);
    assertEquals(1, negative.size());
    assertEquals("mismatch", Json.str(negative.getFirst(), "status"));
    assertEquals(
        "match",
        Json.str(
            OwnerRequirements.parse("Не на 2-м этаже").decisions(3, Set.of(), true).getFirst(),
            "status"));
    var mixed =
        OwnerRequirements.parse("Не выше 5 этажа; желательно не выше 2 этажа")
            .decisions(4, Set.of(), true);
    assertEquals(2, mixed.size());
    assertEquals("match", Json.str(mixed.get(0), "status"));
    assertTrue(mixed.get(0).path("required").asBoolean());
    assertEquals("mismatch", Json.str(mixed.get(1), "status"));
    assertFalse(mixed.get(1).path("required").asBoolean());
    assertEquals(2, mixed.stream().map(v -> Json.str(v, "id")).distinct().count());
    assertEquals(
        "unknown",
        Json.str(
            OwnerRequirements.parse("Не выше 3 этажа").decisions(null, Set.of(), true).getFirst(),
            "evidenceStatus"));
    assertEquals(
        "mismatch",
        Json.str(
            OwnerRequirements.parse("Окна не на север")
                .decisions(null, Set.of("north"), true)
                .getFirst(),
            "status"));
    assertEquals(
        "mismatch",
        Json.str(
            OwnerRequirements.parse("Окна не должны выходить на юг")
                .decisions(null, Set.of("south"), true)
                .getFirst(),
            "status"));
    assertEquals(
        "match",
        Json.str(
            OwnerRequirements.parse("Окна на юг или восток")
                .decisions(null, Set.of("east"), true)
                .getFirst(),
            "status"));
    assertEquals(
        "mismatch",
        Json.str(
            OwnerRequirements.parse("Окна на юг и восток")
                .decisions(null, Set.of("east"), true)
                .getFirst(),
            "status"));
    assertEquals(
        "match",
        Json.str(
            OwnerRequirements.parse("Окна на северо-восток")
                .decisions(null, Set.of("north_east"), true)
                .getFirst(),
            "status"));
  }

  @Test
  void extensionKeepsCatalogUnknownsAndOwnerAreaClaimsOutOfConfirmedEvidence() throws Exception {
    try (var database = TestDatabases.create(seed())) {
      Store store = database.store();
      AccountDatabase db = database.accounts();
      user(db);
      ListingService listings = new ListingService(db);
      String reported = Json.str(listings.create("host", input("Опубликованные сведения", "published",
          NOTES + " Чистый воздух. Тихо. Безопасный район.", 3, "south")), "id");
      String unknown = Json.str(listings.create("host",
          input("Нет нужных сведений", "published", "", null)), "id");
      ObjectNode query = trip("", true);
      query.set("preferences", Json.array(Features.ids().stream()
          .map(feature -> Json.obj("feature", feature, "required", true)).toList()));
      ObjectNode result = search(store, db).search(query);
      assertTrue(result.path("results").isEmpty());
      JsonNode baseline = Json.list(result.path("excluded")).stream()
          .filter(h -> Json.str(h.path("hotel"), "id").equals("verified-hotel")).findFirst().orElseThrow();
      assertEquals("unknown", Json.str(baseline.path("best"), "capacityEvidenceStatus"));
      assertEquals("mismatch", Json.str(baseline.path("best"), "capacityStatus"));
      for (JsonNode criterion : baseline.path("best").path("criteria")) {
        assertEquals("unknown", Json.str(criterion, "evidenceStatus"));
        assertEquals("mismatch", Json.str(criterion, "status"));
      }
      for (JsonNode criterion : owner(result, "excluded", unknown).path("best").path("criteria")) {
        assertEquals("unknown", Json.str(criterion, "evidenceStatus"));
        assertEquals("mismatch", Json.str(criterion, "status"));
      }
      for (JsonNode criterion : owner(result, "excluded", reported).path("best").path("criteria")) {
        assertTrue(criterion.path("assumed").asBoolean());
        if (Features.get(Json.str(criterion, "feature")).tool().equals("area")) {
          assertEquals("unknown", Json.str(criterion, "evidenceStatus"));
          assertEquals("mismatch", Json.str(criterion, "status"));
        } else {
          assertEquals("match", Json.str(criterion, "status"));
          assertTrue(Json.str(criterion, "explanation").contains("Сведения отельера"));
        }
      }
      privateAbsent(result);
    }
  }

  @Test
  void exploreRetainsUnknownOwnerAndCatalogEvidenceButBlocksKnownNegativeAndConflictingClaims() throws Exception {
    try (var database = TestDatabases.create(seed())) {
      Store store = database.store();
      AccountDatabase db = database.accounts();
      user(db);
      ListingService listings = new ListingService(db);
      String unknown = Json.str(listings.create("host", input("Без сведений", "published", "", null)), "id");
      String negative = Json.str(listings.create("host", input("Не соответствует", "published", "Окна на улицу.", 2)), "id");
      String conflict = Json.str(listings.create("host", input("Противоречия", "published", "Окна во двор. Окна на улицу.", 2)), "id");
      SearchService service = search(store,db);
      ObjectNode query = trip("Не выше 3 этажа",true).put("admissionMode","explore");
      JsonNode result = service.search(query);
      JsonNode candidate = owner(result,"results",unknown);
      assertNotNull(candidate);
      assertTrue(candidate.path("best").path("provisional").asBoolean());
      assertEquals("unknown",Json.str(candidate.path("best").path("criteria").get(0),"evidenceStatus"));
      assertEquals("mismatch",Json.str(candidate.path("best").path("criteria").get(0),"status"));
      assertEquals("unknown",Json.str(candidate.path("ownerCriteria").get(0),"evidenceStatus"));
      assertNotNull(owner(result,"excluded",negative));
      assertEquals("conflict",Json.str(owner(result,"excluded",conflict).path("best").path("criteria").get(0),"evidenceStatus"));
      JsonNode context = service.advisorContext(query,Json.str(result,"searchId"));
      assertTrue(Json.list(context.path("candidates")).stream().anyMatch(c -> c.path("provisional").asBoolean()));
      privateAbsent(context);
      assertTrue(service.search(query.deepCopy().put("admissionMode","verified")).path("results").isEmpty());
    }
  }

  @Test
  void reimportDoesNotTouchAccountsAndOtherDatabaseHasIndependentAccounts() throws Exception {
    String listingId;
    try (var appDb = TestDatabases.create(seed()); var labDb = TestDatabases.create(seed())) {
      Store store = appDb.store(), lab = labDb.store();
      AccountDatabase accounts = appDb.accounts(), labAccounts = labDb.accounts();
      user(accounts);
      listingId = Json.str(new ListingService(accounts).create("host",
          input("Объявление владельца", "published", NOTES, 3, "south")), "id");
      appDb.importSeed(seed());
      assertEquals(1, new ListingService(accounts).published().size());
      assertEquals(0, new ListingService(labAccounts).published().size());
      assertNull(labAccounts.one("SELECT id FROM account_users WHERE id='host'"));
      assertEquals(1, store.hotels().size());
      assertEquals(1, lab.hotels().size());
      appDb.restart();
      AccountDatabase reopened = appDb.accounts();
      JsonNode listing = new ListingService(reopened).published(listingId);
      assertEquals(3, listing.path("floor").asInt());
      assertEquals("south", listing.path("windowDirections").get(0).asText());
    }
  }

  @Test
  void privateProfilesDriveSearchAndImmutableAdvisorWithoutLeakingRawMaterial() throws Exception {
    try (var database = TestDatabases.create(seed())) {
      Store store = database.store();
      AccountDatabase db = database.accounts();
      user(db);
      ListingService listings = new ListingService(db);
      SearchService search = search(store, db);
      String yes =
          Json.str(
              listings.create(
                  "host", input("Подходящее объявление", "published", NOTES, 3, "south")),
              "id");
      String no =
          Json.str(
              listings.create(
                  "host",
                  input("Окна на улицу", "published", "Все окна выходят на улицу.", 8, "north")),
              "id");
      String unknown =
          Json.str(
              listings.create("host", input("Описание без сведений", "published", "", null)), "id");
      String draft =
          Json.str(listings.create("host", input("Черновик", "draft", NOTES, 2, "south")), "id");
      String otherCity =
          Json.str(
              listings.create(
                  "host",
                  input("Другой город", "published", NOTES, 2, "south").put("city", "Сеул")),
              "id");
      ObjectNode request = trip("", true), results = search.search(request);
      assertNotNull(owner(results, "results", yes));
      assertNotNull(owner(results, "excluded", no));
      assertNotNull(owner(results, "excluded", unknown));
      assertNull(owner(results, "results", draft));
      assertNull(owner(results, "excluded", draft));
      assertNull(owner(results, "results", otherCity));
      JsonNode match = owner(results, "results", yes);
      assertTrue(match.path("hotel").path("coordinates").isNull());
      assertTrue(match.path("hotel").path("route").isNull());
      assertTrue(match.path("best").path("criteria").get(0).path("facts").isEmpty());
      assertTrue(
          Json.str(match.path("best").path("criteria").get(0), "explanation")
              .contains("Сведения отельера"));
      privateAbsent(results);
      privateAbsent(store.dataset());
      privateAbsent(Json.array(listings.published()));
      String searchId = Json.str(results, "searchId");
      JsonNode context = search.advisorContext(request, searchId);
      privateAbsent(context);
      JsonNode candidate =
          Json.list(context.path("candidates")).stream()
              .filter(c -> Json.str(c, "hotelId").equals("account-listing:" + yes))
              .findFirst()
              .orElseThrow();
      assertEquals("fits", Json.str(candidate, "status"));
      assertEquals(4, context.path("totalHotels").asInt());
      listings.update(
          "host", yes, input("Подходящее объявление", "published", "Окна на улицу.", 9, "north"));
      assertEquals(context, search.advisorContext(request, searchId));
      assertNotNull(owner(search.search(request), "excluded", yes));
      listings.update("host", yes, input("Подходящее объявление", "published", NOTES, 3, "south"));
      JsonNode optional = search.search(trip("", false));
      assertEquals(
          yes, Json.str(optional.path("results").get(0).path("hotel"), "accountListingId"));
      ObjectNode floorTrip = trip("Не выше 3 этажа. Окна на юг", true);
      ObjectNode floorResult = search.search(floorTrip);
      assertEquals(1, floorResult.path("results").size());
      assertNotNull(owner(floorResult, "results", yes));
      assertEquals(2, floorResult.path("results").get(0).path("ownerCriteria").size());
      JsonNode floorWishes = floorResult.path("personalWishes");
      assertEquals("recognized", floorWishes.path("status").asText());
      assertTrue(floorWishes.path("features").isEmpty(), "A selected chip is not text recognition");
      assertEquals(2, floorWishes.path("ownerCriteria").size());
      assertEquals("floor", floorWishes.path("ownerCriteria").path(0).path("feature").asText());
      assertEquals("window_direction", floorWishes.path("ownerCriteria").path(1).path("feature").asText());
      JsonNode verifiedDetail = search.detail("verified-hotel", floorTrip);
      assertEquals(floorWishes, verifiedDetail.path("personalWishes"));
      assertEquals("excluded", Json.str(verifiedDetail.path("best"), "status"));
      assertEquals(2, verifiedDetail.path("ownerCriteria").size());
      JsonNode floorContext = search.advisorContext(floorTrip, Json.str(floorResult, "searchId"));
      assertEquals(floorWishes, floorContext.path("personalWishes"));
      privateAbsent(floorContext);
      JsonNode floorCandidate =
          Json.list(floorContext.path("candidates")).stream()
              .filter(c -> Json.str(c, "hotelId").equals("account-listing:" + yes))
              .findFirst()
              .orElseThrow();
      assertTrue(
          Json.list(floorCandidate.path("criteria")).stream()
              .anyMatch(c -> Json.str(c, "feature").equals("floor")));
      assertTrue(
          Json.list(floorCandidate.path("criteria")).stream()
              .anyMatch(c -> Json.str(c, "feature").equals("window_direction")));
      var lab = search.searchLab(request);
      assertEquals(0, lab.path("results").size());
      assertEquals(0, lab.path("excluded").size());
      privateAbsent(lab);
      SearchService disabled =
          new SearchService(
              store,
              new Agents(Agents.Config.from(Map.of())),
              new Environment(temp.resolve("area.json"), temp.resolve("noise.json")));
      assertNull(owner(disabled.search(request), "results", yes));
    }
  }
}
