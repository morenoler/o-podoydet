package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import ru.opodoydet.domain.Features;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.shared.Json;

/** Explicit, local query edits. Interpretation never supplies evidence about a hotel. */
public final class SearchConversation {
  private static final Map<String, String> TOPICS = Map.of(
      "beach_walk", "пляж|мор[еяю]|морем|побереж",
      "step_free_route", "(?:дорог|маршрут|путь|пути).{0,30}(?:лестниц|ступен)|без (?:лестниц|ступен).{0,30}(?:пляж|дорог)",
      "courtyard", "двор",
      "step_free_access", "коляск|(?:вход|номер).{0,25}без (?:ступен|лестниц)|(?:без|не нужны|не должно быть) (?:ступен|лестниц).{0,25}(?:вход|номер)",
      "family", "семейн|семь[яеию]|детьми|ребенк",
      "area_safety", "безопасн|преступност|спокойный район",
      "clean_air", "воздух|смог|экологич",
      "low_noise", "шум|тишин|тих|выспаться|спит днем");
  private static final Map<String, String> LODGING = Map.of(
      "hotel", "отел[ьяиюе][а-я]*|гостиниц[а-я]*", "motel", "мотел[ьяиюе][а-я]*",
      "guest_house", "гостев[а-я]* дом[а-я]*", "hostel", "хостел[а-я]*", "apartment", "апартамент[а-я]*|квартир[а-я]*");
  private static final Map<String, String> AMENITIES = Map.of(
      "балкон", "балкон[а-я]*", "кухня", "кухн[а-я]*", "бассейн", "бассейн[а-я]*",
      "терраса", "террас[а-я]*", "парковка", "парковк[а-я]*", "завтрак", "завтрак[а-я]*",
      "сауна", "саун[а-я]*", "спортзал", "спортзал[а-я]*|фитнес[а-я]*", "кондиционер", "кондиционер[а-я]*");
  private static final String NUMBER = "(\\d+(?:[ \\u00a0]\\d{3})*(?:[.,]\\d+)?)";
  private static String money(String region) {
    return NUMBER + "\\s*(тыс(?:яч[аиу]?)?\\.?|[kк])?\\s*(?:"
        + (region.equals("Сочи") ? "rub|₽|руб(?:ль|ля|лей|ли)?" : "krw|₩|вон[а-я]*") + ")";
  }

  private static String currency(String region) { return ru.opodoydet.domain.RegionSettings.of(region).currency(); }
  private static final String DISTANCE = NUMBER + "\\s*(км|километр[а-я]*|метр[а-я]*|м)(?![а-я])";
  private static final String FILLER = "(?U)\\b(?:хочу|хотим|нуж[а-я]*|надо|важ[а-я]*|обязател[а-я]*|необязател[а-я]*|желател[а-я]*|принципиальн[а-я]*|строго|только|пожалуйста|еще|снова|также|еду|едем|ищу|ищем|найти|снять|жить|чтобы|было|был|была|быть|будет|можно|возможно|по|возможности|не|без|с|со|в|во|у|к|на|от|до|и|а|но|про|это|этот|рядом|поближе|близко|недалеко|пешком|поменьше|меньше|низк[а-я]*|внешн[а-я]*|для|нам|мне|нас|всех|спокойн[а-я]*|район[а-я]*|отел[а-я]*|номер[а-я]*|окн[а-я]*|услов[а-я]*|фильтр[а-я]*|требован[а-я]*|убери|убрать|удали|удалить|сними|снять|смягчи|учитыва[а-я]*|чист[а-я]*|должно|должен|весь|всему|пути|путь|дорог[а-я]*|маршрут[а-я]*|ступен[а-я]*|лестниц[а-я]*)\\b";

  public SearchConversation(Agents agents) { /* Application wiring; no model on this path. */ }

  private static boolean has(String regex, String text) { return Pattern.compile(regex).matcher(text).find(); }

