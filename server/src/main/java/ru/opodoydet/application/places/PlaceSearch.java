package ru.opodoydet.application.places;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import ru.opodoydet.shared.Json;
import ru.opodoydet.domain.Amenities;

/** Location facts come from a bounded map snapshot, never from a language model. */
public final class PlaceSearch {
  public static final int DEFAULT_RADIUS = 800;
  private static final int MAX_WISHES = 8;
  private static final Map<String, String> TOPICS = new LinkedHashMap<>();
  private static final Map<String, String> LABELS = Map.of(
      "cafe", "Кафе", "restaurant", "Рестораны", "supermarket", "Продуктовые магазины",
      "pharmacy", "Аптеки", "subway", "Метро", "park", "Парки", "attraction", "Достопримечательности");
  static {
    TOPICS.put("cafe", "кафе|кофейн|кофе(?:й|ек|[а-я]*)|cafe|coffee");
    TOPICS.put("restaurant", "ресторан|поесть|ужинать|restaurant");
    TOPICS.put("supermarket", "супермаркет|продуктов.{0,12}магазин|магазин.{0,12}продукт|supermarket|grocery");
    TOPICS.put("pharmacy", "аптек|pharmacy");
    TOPICS.put("subway", "метро|subway|metro");
    TOPICS.put("park", "(?<![а-я])парк(?!ов)|парке|парком|park(?!ing)");
    TOPICS.put("attraction", "достопримечательност|attraction");
  }
  private static final Pattern DISTANCE = Pattern.compile("(\\d+(?:[.,]\\d+)?)\\s*(километр[а-я]*|км|метр[а-я]*|м)(?![а-я])");
  private static final String DISTANCE_METHOD = "haversine_straight_line";
  private static final List<String> DISTANCE_ASSUMPTIONS = List.of(
      "Расстояние по прямой от координат здания, а не от двери конкретного номера.",
      "Пешеходный маршрут, время пути, часы работы и доступность входа не проверены.",
      "Открытая карта неполна; отсутствие места в снимке не подтверждает его отсутствие.");
  private final JsonNode snapshot;
  private final Map<String, JsonNode> sources;
  private final java.util.function.Supplier<LocalPlacePlanner> planners;

  public PlaceSearch(Path path) { this(path, Map.of()); }

  public PlaceSearch(Path path, Map<String, String> env) {
    this(read(path), LocalPlacePlanner.from(env));
  }

  public PlaceSearch(Path path, ru.opodoydet.application.ProviderSelection providers) {
    this(read(path), () -> LocalPlacePlanner.from(providers.environment()));
  }

  public PlaceSearch(JsonNode snapshot) { this(snapshot, (LocalPlacePlanner) null); }

  PlaceSearch(JsonNode snapshot, LocalPlacePlanner planner) {
    this(snapshot, () -> planner);
  }

  private PlaceSearch(JsonNode snapshot, java.util.function.Supplier<LocalPlacePlanner> planners) {
    this.snapshot = snapshot == null ? Json.obj() : snapshot.deepCopy();
    this.planners = planners;
    this.sources = new LinkedHashMap<>();
    for (JsonNode source : this.snapshot.path("sources"))
      if (!Json.str(source, "id").isBlank()) sources.put(Json.str(source, "id"), source);
  }

  private static JsonNode read(Path path) {
    try {
      if (Files.size(path) > 16_000_000) return Json.obj();
      JsonNode data = Json.read(Files.readString(path));
      return data.isObject() && data.path("schemaVersion").asInt() == 1 && data.path("places").isArray() ? data : Json.obj();
    } catch (Exception ignored) { return Json.obj(); }
  }

  public static void validateWishes(JsonNode wishes) {
    if (wishes.isMissingNode() || wishes.isNull()) return;
    if (!wishes.isArray() || wishes.size() > MAX_WISHES)
      throw new IllegalArgumentException("Можно задать не больше восьми условий расположения.");
    Set<String> seen = new java.util.HashSet<>();
    for (JsonNode wish : wishes) {
      validateWish(wish);
      if (!seen.add(normalize(Json.str(wish, "query"))))
        throw new IllegalArgumentException("Условия расположения повторяются.");
    }
  }

