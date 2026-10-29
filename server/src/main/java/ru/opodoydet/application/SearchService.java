package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import ru.opodoydet.advisor.AdvisorPlanner;
import ru.opodoydet.domain.AdmissionPolicy;
import ru.opodoydet.domain.BinaryDecisionPolicy;
import ru.opodoydet.domain.Features;
import ru.opodoydet.domain.Matching;
import ru.opodoydet.domain.RoomRecommendations;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;
import ru.opodoydet.application.places.PlaceSearch;
import ru.opodoydet.domain.LocationAdmission;

/** Application orchestration; HTTP and persistence never decide whether a criterion passes. */
public final class SearchService {
  private final Store store;
  private final Agents agents;
  private final Environment environment;
  private final Clock clock;
  private final SearchExtension extension;
  private final SearchProjection projection;
  private final PlaceSearch places;
  private final Map<String, SearchSnapshot> snapshots = new LinkedHashMap<>();
  private static final Duration SNAPSHOT_LIFETIME = Duration.ofMinutes(10);
  private static final int MAX_SNAPSHOTS = 20;

  private record SearchSnapshot(String actor, JsonNode trip, ObjectNode context, Instant now) {}

  public SearchService(Store store, Agents agents, Environment environment) {
    this(store, agents, environment, Clock.systemUTC());
  }

  public SearchService(Store store, Agents agents, Environment environment, Clock clock) {
    this(store, agents, environment, clock, null);
  }

  public SearchService(
      Store store, Agents agents, Environment environment, Clock clock, SearchExtension extension) {
    this(store, agents, environment, clock, extension, SearchProjection.NONE);
  }

  public SearchService(
      Store store,
      Agents agents,
      Environment environment,
      Clock clock,
      SearchExtension extension,
      SearchProjection projection) {
    this(store, agents, environment, clock, extension, projection, null);
  }

  public SearchService(
      Store store, Agents agents, Environment environment, Clock clock,
      SearchExtension extension, SearchProjection projection, PlaceSearch places) {
    this.store = store;
    this.agents = agents;
    this.environment = environment;
    this.clock = clock;
    this.extension = extension;
    this.projection = projection;
    this.places = places;
  }

  public ObjectNode search(JsonNode input) throws SQLException {
    return search(input, false, null);
  }

  /** Browser/account-scoped snapshot; actor never enters the search response or model context. */
  public ObjectNode search(JsonNode input, String actor) throws SQLException {
    requireActor(actor);
    return search(input, false, actor);
  }

  public ObjectNode refine(JsonNode input) {
    Store store = this.store.forTrip(input.path("trip"));
    JsonNode trip = Validation.tripDraft(input.path("trip"), store.region());
    String message = Validation.text(input, "message", 1, 1500).trim();
    if (message.isBlank()) throw new IllegalArgumentException("Напишите пожелание к номеру.");
    if (places != null && surroundingsQuestion(message))
      return explainSurroundings(input, trip);
    return new SearchConversation(agents, places).refine(trip, message, input.path("focusFeatures"));
  }

  private static boolean surroundingsQuestion(String message) {
    String text = message.toLowerCase(java.util.Locale.ROOT).replace('ё', 'е').strip();
    // A wish can mention the same location as a question about the selected hotel.
    // Only an actual question enters the read-only explanation path.
    if (text.matches("(?s).*(?U)\\b(?:хочу|хотим|нуж[а-я]*|ищу|ищем|найди|покажи|подбери)\\b.*")) return false;
    return text.matches("(?s)^(?:подскажи(?:те)?[, ]+|скажи(?:те)?[, ]+|а )?(?:"
        + "что.{0,25}(?:рядом|поблизости)|какие.{0,30}рядом|находится ли.{0,25}центр[а-я]*"
        + "|(?:он|она|оно|это).{0,15}в центре(?: города)?"
        + "|(?:этот отель|этот номер|отель|номер).{0,15}в центре(?: города)?\\s*\\?)[?!. ]*$");
  }