  private static String action(String clause) {
    if (has("убери|убрать|удали|удалить|(?:сними|снять).{0,12}(?:услов|фильтр|требован|огранич)|не (?:нуж|важ|требу|учитыва)|неваж|не хочу|не хотим|без требования", clause)) return "remove";
    if (has("не ?обязател|не принципиальн|желательн|по возможности|можно без|смягчи", clause)) return "optional";
    return has("обязател|принципиальн|строго|только", clause) ? "required" : "add";
  }

  /** Returned null values explicitly clear a structured filter. */
  static ObjectNode rules(String message, List<String> focus) {
    return rules(message, focus, "Пусан");
  }

  static ObjectNode rules(String message, List<String> focus, String region) {
    String text = message.toLowerCase(Locale.ROOT).replace('ё', 'е').replaceAll("(?<=тыс)\\.(?=\\s*(?:krw|вон|₩|rub|руб|₽))", "");
    Map<String, JsonNode> updates = new LinkedHashMap<>();
    ObjectNode filters = Json.obj();
    boolean queryAppend = true;
    List<String> unhandled = new ArrayList<>(), ownerClauses = new ArrayList<>();
    List<JsonNode> nearbyUpdates = new ArrayList<>();
    List<String> nearbyWarnings = new ArrayList<>();
    for (String raw : splitClauses(text)) {
      String clause = raw.strip();
      if (clause.isBlank()) continue;
      if (has("^(?:не нуж[а-я]*|не хочу|не хотим|без) .+\\sи\\s", clause)) { unhandled.add(clause); continue; }
      var query = Pattern.compile("^(?:ищи|найди|поиск|поищи)(?: по (?:названию|тексту|описанию))?\\s*[«\"]([^»\"]+)[»\"]$").matcher(clause);
      if (query.matches()) {
        if (!query.group(1).isBlank() && query.group(1).strip().length() <= 240) {
          filters.put("query", query.group(1).strip()); queryAppend = false;
        } else unhandled.add(clause);
        continue;
      }
      NearbyIntent.Parsed nearby = NearbyIntent.parse(clause, region);
      if (nearby.recognized()) {
        nearbyUpdates.addAll(nearby.updates());
        if (!nearby.warning().isBlank()) nearbyWarnings.add(nearby.warning());
        if (nearby.updates().isEmpty()) { unhandled.add(clause); continue; }
        String originalAction = action(clause);
        clause = nearby.remainder();
        if (clause.isBlank()) continue;
        if (originalAction.equals("required")) clause = "обязательно " + clause;
        if (originalAction.equals("optional")) clause = "желательно " + clause;
        if (originalAction.equals("remove")) clause = "убери " + clause;
      }
      var name = Pattern.compile("^(?:найди|ищи|поищи)\\s+(?:отель\\s+|по названию\\s+)([^«\"]{1,240})$|^(?:найди|ищи|поищи)\\s+([a-z][a-z0-9 '-]{1,239})$").matcher(clause);
      if (name.matches()) {
        String value = (name.group(1) != null ? name.group(1) : name.group(2)).strip();
        if (has("(?U)\\b(?:не|без|кроме|рядом|тихий|тихо|недорогой|семейный|до|с)\\b", value)) unhandled.add(clause);
        else { filters.put("query", value); queryAppend = false; }
        continue;
      }
      String amenityClause = clause.replaceFirst("^(?:(?:хочу|нужен|нужна|нужно|нужны|номер|отель|с|со|еще|пожалуйста)\\s+)+", "");
      String amenity = AMENITIES.entrySet().stream().filter(entry -> amenityClause.matches(entry.getValue())).map(Map.Entry::getKey).findFirst().orElse(null);
      if (amenity != null) { addQuery(filters, amenity, clause, unhandled); continue; }
      if (clause.matches("(?:убери|сбрось|очисти) (?:текстовый поиск|поиск по тексту|поиск по названию|название)")) { filters.putNull("query"); queryAppend = false; continue; }
      if (clause.matches("(?:убери|сбрось) (?:бюджет|цену|ограничение цены)|без ограничени[яй] (?:по цене|бюджета)")) { filters.putNull("maxPricePerNight"); continue; }
      if (clause.matches("(?:убери|сбрось) (?:расстояние до пляжа|расстояние до моря|дистанцию до пляжа)")) { filters.putNull("maxBeachMeters"); continue; }
      if (clause.matches("(?:любой|все) тип[ы]? (?:жилья|размещения)|(?:убери|сбрось) тип (?:жилья|размещения)")) { filters.putNull("lodgingTypes"); continue; }
      var budget = Pattern.compile("^(?:бюджет|цена|стоимость|номер|отель)?\\s*(?:до|не дороже|не более)\\s*" + money(region) + "(?:\\s*(?:за|в) (?:ночь|сутки))?$").matcher(clause);
      if (budget.matches()) {
        double amount = number(budget.group(1)) * (budget.group(2) == null ? 1 : 1000);
        if (amount > 0 && amount <= 100_000_000) filters.put("maxPricePerNight", amount); else unhandled.add(clause);
        continue;
      }
      var distance = Pattern.compile("^(?:(?:до|от) (?:пляжа|моря)\\s*(?:не более |до )?|(?:пляж|море)\\s*(?:не дальше |до )|(?:не дальше|не более|до)\\s*)" + DISTANCE + "(?: (?:до|от) (?:пляжа|моря))?$").matcher(clause);
      if (distance.matches() && has("пляж|мор[ея]", clause)) {
        double meters = number(distance.group(1)) * (distance.group(2).startsWith("к") ? 1000 : 1);
        if (meters > 0 && meters <= 100_000) filters.put("maxBeachMeters", meters); else unhandled.add(clause);
        continue;
      }
      String typeClause = clause.replaceFirst("^(?:(?:только|хочу|нужен|нужны|покажи|ищу)\\s+)+", "");
      List<String> lodging = new ArrayList<>();
      String leftover = typeClause;
      for (var type : LODGING.entrySet()) {
        if (has("(?U)\\b(?:" + type.getValue() + ")\\b", typeClause)) {
          lodging.add(type.getKey()); leftover = leftover.replaceAll("(?U)\\b(?:" + type.getValue() + ")\\b", " ");
        }
      }
      if (!lodging.isEmpty() && leftover.replaceAll("(?U)\\b(?:или|и)\\b|\\s+", "").isBlank()) { filters.set("lodgingTypes", Json.array(lodging)); continue; }
      if (ownerClause(clause)) { ownerClauses.add(clause); continue; }
      if (has("\\d", clause)) { unhandled.add(clause); continue; }
      List<String> matched = new ArrayList<>();
      for (String feature : Features.ids()) if (has(TOPICS.get(feature), clause)) matched.add(feature);
      String act = action(clause);
      boolean rejectsNoise = has("(?:не хочу|не хотим|не нужен|не нужна|не нужны|не должно быть).{0,16}шум|шум.{0,10}не нуж|не ?шумн", clause);
      boolean rejectsSteps = has("(?:не хочу|не хотим|не нужны|не должно быть).{0,16}(?:ступен|лестниц)", clause);
      if (has("вид.{0,12}мор|перв.{0,8}лини|далеко от|грязн.{0,8}воздух|(?<![а-я])опасный район|без детей|окна не во двор|не тих|не безопас", clause)
          || (has("шумный", clause) && !rejectsNoise)) { unhandled.add(clause); continue; }
      if (matched.isEmpty() && !act.equals("add") && clause.matches("(?:это|этот|сделай это|пусть это будет)?\\s*(?:обязательно|обязательным|не обязательно|желательно|убери|смягчи)")) matched.addAll(focus);
      if (matched.isEmpty()) { unhandled.add(clause); continue; }
      if (matched.contains("step_free_route") && !has("близ|рядом|недалеко|пешком", clause)) matched.remove("beach_walk");
      String residue = clause;
      for (String feature : matched) {
        String featureAction = act;
        if (act.equals("remove") && ((feature.equals("low_noise") && rejectsNoise) || ((feature.equals("step_free_access") || feature.equals("step_free_route")) && rejectsSteps)))
          featureAction = has("обязател|принципиальн|строго|только", clause) ? "required" : "add";
        updates.put(feature, Json.obj("feature", feature, "action", featureAction));
        residue = residue.replaceAll("(?U)\\b(?:" + TOPICS.get(feature) + ")[а-я]*\\b", " ");
      }
      residue = residue.replaceAll(FILLER, " ").replaceAll("[\\s:—-]+", "");
      if (!residue.isBlank()) unhandled.add(clause);
    }
    return Json.obj("updates", updates.values(), "unhandled", unhandled, "hotelFilters", filters, "queryAppend", queryAppend, "ownerClauses", ownerClauses, "nearbyUpdates", nearbyUpdates, "nearbyWarnings", nearbyWarnings);
  }

