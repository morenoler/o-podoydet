package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import ru.opodoydet.shared.Json;

/** Deterministic catalog retrieval. Text relevance never changes evidence or admission. */
public final class HotelFilters {
  private HotelFilters() {}

  private static final Pattern TOKEN = Pattern.compile("[\\p{L}\\p{N}]+");
  private static final Set<String> STOP_WORDS =
      Set.of("с", "со", "на", "и", "в", "во", "для", "the", "with", "a", "an", "and", "in", "of");
  private static final Map<String, String> ALIASES = aliases();
  private static final Comparator<JsonNode> ROOM_ORDER =
      Comparator.comparing((JsonNode room) -> !Json.str(room, "status").equals("fits"))
          .thenComparing(room -> room.path("provisional").asBoolean())
          .thenComparing(Comparator.comparingInt((JsonNode room) -> room.path("score").asInt()).reversed());

  // Keep explicit retrieval aliases aligned with shared/catalogFilters.ts.
  private static Map<String, String> aliases() {
    Map<String, String> result = new HashMap<>();
    for (String group : List.of(
        "suite suites люкс люксы люкса люксе", "twin твин", "double дабл",
        "deluxe делюкс делюксом", "standard стандарт стандартный",
        "family семейный семейная семейные семейного", "balcony балкон балконом балкона балконе",
        "terrace терраса террасой террасы террасе", "kitchen kitchenette кухня кухней кухни кухне",
        "pool бассейн бассейном бассейна бассейне", "parking парковка парковкой парковки парковке",
        "breakfast завтрак завтраком завтрака завтраки", "sauna сауна сауной сауны сауне",
        "gym fitness спортзал спортзалом спортзала фитнес",
        "airconditioning airconditioned кондиционер кондиционером кондиционера",
        "ocean sea море моря морем океан океана", "view вид видом вида")) {
      String[] words = group.split(" ");
      for (String word : words) result.put(word, words[0]);
    }
    return Map.copyOf(result);
  }

  private static List<String> tokens(String value) {
    String normalized = Normalizer.normalize(value, Normalizer.Form.NFKC)
        .toLowerCase(Locale.ROOT).replace('ё', 'е')
        .replaceAll("\\bair[\\s-]+condition(?:ing|ed)\\b", "airconditioning");
    var matcher = TOKEN.matcher(normalized);
    Set<String> result = new LinkedHashSet<>();
    while (matcher.find()) {
      String word = matcher.group();
      if (!STOP_WORDS.contains(word)) result.add(ALIASES.getOrDefault(word, word));
    }
    return List.copyOf(result);
  }

  private static boolean tokenMatches(String requested, String available) {
    return requested.equals(available) || (requested.length() >= 3 && available.startsWith(requested));
  }

  public static boolean active(JsonNode filters) {
    return !Json.str(filters, "query").isBlank() || !filters.path("lodgingTypes").isEmpty()
        || filters.has("maxPricePerNight") || filters.has("maxBeachMeters");
  }

  public static boolean matches(JsonNode hotel, JsonNode room, List<JsonNode> facts, JsonNode filters) {
    if (!active(filters)) return true;
    if (!filters.path("lodgingTypes").isEmpty()
        && Json.list(filters.path("lodgingTypes")).stream()
            .noneMatch(type -> type.asText().equals(Json.str(hotel, "lodgingType")))) return false;
    if (filters.has("maxPricePerNight")
        && (!Json.str(hotel, "currency").equals("KRW")
            || !positiveNumber(hotel.path("pricePerNight"))
            || hotel.path("pricePerNight").asDouble() > filters.path("maxPricePerNight").asDouble())) return false;
    if (filters.has("maxBeachMeters")
        && (!nonNegativeNumber(hotel.path("route").path("meters"))
            || hotel.path("route").path("meters").asDouble() > filters.path("maxBeachMeters").asDouble())) return false;
    String query = Json.str(filters, "query");
    if (query.isBlank()) return true;
    List<String> requested = tokens(query);
    if (requested.isEmpty()) return false;
    Set<String> available = new LinkedHashSet<>();
    for (JsonNode field : fields(hotel, room, facts)) available.addAll(tokens(Json.str(field, "text")));
    return requested.stream().allMatch(term -> available.stream().anyMatch(word -> tokenMatches(term, word)));
  }