  public ObjectNode surroundings(String hotelId) {
    JsonNode hotel = store.hotel(hotelId);
    if (hotel == null) return null;
    return places == null ? Json.obj("status", "unknown", "places", List.of(), "centers", List.of(),
        "method", "unavailable", "assumptions", List.of("Данные об окружении пока не подключены."))
        : places.surroundings(hotel, 1000, clock.instant());
  }

  private ObjectNode explainSurroundings(JsonNode input, JsonNode trip) {
    String id = input.hasNonNull("contextHotelId") ? Validation.text(input, "contextHotelId", 1, 180) : "";
    JsonNode hotel = id.isBlank() ? null : store.hotel(id);
    String reply;
    if (hotel == null) {
      reply = "Выберите номер в подборке. Для оценки окружения нужны координаты отеля; по одному названию или адресу я их не угадываю.";
    } else {
      ObjectNode nearby = places.surroundings(hotel, 1000, clock.instant());
      List<String> descriptions = new java.util.ArrayList<>();
      for (JsonNode place : nearby.path("places")) {
        if (descriptions.size() >= 6) break;
        descriptions.add(Json.str(place, "name") + " — около " + place.path("meters").asInt() + " м");
      }
      reply = "Рядом с «" + Json.str(hotel, "name") + "»: "
          + (descriptions.isEmpty() ? "в сохранённых данных нет достаточных сведений о местах в радиусе 1 км."
              : String.join("; ", descriptions) + ".");
      for (JsonNode center : nearby.path("centers"))
        reply += " До ориентира «" + Json.str(center, "name") + "» — около "
            + center.path("meters").asInt() + " м.";
      reply += " Расстояния по прямой от здания, не пеший маршрут от двери номера. Центр обозначен ориентиром, а не официальной границей. Источники и даты доступны в карточке номера.";
    }
    return Json.obj("trip", trip.deepCopy(), "message", reply, "mode", "rules", "warnings", List.of(),
        "focusFeatures", input.path("focusFeatures").isMissingNode() ? Json.array(List.of()) : input.path("focusFeatures"), "changed", false);
  }

  /** Lab-only experiment entry point. The HTTP layer independently gates its availability. */
  public ObjectNode searchLab(JsonNode input) throws SQLException {
    return search(input, true, null);
  }

  public ObjectNode searchLab(JsonNode input, String actor) throws SQLException {
    requireActor(actor);
    return search(input, true, actor);
  }

