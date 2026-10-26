package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import ru.opodoydet.advisor.AdvisorPlanner;
import ru.opodoydet.domain.BinaryDecisionPolicy;
import ru.opodoydet.domain.Features;
import ru.opodoydet.domain.Matching;
import ru.opodoydet.domain.RoomRecommendations;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;

/** Application orchestration; HTTP and persistence never decide whether a criterion passes. */
public final class SearchService {
  private final Store store;
  private final Agents agents;
  private final Environment environment;
  private final Clock clock;
  private final SearchExtension extension;
  private final Map<String, SearchSnapshot> snapshots = new LinkedHashMap<>();
  private static final Duration SNAPSHOT_LIFETIME = Duration.ofMinutes(10);
  private static final int MAX_SNAPSHOTS = 20;

  private record SearchSnapshot(
      JsonNode trip,
      ObjectNode interpreted,
      List<JsonNode> hotels,
      List<JsonNode> facts,
      Instant now,
      Map<String, Map<String, JsonNode>> environments,
      String policy,
      boolean syntheticOnly,
      SearchExtension.Snapshot extension) {}

  public SearchService(Store store, Agents agents, Environment environment) {
    this(store, agents, environment, Clock.systemUTC());
  }

  public SearchService(Store store, Agents agents, Environment environment, Clock clock) {
    this(store, agents, environment, clock, null);
  }

  public SearchService(
      Store store, Agents agents, Environment environment, Clock clock, SearchExtension extension) {
    this.store = store;
    this.agents = agents;
    this.environment = environment;
    this.clock = clock;
    this.extension = extension;
  }

  public ObjectNode search(JsonNode input) throws SQLException {
    return search(input, false);
  }

  public ObjectNode refine(JsonNode input) {
    JsonNode trip = Validation.tripDraft(input.path("trip"), store.region);
    String message = Validation.text(input, "message", 1, 1500).trim();
    if (message.isBlank()) throw new IllegalArgumentException("Напишите пожелание к отелю.");
    return new SearchConversation(agents).refine(trip, message, input.path("focusFeatures"));
  }

  /** Lab-only experiment entry point. The HTTP layer independently gates its availability. */
  public ObjectNode searchLab(JsonNode input) throws SQLException {
    return search(input, true);
  }