  public static void validatePending(JsonNode pending) {
    if (pending.isMissingNode() || pending.isNull()) return;
    validateWish(pending);
    if (!Json.str(pending, "query").equals("center"))
      throw new IllegalArgumentException("Некорректное уточнение центра.");
  }

  private static void validateWish(JsonNode wish) {
    if (!wish.isObject() || !wish.path("query").isTextual()
        || Json.str(wish, "query").isBlank() || Json.str(wish, "query").length() > 120
        || Json.str(wish, "query").chars().anyMatch(Character::isISOControl)
        || !Set.of("near", "far").contains(Json.str(wish, "relation"))
        || !wish.path("required").isBoolean()
        || !wish.path("radiusMeters").isIntegralNumber()
        || !wish.path("radiusMeters").canConvertToInt()
        || wish.path("radiusMeters").asInt() < 50 || wish.path("radiusMeters").asInt() > 20000)
      throw new IllegalArgumentException("Укажите место, близость или удалённость и расстояние от 50 м до 20 км.");
  }

  /** Extracts location edits, leaving ordinary filter clauses to the existing conversation. */
  public boolean supportsRegion(String region) {
    String sourceRegion = Json.str(snapshot, "region");
    return region.isBlank() || region.equals(sourceRegion.isBlank() ? "Пусан" : sourceRegion);
  }