  private static List<String> splitClauses(String text) {
    List<String> result = new ArrayList<>();
    var quoted = Pattern.compile("(?:ищи|найди|поиск|поищи)(?: по (?:названию|тексту|описанию))?\\s*[«\"][^»\"]+[»\"]").matcher(text);
    int start = 0;
    while (quoted.find()) { addClauses(result, text.substring(start, quoted.start())); result.add(quoted.group()); start = quoted.end(); }
    addClauses(result, text.substring(start));
    return result;
  }

  private static void addClauses(List<String> result, String text) {
    for (String sentence : text.split("(?<!\\d)[,.]|[,.](?!\\d)|[!?;\\n]")) {
      if (has("^(?:не нуж[а-я]*|не хочу|не хотим|без) .+\\sи\\s", sentence.strip())) { result.add(sentence); continue; }
      for (String clause : sentence.split("\\s+(?:но|а также|и еще|а|и)\\s+")) if (!clause.isBlank()) result.add(clause);
    }
  }

  private static double number(String value) { return Double.parseDouble(value.replace(" ", "").replace("\u00a0", "").replace(',', '.')); }

  private static void addQuery(ObjectNode filters, String value, String clause, List<String> unhandled) {
    String combined = appendQuery(filters.hasNonNull("query") ? filters.path("query").asText() : "", value);
    if (combined.length() <= 240) filters.put("query", combined); else unhandled.add(clause);
  }