  private static boolean nonNegativeNumber(JsonNode value) {
    return value.isNumber() && Double.isFinite(value.asDouble()) && value.asDouble() >= 0;
  }

  private static boolean positiveNumber(JsonNode value) {
    return nonNegativeNumber(value) && value.asDouble() > 0;
  }

  /** Filter after owner/knowledge overlays, so no candidate or advisor relaxation bypasses limits. */
  public static List<JsonNode> apply(List<JsonNode> ranked, List<JsonNode> facts, JsonNode filters) {
    if (!active(filters)) return ranked;
    List<JsonNode> result = new ArrayList<>();
    for (JsonNode original : ranked) {
      ObjectNode match = original.deepCopy();
      JsonNode hotel = match.path("hotel");
      List<JsonNode> rooms = new ArrayList<>();
      for (JsonNode roomMatch : match.path("rooms")) {
        JsonNode room = roomMatch.path("room");
        if (!matches(hotel, room, facts, filters)) continue;
        if (!Json.str(filters, "query").isBlank())
          ((ObjectNode) roomMatch).set("catalogMatches", Json.array(snippets(hotel, room, facts, filters)));
        rooms.add(roomMatch);
      }
      if (rooms.isEmpty()) continue;
      rooms.sort(ROOM_ORDER);
      match.set("rooms", Json.array(rooms));
      match.set("best", rooms.getFirst().deepCopy());
      result.add(match);
    }
    result.sort((a, b) -> {
      int order = ROOM_ORDER.compare(a.path("best"), b.path("best"));
      return order != 0 ? order : Double.compare(
          a.path("hotel").path("route").path("meters").asDouble(Double.POSITIVE_INFINITY),
          b.path("hotel").path("route").path("meters").asDouble(Double.POSITIVE_INFINITY));
    });
    return result;
  }

  public static List<JsonNode> snippets(JsonNode hotel, JsonNode room, List<JsonNode> facts, JsonNode filters) {
    List<String> requested = tokens(Json.str(filters, "query"));
    return fields(hotel, room, facts).stream().filter(field ->
        tokens(Json.str(field, "text")).stream().anyMatch(word ->
            requested.stream().anyMatch(term -> tokenMatches(term, word)))).limit(4).toList();
  }

  private static List<JsonNode> fields(JsonNode hotel, JsonNode room, List<JsonNode> facts) {
    List<JsonNode> fields = new ArrayList<>();
    fields.add(Json.obj("field", "name", "text", Json.str(hotel, "name")));
    fields.add(Json.obj("field", "address", "text", Json.str(hotel, "address")));
    if (room != null && !room.isMissingNode()) {
      fields.add(field("room", Json.str(room, "name"), room, Json.str(room, "id"), ""));
      fields.add(field("quote", Json.str(room, "quote"), room, Json.str(room, "id"), ""));
    }
    for (JsonNode fact : facts) {
      if (!Json.str(fact, "hotelId").equals(Json.str(hotel, "id"))) continue;
      String roomId = Json.str(fact, "roomId");
      if (!roomId.isBlank() && (room == null || !roomId.equals(Json.str(room, "id")))) continue;
      if (fact.path("demo").asBoolean() && !hotel.path("synthetic").asBoolean()
          && (room == null || !room.path("demo").asBoolean())) continue;
      fields.add(field("quote", Json.str(fact, "quote"), fact, roomId, Json.str(fact, "id")));
    }
    return fields.stream().filter(value -> !Json.str(value, "text").isBlank()).toList();
  }

  private static ObjectNode field(String kind, String text, JsonNode source, String roomId, String factId) {
    ObjectNode result = Json.obj("field", kind, "text", text);
    if (!Json.str(source, "sourceUrl").isBlank()) result.put("sourceUrl", Json.str(source, "sourceUrl"));
    if (!roomId.isBlank()) result.put("roomId", roomId);
    if (!factId.isBlank()) result.put("factId", factId);
    for (String key : List.of("obtainedAt", "sourceDate", "expiresAt"))
      if (!Json.str(source, key).isBlank()) result.put(key, Json.str(source, key));
    return result;
  }
}