  public ObjectNode refine(JsonNode trip, String message) {
    if (!supportsRegion(Json.str(trip, "region")) && !clearsLocations(message))
      return Json.obj("handled", false, "remainingText", message);
    validateWishes(trip.path("locationWishes"));
    validatePending(trip.path("pendingLocationQuery"));
    Map<String, JsonNode> wishes = new LinkedHashMap<>();
    for (JsonNode wish : trip.path("locationWishes")) wishes.put(normalize(Json.str(wish, "query")), wish.deepCopy());
    List<String> messages = new ArrayList<>(), warnings = new ArrayList<>(), remaining = new ArrayList<>();
    JsonNode pending = trip.path("pendingLocationQuery").isObject() ? trip.path("pendingLocationQuery").deepCopy() : null;
    boolean handled = false;
    String mode = "rules";
    for (String original : message.split("[!?;\\n]|(?<!\\d)[,.]|[,](?!\\d)|\\s+(?:а также|и еще|и ещё|но|а|и)\\s+")) {
      String clause = normalize(original);
      if (clause.isBlank()) continue;
      if (clearsLocations(clause)) {
        wishes.clear(); pending = null; handled = true;
        messages.add("Условия расположения убраны.");
        // The same explicit command also clears the legacy structured nearby filters.
        remaining.add(original.strip());
        continue;
      }
      List<String> queries = pending != null && centerQuery(clause) != null
          ? List.of(centerQuery(clause)) : queries(clause);
      boolean center = has("центр|central|downtown", clause);
      if ((!queries.isEmpty() || center) && has("(?U)\\b(?:или|либо|or)\\b", clause)) {
        handled = true;
        warnings.add("Условия расположения с «или» пока не применены. Выберите одно место или объедините условия через «и».");
        if (ordinaryWish(clause)) remaining.add(original.strip());
        continue;
      }
      if (pending != null && queries.isEmpty()) {
        String resolved = centerQuery(clause);
        if (resolved != null) queries = List.of(resolved);
      }
      if (queries.isEmpty() && center) {
        handled = true;
        if (ordinaryWish(clause)) remaining.add(original.strip());
        if (action(clause).equals("remove")) {
          wishes.entrySet().removeIf(e -> e.getKey().startsWith("center:"));
          pending = null;
          messages.add("Условие о центре убрано.");
          continue;
        }
        int centerRadius = radius(clause, DEFAULT_RADIUS);
        if (centerRadius < 50) { warnings.add("Поддерживается расстояние от 50 м до 20 км."); continue; }
        pending = wish("center", relation(clause), centerRadius, action(clause).equals("required"));
        messages.add("Какой центр вы имеете в виду: центр района Хэундэ у станции Haeundae или центральный коммерческий район Сомён? Это разные места. Уточните также расстояние, если 800 м по прямой не подходит.");
        continue;
      }
      if (queries.isEmpty()) {
        String named = namedQuery(clause);
        if (named != null) queries = List.of(named);
      }
      if (queries.isEmpty()) { remaining.add(original.strip()); continue; }
      handled = true;
      if (has("\\d+\\s*мин|минут|пешком|пешей|ходьб|маршрут", clause)) {
        warnings.add("Для «" + original.strip() + "» нужен пешеходный маршрут. Сейчас могу проверить расстояние по прямой; укажите его в метрах или километрах.");
        continue;
      }
      int requestedRadius = radius(clause, -1);
      if (requestedRadius == -2) { warnings.add("Поддерживается расстояние от 50 м до 20 км."); continue; }
      String action = action(clause);
      for (String query : queries) {
        String key = normalize(query);
        JsonNode old = wishes.get(key);
        JsonNode context = pending != null && query.startsWith("center:") ? pending : old;
        if (action.equals("remove")) {
          wishes.remove(key);
          messages.add("Убрано: «" + label(query) + "».");
          if (query.startsWith("center:")) pending = null;
          continue;
        }
        if (wishes.size() >= MAX_WISHES && old == null) {
          warnings.add("Уже выбрано восемь условий расположения. Уберите одно, чтобы добавить новое.");
          continue;
        }
        int meters = requestedRadius >= 0 ? requestedRadius : context == null ? DEFAULT_RADIUS : context.path("radiusMeters").asInt(DEFAULT_RADIUS);
        boolean required = action.equals("required") || (!action.equals("optional") && context != null && context.path("required").asBoolean());
        String relation = has("далеко|подальше|не рядом|не ближе", clause) ? "far" : context == null ? "near" : Json.str(context, "relation");
        if (has("рядом|близ|недалеко|в центре|у центра", clause) && !has("не рядом|не ближе", clause)) relation = "near";
        wishes.put(key, wish(query, relation, meters, required));
        messages.add("Учтено: «" + label(query) + "», " + (relation.equals("far") ? "не ближе " : "в пределах ") + meters + " м по прямой" + (required ? ", обязательно." : ", желательно."));
        if (requestedRadius < 0 && context == null) warnings.add("Для «" + label(query) + "» принято расстояние 800 м по прямой. Его можно изменить сообщением.");
        if (query.startsWith("center:")) pending = null;
      }
      // Preserve a non-location condition in a mixed clause rather than silently swallowing it.
      if (ordinaryWish(clause)) remaining.add(original.strip());
    }
    LocalPlacePlanner planner = planners.get();
    if (!handled && planner != null && !message.isBlank() && !ordinaryOnly(message)) {
      try {
        JsonNode result = planner.plan(message, trip.path("locationWishes"));
        List<JsonNode> edits = Json.list(result.path("updates"));
        if (edits.size() > MAX_WISHES) throw new IllegalArgumentException("Слишком много изменений");
        Map<String, JsonNode> proposed = new LinkedHashMap<>(wishes);
        List<String> applied = new ArrayList<>();
        for (JsonNode edit : edits) {
          String quote = Json.str(edit, "quote");
          if (quote.isBlank() || !normalize(message).contains(normalize(quote))) throw new IllegalArgumentException("Нет опоры в запросе");
          String query = Json.str(edit, "query").strip();
          String editAction = Json.str(edit, "action");
          if (!Set.of("add", "remove", "required", "optional").contains(editAction)) throw new IllegalArgumentException("Некорректное действие");
          String quoted = normalize(quote), explicitAction = action(quoted);
          if (!explicitAction.equals("add") && !explicitAction.equals(editAction))
            throw new IllegalArgumentException("Модель изменила явную важность условия");
          if (!editAction.equals("remove") && has("далеко|подальше|не рядом|не ближе|рядом|близ|недалеко",quoted)
              && !relation(quoted).equals(Json.str(edit,"relation")))
            throw new IllegalArgumentException("Модель изменила близость на противоположную");
          if (has("центр|center|downtown", normalize(query))) {
            String resolved = centerQuery(quoted);
            if (resolved == null) throw new IllegalArgumentException("Неоднозначный центр");
            String proposedCenter = centerQuery(normalize(query));
            if (proposedCenter != null && !proposedCenter.equals(resolved))
              throw new IllegalArgumentException("Модель изменила выбранный центр");
            query = resolved;
          }
          String key = normalize(query);
          JsonNode old = proposed.get(key);
          int radius = radius(normalize(quote), old == null ? DEFAULT_RADIUS : old.path("radiusMeters").asInt(DEFAULT_RADIUS));
          if (radius < 50 || has("минут|пешком|маршрут", normalize(quote))) throw new IllegalArgumentException("Нужен маршрут");
          String relation = Json.str(edit, "relation");
          boolean required = editAction.equals("required") || (!editAction.equals("optional") && old != null && old.path("required").asBoolean());
          ObjectNode proposedWish = wish(query, relation, radius, required);
          validateWish(proposedWish);
          if (editAction.equals("remove")) proposed.remove(key); else proposed.put(key, proposedWish);
          applied.add((editAction.equals("remove") ? "Убрано: «" : "Модель поняла пожелание как «") + label(query) + "»" + (editAction.equals("remove") ? "." : ": " + (relation.equals("far") ? "не ближе " : "в пределах ") + radius + " м по прямой. Проверьте это понимание."));
        }
        if (proposed.size() > MAX_WISHES) throw new IllegalArgumentException("Слишком много условий");
        if (!edits.isEmpty()) {
          wishes = proposed;
          messages.addAll(applied);
          handled = true;
          mode = planner.mode();
          remaining.clear();
          String remainder = Json.str(result, "remainingText");
          if (!remainder.isBlank()) remaining.add(remainder);
        }
      } catch (Exception ignored) {
        warnings.add("Модель не смогла надёжно разобрать пожелание. Укажите место и расстояние, например «кафе в пределах 500 м».");
      }
    }
    return Json.obj("locationWishes", wishes.values(), "pendingLocationQuery", pending,
        "messages", messages, "warnings", warnings, "handled", handled,
        "remainingText", String.join("; ", remaining), "mode", mode);
  }