  /** Preserve the existing name and spelling; compare literal words case-insensitively. */
  private static String appendQuery(String original, String additions) {
    var seen = new LinkedHashSet<String>();
    var words = Pattern.compile("[\\p{L}\\p{N}]+").matcher(original.toLowerCase(Locale.ROOT).replace('ё', 'е'));
    while (words.find()) seen.add(words.group());
    StringBuilder combined = new StringBuilder(original.strip());
    var added = Pattern.compile("[\\p{L}\\p{N}]+").matcher(additions);
    while (added.find()) {
      String word = added.group();
      if (!seen.add(word.toLowerCase(Locale.ROOT).replace('ё', 'е'))) continue;
      if (!combined.isEmpty()) combined.append(' ');
      combined.append(word);
    }
    return combined.toString();
  }

  private static boolean ownerClause(String clause) {
    String candidate = clause.replaceFirst("^(?:желательно|предпочтительно|по возможности|обязательно)\\s+", "");
    var floor = Pattern.compile("(?:не выше|не ниже)\\s+(-?\\d{1,3})(?:-?(?:го|й))?\\s+этаж[а-я]*|(?:не на|на|именно)\\s+(-?\\d{1,3})(?:-?(?:м|ом))?\\s+этаже").matcher(candidate);
    if (floor.matches()) { int value = Integer.parseInt(floor.group(1) == null ? floor.group(2) : floor.group(1)); return value >= -3 && value <= 200; }
    return candidate.matches("не (?:первый|на первом|1-й|на 1-м) этаж[а-я]*") || candidate.matches("окна (?:не )?на (?:северо[- ]восток|северо[- ]запад|юго[- ]восток|юго[- ]запад|север|юг|восток|запад)");
  }