  private ObjectNode search(JsonNode input, boolean syntheticOnly, String actor)
      throws SQLException {
    Store store = this.store.forTrip(input);
    JsonNode trip = Validation.trip(input, store.region()).deepCopy();
    ObjectNode interpreted = agents.interpret(trip);
    addCatalogWarning(interpreted, trip);
    List<JsonNode> hotels = store.hotels();
    List<JsonNode> facts = store.matchingFacts();
    String policy = store.evidencePolicy();
    if (syntheticOnly) {
      hotels = hotels.stream().filter(hotel -> hotel.path("synthetic").asBoolean(false)).toList();
      var hotelIds =
          hotels.stream().map(hotel -> Json.str(hotel, "id")).collect(Collectors.toSet());
      facts =
          facts.stream().filter(fact -> hotelIds.contains(Json.str(fact, "hotelId"))).toList();
    }
    Instant now = clock.instant();
    Map<String, Map<String, JsonNode>> environments = environment.evaluate(hotels, trip, now);
    if (!environment.dataWarnings().isEmpty()) {
      var warnings = interpreted.withArray("warnings");
      environment.dataWarnings().forEach(warnings::add);
    }
    List<JsonNode> preferences = Json.list(interpreted.path("preferences"));
    SearchExtension.Snapshot extra =
        !syntheticOnly && extension != null ? extension.snapshot(trip) : SearchExtension.EMPTY;
    PersonalWishes.includeOwnerCriteria(interpreted, extra.personalCriteria());
    SearchProjection.Snapshot projected = SearchProjection.memoized(projection.snapshot(trip, now));
    final List<JsonNode> snapshotHotels = copyNodes(hotels), snapshotFacts = copyNodes(facts);
    boolean conflict = !interpreted.path("conflicts").isEmpty();
    java.util.function.Function<List<JsonNode>, List<JsonNode>> ranker =
        requested -> {
          List<JsonNode> matches = extra.apply(Matching.rank(
              snapshotHotels, snapshotFacts, requested, trip, now, environments, policy, projected), requested);
          if (conflict) for (JsonNode match : matches) excludeForConflict((ObjectNode) match);
          return applyLocations(HotelFilters.apply(matches, snapshotFacts,
              trip.path("hotelFilters"), now), trip, now);
        };
    List<JsonNode> ranked = ranker.apply(preferences);
    for (JsonNode match : ranked)
      ((ObjectNode) match).set("personalWishes", interpreted.path("personalWishes").deepCopy());
    String searchId = UUID.randomUUID().toString();
    ObjectNode advisorContext =
        (syntheticOnly
                ? AdvisorPlanner.plan(
                    trip,
                    interpreted,
                    HotelFilters.active(trip.path("hotelFilters")) ? ranked.size() : hotels.size() + extra.additionalHotels(),
                    now,
                    ranked,
                    ranker)
                : AdvisorPlanner.planRooms(
                    trip,
                    interpreted,
                    HotelFilters.active(trip.path("hotelFilters")) ? ranked.size() : hotels.size() + extra.additionalHotels(),
                    now,
                    ranked,
                    ranker,
                    policy))
            .put("searchId", searchId);
    synchronized (snapshots) {
      expireSnapshots();
      while (snapshots.size() >= MAX_SNAPSHOTS)
        snapshots.remove(snapshots.keySet().iterator().next());
      snapshots.put(
          searchId, new SearchSnapshot(actor, trip.deepCopy(), advisorContext.deepCopy(), now));
    }
    interpreted.put("searchId", searchId);
    if (trip.has("locationWishes")) interpreted.set("locationWishes", trip.path("locationWishes").deepCopy());
    interpreted.put("admissionMode", AdmissionPolicy.explore(trip) ? "explore" : "verified");
    if (!interpreted.path("conflicts").isEmpty())
      for (JsonNode match : ranked) excludeForConflict((ObjectNode) match);
    RoomRecommendations.Selection rooms = RoomRecommendations.select(ranked, now, policy);
    interpreted.set("roomRecommendations", Json.array(rooms.recommendations()));
    interpreted.set("roomAlternatives", Json.array(rooms.alternatives()));
    interpreted.set("hotelCandidates", Json.array(conflict ? List.of()
        : hotelCandidates(snapshotHotels, snapshotFacts, preferences, trip, now, environments, policy, projected)));
    interpreted.put("unverifiedHotelCount", rooms.unverifiedHotelCount());
    interpreted.set(
        "results",
        Json.array(
            ranked.stream()
                .filter(h -> Json.str(h.path("best"), "status").equals("fits"))
                .toList()));
    interpreted.set(
        "excluded",
        Json.array(
            ranked.stream()
                .filter(h -> Json.str(h.path("best"), "status").equals("excluded"))
                .toList()));
    interpreted.set(
        "trace",
        Json.array(
            List.of(
                Json.obj(
                    "step",
                    "Запрос",
                    "detail",
                    Json.str(trip, "region")
                        + ", "
                        + Json.str(trip, "checkIn")
                        + " — "
                        + Json.str(trip, "checkOut")
                        + ". "
                        + interpreted.path("preferences").size()
                        + " пожеланий.",
                    "tool",
                    Json.str(interpreted, "mode")),
                Json.obj(
                    "step",
                    "Подбор",
                    "detail",
                    "Проверены "
                        + (hotels.size() + extra.additionalHotels())
                        + " отелей. Найдено категорий номеров по всем выбранным условиям: "
                        + rooms.recommendations().size()
                        + ". Варианты с неподтверждёнными или невыполненными пожеланиями показаны"
                        + " отдельно.",
                    "tool",
                    "BinaryDecisionPolicy"),
                Json.obj(
                    "step",
                    "Источники и оценки",
                    "detail",
                    "Подтверждённые сведения сохранены отдельно от грубых оценок. Каждое"
                        + " предположение помечено. Демонстрационные ответы не используются как"
                        + " реальные факты. Бронирование и цены не проверены.",
                    "tool",
                    "PostgreSQL"))));
    return interpreted;
  }