  private static boolean ordinaryWish(String clause) {
    return has("тих|шум|двор|коляск|ребен|детьми|безопасн|воздух|пляж|мор[еяю]|апартамент|квартир|хостел|мотел|гостев[а-я]* дом", clause)
        || Amenities.patterns().values().stream().anyMatch(pattern -> has(pattern, clause));
  }

  public static boolean clearsLocations(String message) {
    return normalize(message).matches("(?:убери|убрать|сбрось|очисти|удали) (?:все )?(?:условия рядом|условия близости|окружение|близость к местам|места рядом|рядом)");
  }

  private List<String> queries(String text) {
    String center = centerQuery(text);
    if (center != null && (has("центр|сом[её]н|seomyeon", text))) return List.of(center);
    List<String> queries = new ArrayList<>();
    for (var entry : TOPICS.entrySet()) if (has(entry.getValue(), text)) queries.add(entry.getKey());
    // Explicit POI names take precedence over their generic category, e.g. BEXCO station.
    String exact = knownName(text);
    if (exact != null) return List.of(exact);
    return queries;
  }

  private String knownName(String text) {
    for (JsonNode place : snapshot.path("places")) {
      if (place.has("centerScope")) continue;
      List<String> names = new ArrayList<>(Json.list(place.path("aliases")).stream().map(JsonNode::asText).toList());
      names.add(Json.str(place, "name"));
      for (String name : names) {
        String value = normalize(name);
        if (value.length() >= 4 && text.contains(value)) return Json.str(place, "name");
      }
    }
    return null;
  }