  public ObjectNode refine(JsonNode trip, String message, JsonNode focusInput) {
    List<String> focus = new ArrayList<>();
    if (!focusInput.isMissingNode()) {
      Validation.strings(focusInput);
      if (focusInput.size() > 8) throw new IllegalArgumentException("Слишком много условий контекста");
      for (JsonNode value : focusInput) { Features.get(value.asText()); if (!focus.contains(value.asText())) focus.add(value.asText()); }
    }
    ObjectNode current = Agents.applyOverrides(Agents.parseRules(Json.str(trip, "text"), Json.list(trip.path("preferences"))), trip);
    String region = Json.str(trip, "region");
    JsonNode edits = rules(message, focus, region);
    Map<String, JsonNode> preferences = new LinkedHashMap<>(), overrides = new LinkedHashMap<>();
    current.path("preferences").forEach(p -> preferences.put(Json.str(p, "feature"), p.deepCopy()));
    trip.path("preferenceOverrides").forEach(p -> overrides.put(Json.str(p, "feature"), p.deepCopy()));
    List<String> descriptions = new ArrayList<>(), nextFocus = new ArrayList<>(), warnings = new ArrayList<>();
    for (JsonNode warning : edits.path("nearbyWarnings")) warnings.add(warning.asText());
    ObjectNode filterEdits = (ObjectNode) edits.path("hotelFilters");
    if (!edits.path("nearbyUpdates").isEmpty()) {
      Map<String, JsonNode> nearby = new LinkedHashMap<>();
      for (JsonNode condition : trip.path("hotelFilters").path("nearby")) nearby.put(Json.str(condition, "kind"), condition.deepCopy());
      for (JsonNode edit : edits.path("nearbyUpdates")) {
        String action = Json.str(edit, "action"), kind = Json.str(edit, "kind");
        if (action.equals("clear")) nearby.clear();
        else if (action.equals("remove")) nearby.remove(kind);
        else nearby.put(kind, Json.obj("kind", kind, "maxMeters", edit.path("maxMeters")));
      }
      if (nearby.isEmpty()) filterEdits.putNull("nearby"); else filterEdits.set("nearby", Json.array(nearby.values()));
      boolean added = Json.list(edits.path("nearbyUpdates")).stream().anyMatch(edit -> Json.str(edit, "action").equals("add"));
      if (added) warnings.add("Близость проверяем по прямой от точки отеля по данным OpenStreetMap. Пешеходный путь, вход и работа места не подтверждены.");
      if (Json.list(edits.path("nearbyUpdates")).stream().anyMatch(edit -> Json.str(edit, "kind").equals("city_center") && Json.str(edit, "action").equals("add")))
        warnings.add(region.equals("Сочи")
            ? "Ориентир центра Сочи пока не собран. Условие требует расстояния из источников каталога; без него отель не пройдёт этот фильтр."
            : "За ориентир центра Пусана принят Сомён (Seomyeon); это выбранная точка отсчёта, а не единственная граница центра.");
    }
    if (edits.path("queryAppend").asBoolean() && filterEdits.hasNonNull("query")) {
      String combined = appendQuery(Json.str(trip.path("hotelFilters"), "query"), filterEdits.path("query").asText());
      if (combined.length() <= 240) filterEdits.put("query", combined);
      else {
        filterEdits.remove("query");
        warnings.add("Слова поиска не добавлены: вместе с текущим запросом они превышают 240 символов. Сократите запрос или замените его командой «ищи». Прежний запрос сохранён.");
      }
    }
    for (JsonNode edit : edits.path("updates")) {
      String feature = Json.str(edit, "feature"), action = Json.str(edit, "action");
      boolean enabled = !action.equals("remove");
      boolean required = action.equals("required") || (action.equals("add") && preferences.containsKey(feature) && preferences.get(feature).path("required").asBoolean());
      if (enabled) preferences.put(feature, Json.obj("feature", feature, "required", required)); else preferences.remove(feature);
      overrides.put(feature, Json.obj("feature", feature, "required", required, "enabled", enabled));
      nextFocus.add(feature);
      descriptions.add("«" + Features.get(feature).label() + "» — " + (!enabled ? "убрано" : required ? "обязательно" : "желательно"));
    }
    ObjectNode nextTrip = (ObjectNode) trip.deepCopy();
    if (!nextFocus.isEmpty()) { nextTrip.set("preferences", Json.array(preferences.values())); nextTrip.set("preferenceOverrides", Json.array(overrides.values())); }
    ObjectNode filters = trip.path("hotelFilters").isObject() ? (ObjectNode) trip.path("hotelFilters").deepCopy() : Json.obj();
    edits.path("hotelFilters").properties().forEach(edit -> {
      String field = edit.getKey(); JsonNode value = edit.getValue();
      if (value.isNull()) filters.remove(field); else filters.set(field, value);
      descriptions.add(filterDescription(field, value, region));
    });
    if (!edits.path("hotelFilters").isEmpty()) { if (filters.isEmpty()) nextTrip.remove("hotelFilters"); else nextTrip.set("hotelFilters", filters); }
    if (edits.path("hotelFilters").hasNonNull("query")) warnings.add("Поиск по словам в названиях и описаниях. Упоминание удобства не подтверждает его для конкретного номера.");
    if (edits.path("hotelFilters").hasNonNull("maxPricePerNight")) warnings.add("Лимит относится к указанной цене за ночь в " + currency(region) + ". Объекты без цены исключены; стоимость и наличие на даты нужно уточнить.");
    if (edits.path("hotelFilters").hasNonNull("maxBeachMeters")) warnings.add("Расстояние рассчитано только по пешеходной сети; подходы от входа и к воде не включены. Доступность пути к воде не подтверждена.");
    if (!edits.path("ownerClauses").isEmpty()) {
      String original = Json.str(trip, "text");
      String appended = String.join(". ", Json.list(edits.path("ownerClauses")).stream().map(JsonNode::asText).toList());
      String combined = original.isBlank() ? appended : original + ". " + appended;
      if (combined.length() <= 1500) { nextTrip.put("text", combined); descriptions.add(appended); warnings.add("Этаж и направление окон проверяем только по сведениям владельца одного варианта размещения. Неизвестные данные не подтверждают пожелание; прежние условия сохраняются."); }
      else warnings.add("Пожелание об этаже или окнах не добавлено: текст уже достиг предела длины.");
    }
    String reply = descriptions.isEmpty() ? "Условия не изменились. Например: «в центре города», «рядом с кафе», «метро до 800 м» или «ищи «балкон»»." : "Учтено: " + String.join("; ", descriptions) + ".";
    if (!edits.path("unhandled").isEmpty()) reply += " Не применено: «" + String.join("», «", Json.list(edits.path("unhandled")).stream().map(JsonNode::asText).toList()) + "». Уточните эту часть отдельно. Для поиска упоминания используйте: ищи «нужное слово».";
    if (!descriptions.isEmpty() && Json.str(trip, "checkIn").isEmpty()) reply += " Выберите даты и гостей над подборкой, чтобы проверить отели.";
    return Json.obj("trip", nextTrip, "message", reply, "mode", "rules", "warnings", warnings,
        "focusFeatures", !edits.path("unhandled").isEmpty() ? List.of() : nextFocus.isEmpty() ? (descriptions.isEmpty() ? focus : List.of()) : nextFocus, "changed", !nextTrip.equals(trip));
  }