  /** Advice reuses the exact interpreted constraints and evidence shown by this search result. */
  public ObjectNode advisorContext(JsonNode input, String searchId) {
    return advisorContextForActor(input, searchId, null);
  }

  public ObjectNode advisorContext(JsonNode input, String searchId, String actor) {
    requireActor(actor);
    return advisorContextForActor(input, searchId, actor);
  }

  private ObjectNode advisorContextForActor(JsonNode input, String searchId, String actor) {
    Store store = this.store.forTrip(input);
    JsonNode trip = Validation.trip(input, store.region()).deepCopy();
    SearchSnapshot snapshot;
    synchronized (snapshots) {
      expireSnapshots();
      snapshot = snapshots.get(searchId);
    }
    if (snapshot == null
        || !java.util.Objects.equals(snapshot.actor(), actor)
        || !snapshot.trip().equals(trip))
      throw new IllegalArgumentException(
          "Результат поиска устарел или параметры изменились. Обновите поиск перед запуском"
              + " помощника.");
    return snapshot.context().deepCopy();
  }

  private static void requireActor(String actor) {
    if (actor == null || actor.isBlank() || actor.length() > 160)
      throw new IllegalArgumentException("Не задан владелец поиска.");
  }

  private static List<JsonNode> copyNodes(List<JsonNode> values) {
    return values.stream().map(value -> (JsonNode) value.deepCopy()).toList();
  }

  private void expireSnapshots() {
    Instant now = clock.instant();
    snapshots
        .entrySet()
        .removeIf(entry -> !entry.getValue().now().plus(SNAPSHOT_LIFETIME).isAfter(now));
  }