  private static String centerQuery(String text) {
    if (has("сом[её]н|сом[её]он|seomyeon", text)) return "center:seomyeon";
    if (has("хэундэ|хэунде|хеундэ|haeundae", text)) return "center:haeundae";
    return null;
  }

  private static String namedQuery(String clause) {
    Matcher m = Pattern.compile("(?:рядом с|недалеко от|далеко от|подальше от|около|возле|близко к)\\s+[«\"]?(.+?)[»\"]?$").matcher(clause);
    if (!m.find()) return null;
    String value = m.group(1).replaceAll("\\s+(?:в пределах|не дальше|до|обязательно|желательно).*$", "").strip();
    if (value.length() < 2 || value.length() > 120 || has("пляж|мор[еяю]|лестниц|ступен|двор|работ|шум", value)) return null;
    return value;
  }

  private static boolean ordinaryOnly(String message) {
    String text = normalize(message);
    return (has("пляж|мор[еяю]|двор|тих|тишин|шум|коляск|детьми|ребен|воздух|безопасн",text)
        || Amenities.patterns().values().stream().anyMatch(pattern -> has(pattern,text)))
        && !has("центр|рядом|возле|около|дойти|зайти|забеж|кофе|кафе|магазин|погуля|(?<![а-я])парк(?!ов)|аптек|метро",text);
  }

  private static String action(String clause) {
    if (has("убери|убрать|удали|удалить|не (?:нуж|важ|учитыва)|неваж|без требования", clause)) return "remove";
    if (has("не ?обязател|не принципиальн|желательн|по возможности|смягчи", clause)) return "optional";
    if (has("обязател|принципиальн|строго|только", clause)) return "required";
    return "add";
  }

  private static String relation(String clause) {
    return has("далеко|подальше|не рядом|не ближе", clause) && !has("недалеко", clause) ? "far" : "near";
  }

  private static int radius(String clause, int fallback) {
    Matcher matcher = DISTANCE.matcher(clause);
    if (!matcher.find()) return fallback;
    double value = Double.parseDouble(matcher.group(1).replace(',', '.'));
    if (matcher.group(2).startsWith("к")) value *= 1000;
    return value < 50 || value > 20000 || Math.rint(value) != value ? -2 : (int) value;
  }

  private static ObjectNode wish(String query, String relation, int radius, boolean required) {
    return Json.obj("query", query, "relation", relation, "radiusMeters", radius, "required", required);
  }

  private static boolean has(String regex, String text) { return Pattern.compile(regex).matcher(text).find(); }
  private static String normalize(String value) { return value.toLowerCase(Locale.ROOT).replace('ё', 'е').strip(); }

  public static String label(String query) {
    return switch (query) {
      case "center:seomyeon" -> "Центральный район Сомён";
      case "center:haeundae" -> "Центр района Хэундэ";
      default -> LABELS.getOrDefault(query, query);
    };
  }

  public List<JsonNode> evaluate(JsonNode hotel, JsonNode trip, Instant now) {
    validateWishes(trip.path("locationWishes"));
    List<JsonNode> result = new ArrayList<>();
    for (JsonNode wish : trip.path("locationWishes")) result.add(evaluateWish(hotel, wish, now, supportsRegion(Json.str(trip, "region")) && supportsRegion(Json.str(hotel, "region"))));
    return result;
  }

