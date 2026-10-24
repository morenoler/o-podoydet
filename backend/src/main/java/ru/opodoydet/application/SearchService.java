package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import ru.opodoydet.domain.BinaryDecisionPolicy;
import ru.opodoydet.domain.Features;
import ru.opodoydet.domain.Matching;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;

/** Application orchestration; HTTP and persistence never decide whether a criterion passes. */
public final class SearchService {
  private final Store store;
  private final Agents agents;
  private final Environment environment;

  public SearchService(Store store, Agents agents, Environment environment) {
    this.store = store;
    this.agents = agents;
    this.environment = environment;
  }

  public ObjectNode search(JsonNode input) throws SQLException {
    JsonNode trip = Validation.trip(input, store.region);
    ObjectNode interpreted = agents.interpret(trip);
    List<JsonNode> hotels = store.hotels();
    Instant now = Instant.now();
    List<JsonNode> ranked =
        Matching.rank(
            hotels,
            store.matchingFacts(),
            Json.list(interpreted.path("preferences")),
            trip,
            now,
            environment.evaluate(hotels, trip, now),
            store.evidencePolicy());
    if (!interpreted.path("conflicts").isEmpty())
      for (JsonNode match : ranked) excludeForConflict((ObjectNode) match);
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
                        + hotels.size()
                        + " отелей. Обязательные условия и вместимость определяют, подходит ли"
                        + " вариант.",
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