  public ObjectNode detail(String id, JsonNode input) throws SQLException {
    Store store = this.store.forTrip(input);
    JsonNode trip = Validation.trip(input, store.region()), hotel = store.hotel(id);
    Instant now = clock.instant();
    ObjectNode interpreted = agents.interpret(trip);
    addCatalogWarning(interpreted, trip);
    List<JsonNode> preferences = Json.list(interpreted.path("preferences"));
    List<JsonNode> allPreferences =
        Features.ids().stream()
            .map(
                feature ->
                    (JsonNode)
                        Json.obj(
                            "feature",
                            feature,
                            "required",
                            preferences.stream()
                                .anyMatch(
                                    p ->
                                        Json.str(p, "feature").equals(feature)
                                            && p.path("required").asBoolean())))
            .toList();
    SearchExtension.Snapshot extra =
        extension == null ? SearchExtension.EMPTY : extension.snapshot(trip);
    PersonalWishes.includeOwnerCriteria(interpreted, extra.personalCriteria());
    // Published host units live in the account database, outside the research catalog.
    // The extra criteria explain the unit; they must not change the original admission/score.
    if (hotel == null) {
      ObjectNode match =
          extra.apply(List.of(), preferences).stream()
              .filter(value -> Json.str(value.path("hotel"), "id").equals(id))
              .map(value -> (ObjectNode) value.deepCopy())
              .findFirst()
              .orElse(null);
      if (match == null) return null;
      JsonNode expanded =
          extra.apply(List.of(), allPreferences).stream()
              .filter(value -> Json.str(value.path("hotel"), "id").equals(id))
              .findFirst()
              .orElseThrow();
      String bestId = Json.str(match.path("best").path("room"), "id");
      for (JsonNode room : match.path("rooms")) {
        for (JsonNode fullRoom : expanded.path("rooms")) {
          if (Json.str(room.path("room"), "id").equals(Json.str(fullRoom.path("room"), "id")))
            ((ObjectNode) room).set("criteria", fullRoom.path("criteria").deepCopy());
        }
        if (Json.str(room.path("room"), "id").equals(bestId)) match.set("best", room.deepCopy());
      }
      if (!interpreted.path("conflicts").isEmpty()) excludeForConflict(match);
      for (String key : List.of("preferences", "warnings", "conflicts", "mode", "personalWishes"))
        match.set(key, interpreted.path(key));
      List<JsonNode> filtered = applyLocations(HotelFilters.apply(List.of(match), List.of(), trip.path("hotelFilters"), now), trip, now);
      return filtered.isEmpty() ? null : filtered.getFirst().deepCopy();
    }
    List<JsonNode> facts =
        store.matchingFacts(id);
    Map<String, Map<String, JsonNode>> environments =
        environment.evaluate(List.of(hotel), trip, now);
    SearchProjection.Snapshot projected = SearchProjection.memoized(projection.snapshot(trip, now));
    ObjectNode match =
        (ObjectNode)
            Matching.rank(
                    List.of(hotel),
                    facts,
                    preferences,
                    trip,
                    now,
                    environments,
                    store.evidencePolicy(), projected)
                .getFirst();
    String bestId = Json.str(match.path("best").path("room"), "id");
    for (JsonNode room : match.path("rooms")) {
      Map<String, JsonNode> selected = Json.list(room.path("criteria")).stream()
          .collect(Collectors.toMap(c -> Json.str(c, "feature"), java.util.function.Function.identity()));
      ((ObjectNode) room)
          .set(
              "criteria",
              Json.array(
                  allPreferences.stream()
                      .map(
                          preference -> selected.computeIfAbsent(Json.str(preference, "feature"),
                              feature -> Matching.criterion(projected, hotel, facts, preference,
                                  room.path("room"), trip, now, environments.get(id), store.evidencePolicy())))
                      .toList()));
      if (Json.str(room.path("room"), "id").equals(bestId)) match.set("best", room.deepCopy());
    }
    if (extension != null)
      match =
          (ObjectNode)
              extra.apply(List.of(match), preferences).stream()
                  .filter(value -> Json.str(value.path("hotel"), "id").equals(id))
                  .findFirst()
                  .orElseThrow();
    if (!interpreted.path("conflicts").isEmpty()) excludeForConflict(match);
    for (String key : List.of("preferences", "warnings", "conflicts", "mode", "personalWishes"))
      match.set(key, interpreted.path(key));
    List<JsonNode> filtered = applyLocations(HotelFilters.apply(List.of(match), facts, trip.path("hotelFilters"), now), trip, now);
    return filtered.isEmpty() ? null : filtered.getFirst().deepCopy();
  }

  private static void addCatalogWarning(ObjectNode interpreted, JsonNode trip) {
    if (!Json.str(trip.path("hotelFilters"), "query").isBlank())
      interpreted.withArray("warnings").add(
          "Поиск по словам показывает совпадения в названии, адресе, категории и цитатах источников."
              + " Совпадение текста не подтверждает наличие удобства или его доступность на даты поездки.");
    if (!trip.path("hotelFilters").path("nearby").isEmpty())
      interpreted.withArray("warnings").add(
          "Места рядом найдены в OpenStreetMap. Расстояния рассчитаны по прямой до точки на карте;"
              + " пеший проход и работа места на даты поездки не проверены.");
  }