  private ObjectNode evaluateWish(JsonNode hotel, JsonNode wish, Instant now, boolean supportedRegion) {
    String query = Json.str(wish, "query");
    String relation = Json.str(wish, "relation");
    int radius = wish.path("radiusMeters").asInt();
    String label = label(query) + ": " + (relation.equals("far") ? "не ближе " : "до ") + radius + " м";
    ObjectNode criterion = Json.obj("id", "location:" + normalize(query), "query", query, "label", label,
        "relation", relation, "radiusMeters", radius, "required", wish.path("required").asBoolean(),
        "status", "unknown", "evidenceStatus", "unknown", "places", List.of(),
        "source", "OpenStreetMap", "obtainedAt", snapshot.path("retrievedAt"), "sourceDate", snapshot.path("sourceDate"),
        "method", DISTANCE_METHOD, "assumptions", DISTANCE_ASSUMPTIONS);
    if (!supportedRegion) return criterion.put("explanation", "Для выбранного региона нет подходящего снимка мест. Расположение не проверено.");
    if (!validHotel(hotel)) return criterion.put("explanation", "У объявления нет пригодных координат здания. Расположение и расстояние до мест неизвестны.");
    if (!snapshot.path("places").isArray() || snapshot.path("places").isEmpty()) return criterion.put("explanation", "Снимок мест недоступен. Условие расположения не проверено.");
    List<JsonNode> matches = matchedPlaces(query).stream().filter(place -> usable(place, now)).toList();
    List<ObjectNode> distances = distances(hotel, matches);
    if (distances.isEmpty()) return criterion.put("explanation", "В доступном снимке нет актуальных сведений о месте «" + label(query) + "». Это не подтверждает его отсутствие.");
    criterion.set("places", Json.array(distances.stream().limit(3).toList()));
    double nearest = distances.getFirst().path("distanceMeters").asDouble();
    boolean category = LABELS.containsKey(query);
    String status;
    if (relation.equals("near")) status = nearest <= radius ? "match" : category ? "unknown" : "mismatch";
    else status = nearest < radius ? "mismatch" : category ? "unknown" : "match";
    criterion.put("status", status).put("evidenceStatus", status);
    String explanation = distances.getFirst().path("name").asText() + ": около " + Math.round(nearest) + " м по прямой от здания.";
    if (status.equals("unknown")) explanation += " Ближайшее найденное место за пределами радиуса; полнота карты не подтверждена, поэтому отсутствие более близкого места неизвестно.";
    if (query.startsWith("center:")) explanation += " Центр определён выбранной опорной точкой района, а не официальной границей центра.";
    return criterion.put("explanation", explanation);
  }

  public ObjectNode surroundings(JsonNode hotel, int radiusMeters, Instant now) {
    int radius = Math.max(50, Math.min(20000, radiusMeters));
    ObjectNode result = Json.obj("status", "unknown", "radiusMeters", radius, "places", List.of(), "centers", List.of(),
        "method", DISTANCE_METHOD, "assumptions", DISTANCE_ASSUMPTIONS, "obtainedAt", snapshot.path("retrievedAt"), "sourceDate", snapshot.path("sourceDate"));
    if (!supportsRegion(Json.str(hotel, "region"))) return result.put("explanation", "Для выбранного региона нет подходящего снимка мест.");
    if (!validHotel(hotel)) return result.put("explanation", "Нет координат здания; определить места рядом с номером невозможно.");
    List<JsonNode> usable = Json.list(snapshot.path("places")).stream().filter(place -> usable(place, now)).toList();
    if (usable.isEmpty()) return result.put("explanation", "Актуальный снимок мест недоступен.");
    List<ObjectNode> all = distances(hotel, usable);
    result.set("places", Json.array(all.stream().filter(p -> !p.has("centerScope") && p.path("distanceMeters").asDouble() <= radius).limit(12).toList()));
    result.set("centers", Json.array(all.stream().filter(p -> p.has("centerScope")).toList()));
    return result.put("status", "available").put("explanation", "Показаны найденные в снимке места в пределах " + radius + " м по прямой. Наличие других мест, режим работы и маршруты не проверены.");
  }

