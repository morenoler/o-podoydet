package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import ru.opodoydet.shared.Json;

/** Local geography grammar. A parsed wish is a filter, never evidence that a place is open. */
final class NearbyIntent {
  record Definition(String kind, String label, int defaultMaxMeters, String aliases) {}
  record Parsed(boolean recognized, List<JsonNode> updates, String remainder, String warning) {
    static Parsed untouched(String clause) { return new Parsed(false, List.of(), clause, ""); }
    static Parsed unsupported(String clause, String warning) { return new Parsed(true, List.of(), clause, warning); }
  }

  // The contract test keeps labels and limits aligned with data/busan/place-categories.json.
  static final List<Definition> DEFINITIONS = List.of(
      new Definition("city_center", "центр — Сомён", 1500, "центр(?:е|а|ом|у)?(?:\\s+города)?|центральн(?:ый|ом|ого)\\s+район(?:е|а)?|city\\s+cent(?:er|re)|downtown|сом[её]н|seomyeon"),
      new Definition("cafe", "кафе", 500, "кафе|кофейн(?:я|и|ей|ю|е|ями|ям)|кофеен|caf[eé]s?|coffee\\s+shops?"),
      new Definition("restaurant", "ресторан", 500, "ресторан(?:ом|а|е|у|ы|ами|ов)?|restaurants?"),
      new Definition("supermarket", "супермаркет", 700, "супермаркет(?:ом|а|е|у|ы|ами|ов)?|supermarkets?|продуктов(?:ый|ого|ым|ом|ому)\\s+магазин(?:ом|а|е|у)?"),
      new Definition("convenience", "магазин у дома", 400, "магазин(?:ом|а|е|у|ы|ами|ов)?(?:\\s+у\\s+дома)?|convenience\\s+stores?"),
      new Definition("pharmacy", "аптека", 700, "аптек(?:а|и|ой|у|е|ами|ам)?|pharmac(?:y|ies)"),
      new Definition("park", "парк", 800, "парк(?:ом|а|е|и|у|ами|ам|ов)?|parks?"),
      new Definition("subway", "метро", 800, "(?:станци(?:я|и|ей|ю|е)\\s+)?метро|subway(?:\\s+station)?|metro"),
      new Definition("museum", "музей", 1500, "музе(?:й|я|ем|и|е|ям|ями|ев)|museums?"),
      new Definition("shopping_mall", "торговый центр", 1200, "торгов(?:ый|ым|ого|ом)\\s+центр(?:ом|а|е)?|тц|shopping\\s+malls?|malls?"),
      new Definition("beach", "пляж", 1000, "пляж(?:ем|а|е|и)?|beach(?:es)?"),
      new Definition("train_station", "железнодорожная станция", 1500, "вокзал(?:ом|а|е)?|железнодорожн(?:ая|ой|ую)\\s+станци(?:я|и|ей|ю|е)|(?:train|railway)\\s+station"));

  private static final String NUMBER = "(\\d+(?:[ \\u00a0]\\d{3})*(?:[.,]\\d+)?)";
  private static final Pattern DISTANCE = Pattern.compile("(?<![\\p{L}\\d.,-])" + NUMBER + "\\s*(км|километр[а-я]*|метр[а-я]*|м|km|kilomet(?:er|re)s?|met(?:er|re)s?|m)(?![\\p{L}\\d])");
  private static final String FILLER = "(?U)\\b(?:хочу|хотим|нуж[а-я]*|надо|важ[а-я]*|обязател[а-я]*|желател[а-я]*|пожалуйста|еще|снова|также|ищу|ищем|ищи|найди|поищи|найти|покажи|жить|снять|чтобы|было|был|была|быть|будет|есть|находил[а-я]*|располагал[а-я]*|отел[а-яь]*|гостиниц[а-я]*|номер[а-я]*|мест[а-я]*|размещени[а-я]*|рядом|поближе|ближе|близко|недалеко|около|возле|неподалеку|близост[а-я]*|пределах|радиусе|расстояни[а-я]*|дальше|более|менее|максимум|максимальн[а-я]*|по|прямой|в|во|на|от|до|у|к|с|со|и|а|но|не|для|нам|мне|нас|эт[а-я]*|услов[а-я]*|фильтр[а-я]*|ограничени[а-я]*|про|убери|убрать|удали|удалить|сбрось|сними|снять|очисти|учитыва[а-я]*|неваж[а-я]*|необязател[а-я]*|требовани[а-я]*|без|the|a|an|i|we|want|need|hotel|hotels|near|nearby|close|to|by|within|of|at|in|up|away|from|please|remove|clear|ignore)\\b";
  private NearbyIntent() {}

  static Definition definition(String kind) {
    return DEFINITIONS.stream().filter(d -> d.kind().equals(kind)).findFirst().orElseThrow();
  }

  static Definition definition(String kind, String region) {
    Definition original = definition(kind);
    return kind.equals("city_center") && region.equals("Сочи")
        ? new Definition(kind, "центр Сочи", original.defaultMaxMeters(),
            "центр(?:е|а|ом|у)?(?:\\s+города)?|центральн(?:ый|ом|ого)\\s+район(?:е|а)?|city\\s+cent(?:er|re)|downtown")
        : original;
  }

  private static boolean has(String regex, String text) { return Pattern.compile(regex).matcher(text).find(); }

  static Parsed parse(String original) {
    return parse(original, "Пусан");
  }