  /** Hotel-only cards obey the same requested evidence constraints without inventing a room. */
  private List<JsonNode> hotelCandidates(
      List<JsonNode> hotels, List<JsonNode> facts, List<JsonNode> preferences, JsonNode trip, Instant now,
      Map<String, Map<String, JsonNode>> environments, String policy, SearchProjection.Snapshot projected) {
    JsonNode filters = trip.path("hotelFilters");
    PlaceSearch locationSearch = places == null ? new PlaceSearch(Json.obj()) : places;
    return hotels.stream()
        .filter(hotel -> !hotel.path("synthetic").asBoolean()
            && !hotel.hasNonNull("accountListingId") && !hotel.path("hasCollectedRoomCategories").asBoolean()
            && Json.list(hotel.path("rooms")).stream()
                .noneMatch(room -> Json.str(room, "evidenceStatus").equals("verified")
                    && Json.str(room, "scope").equals("room_category")))
        .filter(hotel -> HotelFilters.matches(hotel, null, facts, filters, now))
        .sorted(Comparator.comparing((JsonNode hotel) -> Json.str(hotel, "name"))
            .thenComparing(hotel -> Json.str(hotel, "id")))
        .map(hotel -> {
          List<JsonNode> scopedFacts = facts.stream()
              .filter(fact -> Json.str(fact, "hotelId").equals(Json.str(hotel, "id"))).toList();
          List<JsonNode> criteria = preferences.stream().map(preference -> {
            if (Features.get(Json.str(preference, "feature")).scope().equals("hotel"))
              return (JsonNode) Matching.criterion(projected, hotel, scopedFacts, preference, Json.obj(), trip, now,
                  environments.getOrDefault(Json.str(hotel, "id"), Map.of()), policy);
            JsonNode raw = Json.obj("feature", preference.path("feature"), "required", preference.path("required").asBoolean(),
                "facts", List.of(), "status", "unknown", "explanation", "Категория номера не подтверждена источником");
            return (JsonNode) BinaryDecisionPolicy.decide(raw, hotel);
          }).toList();
          List<JsonNode> locationCriteria = locationSearch.evaluate(hotel, trip, now);
          List<JsonNode> allCriteria = java.util.stream.Stream.concat(criteria.stream(), locationCriteria.stream()).toList();
          if (allCriteria.stream().anyMatch(criterion -> criterion.path("required").asBoolean()
              && !AdmissionPolicy.permits(criterion, trip))) return (JsonNode) null;
          boolean provisional = allCriteria.stream().anyMatch(criterion -> criterion.path("required").asBoolean()
              && !Json.str(criterion, "evidenceStatus").equals("match"));
          ObjectNode withoutPlaceholder = hotel.deepCopy();
          withoutPlaceholder.set("rooms", Json.array(List.of()));
          return (JsonNode) Json.obj(
            "hotel", withoutPlaceholder,
            "criteria", criteria,
            "locationCriteria", locationCriteria,
            "provisional", provisional,
            "nearbyMatches", NearbyPlaces.selected(hotel, filters, now),
            "catalogMatches", HotelFilters.snippets(hotel, null, facts, filters),
            "limitations", List.of(
                "Категории номеров не подтверждены; вместимость и пожелания к номеру не проверены.",
                "Наличие мест и цены на даты поездки не проверены."));
        })
        .filter(java.util.Objects::nonNull)
        .sorted(Comparator.comparing((JsonNode candidate) -> candidate.path("provisional").asBoolean())
            .thenComparing(Comparator.comparingLong((JsonNode candidate) -> Json.list(candidate.path("locationCriteria"))
                .stream().filter(criterion -> Json.str(criterion, "evidenceStatus").equals("match")).count()).reversed())
            .thenComparing(candidate -> Json.str(candidate.path("hotel"), "name")))
        .toList();
  }

  private List<JsonNode> applyLocations(List<JsonNode> ranked, JsonNode trip, Instant now) {
    if (places == null || trip.path("locationWishes").isEmpty()) return ranked;
    List<JsonNode> result = new java.util.ArrayList<>();
    for (JsonNode match : ranked)
      result.add(LocationAdmission.apply(match, places.evaluate(match.path("hotel"), trip, now), trip));
    result.sort(java.util.Comparator.comparing((JsonNode match) -> match.path("best"), LocationAdmission.ROOM_ORDER));
    return result;
  }

  private static void excludeForConflict(ObjectNode match) {
    for (JsonNode room : match.path("rooms"))
      ((ObjectNode) room).put("status", "excluded").put("provisional", false);
    ((ObjectNode) match.path("best")).put("status", "excluded").put("provisional", false);
    match.put(
        "decisionExplanation",
        "Противоречащие друг другу обязательные пожелания не позволяют рекомендовать вариант.");
  }
}