  private List<JsonNode> matchedPlaces(String query) {
    String needle = normalize(query);
    List<JsonNode> exact = Json.list(snapshot.path("places")).stream().filter(place -> {
      if (needle.startsWith("center:")) return Json.str(place, "id").equals(needle);
      if (LABELS.containsKey(needle)) return Json.list(place.path("categories")).stream().anyMatch(c -> c.asText().equals(needle));
      if (normalize(Json.str(place, "name")).equals(needle)) return true;
      return Json.list(place.path("aliases")).stream().anyMatch(alias -> normalize(alias.asText()).equals(needle));
    }).toList();
    if (!exact.isEmpty() || needle.length() < 4 || LABELS.containsKey(needle)) return exact;
    // A unique partial proper name is useful; ambiguous fragments remain unknown.
    List<JsonNode> partial = Json.list(snapshot.path("places")).stream()
        .filter(place -> normalize(Json.str(place, "name")).contains(needle)
            || Json.list(place.path("aliases")).stream().anyMatch(alias -> normalize(alias.asText()).contains(needle))).toList();
    return partial.size() == 1 ? partial : List.of();
  }

  private boolean usable(JsonNode place, Instant now) {
    if (!coordinates(place.path("coordinates"))) return false;
    JsonNode source = sources.get(Json.str(place, "sourceId"));
    if (source == null || Json.str(source, "url").isBlank() || !Json.str(source, "sha256").matches("[a-fA-F0-9]{64}")) return false;
    try {
      Instant obtained = Instant.parse(Json.str(source, "obtainedAt"));
      return !obtained.isAfter(now.plus(Duration.ofDays(1))) && !obtained.isBefore(now.minus(Duration.ofDays(365)));
    } catch (Exception ignored) { return false; }
  }

  private List<ObjectNode> distances(JsonNode hotel, List<JsonNode> places) {
    List<ObjectNode> result = new ArrayList<>();
    for (JsonNode place : places) {
      JsonNode source = sources.get(Json.str(place, "sourceId"));
      ObjectNode item = Json.obj("id", place.path("id"), "name", place.path("name"), "categories", place.path("categories"),
          "coordinates", place.path("coordinates"),
          "meters", Math.round(distance(hotel.path("coordinates"), place.path("coordinates"))),
          "distanceMeters", distance(hotel.path("coordinates"), place.path("coordinates")),
          "sourceUrl", place.hasNonNull("sourceUrl") ? place.path("sourceUrl") : source.path("url"),
          "sourceId", place.path("sourceId"), "obtainedAt", source.path("obtainedAt"), "sourceDate", source.path("sourceDate"),
          "coordinateMethod", place.path("coordinateMethod"), "assumptions", place.path("assumptions"));
      if (place.has("centerScope")) item.set("centerScope", place.path("centerScope"));
      result.add(item);
    }
    result.sort(Comparator.comparingDouble(item -> item.path("meters").asDouble()));
    return result;
  }

  private static boolean validHotel(JsonNode hotel) {
    return !hotel.path("synthetic").asBoolean() && coordinates(hotel.path("coordinates"));
  }

  private static boolean coordinates(JsonNode point) {
    return point.isArray() && point.size() == 2 && point.get(0).isNumber() && point.get(1).isNumber()
        && Double.isFinite(point.get(0).asDouble()) && Double.isFinite(point.get(1).asDouble())
        && Math.abs(point.get(0).asDouble()) <= 180 && Math.abs(point.get(1).asDouble()) <= 90;
  }

  private static double distance(JsonNode from, JsonNode to) {
    double a = Math.toRadians(from.get(1).asDouble()), b = Math.toRadians(to.get(1).asDouble());
    double dLat = b - a, dLon = Math.toRadians(to.get(0).asDouble() - from.get(0).asDouble());
    double h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a) * Math.cos(b) * Math.pow(Math.sin(dLon / 2), 2);
    return 6371000 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
  }
}