  private ObjectNode search(JsonNode input, boolean syntheticOnly) throws SQLException {
    JsonNode trip = Validation.trip(input, store.region).deepCopy();
    ObjectNode interpreted = agents.interpret(trip);
    List<JsonNode> hotels;
    List<JsonNode> facts;
    String policy;
    synchronized (store) {
      hotels = store.hotels();
      facts = store.matchingFacts();
      if (syntheticOnly) {
        hotels = hotels.stream().filter(hotel -> hotel.path("synthetic").asBoolean(false)).toList();
        var hotelIds =
            hotels.stream().map(hotel -> Json.str(hotel, "id")).collect(Collectors.toSet());
        facts =
            facts.stream().filter(fact -> hotelIds.contains(Json.str(fact, "hotelId"))).toList();
      }
      policy = store.evidencePolicy();
    }
    Instant now = clock.instant();
    Map<String, Map<String, JsonNode>> environments = environment.evaluate(hotels, trip, now);
    List<JsonNode> preferences = Json.list(interpreted.path("preferences"));
    SearchExtension.Snapshot extra =
        !syntheticOnly && extension != null ? extension.snapshot(trip) : SearchExtension.EMPTY;
    List<JsonNode> ranked =
        extra.apply(
            Matching.rank(hotels, facts, preferences, trip, now, environments, policy),
            preferences);
    String searchId = UUID.randomUUID().toString();
    synchronized (snapshots) {
      expireSnapshots();
      while (snapshots.size() >= MAX_SNAPSHOTS)
        snapshots.remove(snapshots.keySet().iterator().next());
      snapshots.put(
          searchId,
          new SearchSnapshot(
              trip.deepCopy(),
              interpreted.deepCopy(),
              copyNodes(hotels),
              copyNodes(facts),
              now,
              environments.entrySet().stream()
                  .collect(
                      Collectors.toUnmodifiableMap(
                          Map.Entry::getKey,
                          entry ->
                              entry.getValue().entrySet().stream()
                                  .collect(
                                      Collectors.toUnmodifiableMap(
                                          Map.Entry::getKey,
                                          value -> value.getValue().deepCopy())))),
              policy,
              syntheticOnly,
              extra));
    }
    interpreted.put("searchId", searchId);
    if (!interpreted.path("conflicts").isEmpty())
      for (JsonNode match : ranked) excludeForConflict((ObjectNode) match);
    RoomRecommendations.Selection rooms = RoomRecommendations.select(ranked, now, policy);
    interpreted.set("roomRecommendations", Json.array(rooms.recommendations()));
    interpreted.set("roomAlternatives", Json.array(rooms.alternatives()));
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
                        + " отелей. Найдено "
                        + rooms.recommendations().size()
                        + " конкретных категорий номера, где совпали все выбранные условия и"
                        + " вместимость. Условия разных номеров не объединяются.",
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
                    "SQLite 3"))));
    return interpreted;
  }

  /** Advice reuses the exact interpreted constraints and evidence shown by this search result. */
  public ObjectNode advisorContext(JsonNode input, String searchId) {
    JsonNode trip = Validation.trip(input, store.region).deepCopy();
    SearchSnapshot snapshot;
    synchronized (snapshots) {
      expireSnapshots();
      snapshot = snapshots.get(searchId);
    }
    if (snapshot == null || !snapshot.trip().equals(trip))
      throw new IllegalArgumentException(
          "Результат поиска устарел или параметры изменились. Обновите поиск перед запуском"
              + " помощника.");
    if (!snapshot.syntheticOnly())
      return AdvisorPlanner.planRooms(
              snapshot.trip(),
              snapshot.interpreted(),
              snapshot.hotels(),
              snapshot.facts(),
              snapshot.now(),
              snapshot.environments(),
              snapshot.policy(),
              snapshot.extension())
          .put("searchId", searchId);
    return AdvisorPlanner.plan(
            snapshot.trip(),
            snapshot.interpreted(),
            snapshot.hotels(),
            snapshot.facts(),
            snapshot.now(),
            snapshot.environments(),
            snapshot.policy(),
            snapshot.extension())
        .put("searchId", searchId);
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
    JsonNode trip = Validation.trip(input, store.region), hotel = store.hotel(id);
    if (hotel == null) return null;
    Instant now = Instant.now();
    ObjectNode interpreted = agents.interpret(trip);
    List<JsonNode> preferences = Json.list(interpreted.path("preferences")),
        facts =
            store.matchingFacts().stream().filter(f -> Json.str(f, "hotelId").equals(id)).toList();
    Map<String, Map<String, JsonNode>> environments =
        environment.evaluate(List.of(hotel), trip, now);
    ObjectNode match =
        (ObjectNode)
            Matching.rank(
                    List.of(hotel),
                    facts,
                    preferences,
                    trip,
                    now,
                    environments,
                    store.evidencePolicy())
                .getFirst();
    String bestId = Json.str(match.path("best").path("room"), "id");
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
    for (JsonNode room : match.path("rooms")) {
      ((ObjectNode) room)
          .set(
              "criteria",
              Json.array(
                  allPreferences.stream()
                      .map(
                          preference ->
                              BinaryDecisionPolicy.decide(
                                  Matching.evaluateWithEnvironment(
                                      facts,
                                      preference,
                                      room.path("room"),
                                      trip,
                                      now,
                                      environments.get(id),
                                      store.evidencePolicy()),
                                  hotel))
                      .toList()));
      if (Json.str(room.path("room"), "id").equals(bestId)) match.set("best", room.deepCopy());
    }
    if (extension != null)
      match =
          (ObjectNode)
              extension.snapshot(trip).apply(List.of(match), preferences).stream()
                  .filter(value -> Json.str(value.path("hotel"), "id").equals(id))
                  .findFirst()
                  .orElseThrow();
    if (!interpreted.path("conflicts").isEmpty()) excludeForConflict(match);
    for (String key : List.of("preferences", "warnings", "conflicts", "mode"))
      match.set(key, interpreted.path(key));
    return match;
  }

  private static void excludeForConflict(ObjectNode match) {
    for (JsonNode room : match.path("rooms")) ((ObjectNode) room).put("status", "excluded");
    ((ObjectNode) match.path("best")).put("status", "excluded");
    match.put(
        "decisionExplanation",
        "Противоречащие друг другу обязательные пожелания не позволяют рекомендовать вариант.");
  }
}