  private static String filterDescription(String field, JsonNode value, String region) {
    if (field.equals("nearby")) {
      if (value.isNull()) return "условия близости убраны";
      return String.join(", ", Json.list(value).stream().map(condition -> NearbyIntent.definition(Json.str(condition, "kind"), region).label()
          + " до " + condition.path("maxMeters").asText().replaceAll("\\.0$", "") + " м по прямой").toList());
    }
    String label = switch (field) { case "query" -> "поиск по тексту"; case "lodgingTypes" -> "тип размещения"; case "maxPricePerNight" -> "цена за ночь"; case "maxBeachMeters" -> "расстояние до пляжа"; default -> throw new IllegalArgumentException("Неизвестный фильтр"); };
    if (value.isNull()) return label + " — ограничение убрано";
    if (field.equals("query")) return label + " «" + value.asText() + "»";
    if (field.equals("lodgingTypes")) return label + ": " + String.join(", ", Json.list(value).stream().map(v -> switch (v.asText()) { case "hotel" -> "отель"; case "motel" -> "мотель"; case "guest_house" -> "гостевой дом"; case "hostel" -> "хостел"; default -> "апартаменты"; }).toList());
    return label + " до " + value.asText().replaceAll("\\.0$", "") + (field.equals("maxPricePerNight") ? " " + currency(region) : " м");
  }
}