  static Parsed parse(String original, String region) {
    String clause = original.toLowerCase(Locale.ROOT).replace('ё', 'е').strip();
    if (clause.matches("(?:убери|убрать|сбрось|очисти|удали) (?:все )?(?:условия рядом|условия близости|окружение|близость к местам|места рядом|рядом)"))
      return new Parsed(true, List.of(Json.obj("action", "clear")), "", "");

    // Longer expressions consume their tokens first: a shopping centre is not the city centre,
    // and a grocery shop is not also a generic convenience shop.
    List<Definition> matched = new ArrayList<>();
    String remainder = clause;
    List<String> specificFirst = List.of("shopping_mall", "supermarket", "train_station", "subway");
    for (Definition definition : DEFINITIONS.stream().map(d -> definition(d.kind(), region)).sorted((a, b) -> Integer.compare(
        specificFirst.contains(a.kind()) ? specificFirst.indexOf(a.kind()) : 4,
        specificFirst.contains(b.kind()) ? specificFirst.indexOf(b.kind()) : 4)).toList()) {
      String expression = "(?U)\\b(?:" + definition.aliases() + ")\\b";
      if (has(expression, remainder)) {
        matched.add(definition);
        remainder = remainder.replaceAll(expression, " ");
      }
    }
    if (matched.isEmpty()) return Parsed.untouched(original);
    // Existing beach requests mean a walking route. Only an explicit straight-line request
    // enters this new geographic filter; do not silently weaken an accessibility wish.
    if (matched.stream().allMatch(d -> d.kind().equals("beach")) && !has("по прямой|straight.line", clause))
      return Parsed.untouched(original);
    if (has("(?U)\\b(?:или|либо|or)\\b", clause))
      return Parsed.unsupported(original, "Условия рядом объединяются через «и». Для «или» выберите один тип места; альтернативы пока не применены.");
    if (has("не\\s+(?:(?:очень|слишком)\\s+)?(?:рядом|близко|поблизости|около)|не\\s+в\\s+(?:самом\\s+)?центре|не\\s+центр|не ближе|подальше|вдали|(?<![а-я])далеко от|(?<!не )дальше\\s+(?:от|\\d)|(?:не менее|минимум|от)\\s+\\d|far from|away from|not near|без\\s+(?:близости|кафе|ресторан|магазин|аптек|парк|метро|музе)", clause))
      return Parsed.unsupported(original, "Удалённость от места пока не проверяется; условие близости не добавлено.");
    boolean remove = has("(?U)\\b(?:убери|убрать|удали|удалить|сбрось|сними|очисти|remove|clear|ignore)\\b|не ?важ|не нуж|не требу|не учитыва|не ?обязател|без требования", clause);
    if (!remove && has("(?U)\\b(?:минут[а-я]*|час[а-я]*|пешком|walking|walk|minutes?|hours?)\\b", clause))
      return Parsed.unsupported(original, "Для этих мест пока доступно расстояние по прямой в метрах; время и путь пешком не рассчитаны.");
    if (!remove && has("вид[а-я]*\\s+на|с\\s+видом|внутри|при\\s+отеле|на территории|собственн|on.site|with a", clause))
      return Parsed.unsupported(original, "Близость места не подтверждает вид из окна или наличие этого места внутри отеля.");
    if (!remove && has("отел[а-яь]*\\s+с\\s+|гостиниц[а-я]*\\s+с\\s+", clause)
        && !has("рядом|близ|около|возле|неподалеку|near|close", clause))
      return Parsed.unsupported(original, "Место внутри отеля и место поблизости — разные условия. Уточните: например, «рядом с кафе».");
    // Negative wishes must not turn into positive proximity constraints.
    if (!remove && has("не хочу|не хотим|не нужно|not want|don't want", clause))
      return Parsed.unsupported(original, "Уточните, нужно убрать близость или искать дальше от этого места.");
    if (!remove && !has("рядом|близ|недалеко|около|возле|неподалеку|\\bnear\\b|\\bnearby\\b|\\bclose\\b|\\bwithin\\b|до |от |радиус|предел|центр|downtown|seomyeon|сом[её]н|(?:^|\\s)у\\s", clause)
        && !DISTANCE.matcher(clause).find() && !remainder.replaceAll(FILLER, " ").isBlank())
      return Parsed.untouched(original);

    Double meters = null;
    var distances = DISTANCE.matcher(clause);
    while (distances.find()) {
      if (meters != null) return Parsed.unsupported(original, "Укажите отдельное расстояние для каждого типа места.");
      double amount = Double.parseDouble(distances.group(1).replace(" ", "").replace("\u00a0", "").replace(',', '.'));
      String unit = distances.group(2);
      meters = amount * (unit.startsWith("к") || unit.startsWith("k") ? 1000 : 1);
      if (!Double.isFinite(meters) || meters < 1 || meters > 10_000)
        return Parsed.unsupported(original, "Для близости допустимо расстояние от 1 до 10000 м.");
    }
    remainder = DISTANCE.matcher(remainder).replaceAll(" ");
    // Reject unknown numeric bounds rather than silently falling back to a default.
    if (has("\\d", remainder)) return Parsed.unsupported(original, "Не распознано расстояние. Укажите метры или километры от 1 до 10000 м.");
    remainder = remainder.replaceAll(FILLER, " ").replaceAll("[\\s:—-]+", " ").strip();
    List<JsonNode> updates = new ArrayList<>();
    for (Definition definition : DEFINITIONS.stream().map(d -> definition(d.kind(), region)).toList()) if (matched.contains(definition))
      updates.add(remove ? Json.obj("kind", definition.kind(), "action", "remove")
          : Json.obj("kind", definition.kind(), "action", "add", "maxMeters", meters == null ? definition.defaultMaxMeters() : meters));
    return new Parsed(true, updates, remainder, "");
  }
}
