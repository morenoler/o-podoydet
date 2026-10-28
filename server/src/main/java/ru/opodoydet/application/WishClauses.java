package ru.opodoydet.application;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import ru.opodoydet.domain.Amenities;

/** Carries an explicit command through a list, while contrast/sentence boundaries reset it. */
final class WishClauses {
  record Clause(String text, String action) {}
  private static final Pattern SEPARATOR = Pattern.compile("[,.!?;\\n]|\\s+(?:но|а также|и еще|а|и|and|but)\\s+");
  static List<Clause> parse(String text) {
    List<Clause> values = new ArrayList<>();
    var matcher = SEPARATOR.matcher(text);
    int start = 0;
    String inherited = "add";
    while (true) {
      boolean found = matcher.find();
      String clause = text.substring(start, found ? matcher.start() : text.length()).strip();
      if (!clause.isBlank()) {
        String explicit = action(clause);
        String selected = explicit == null ? inherited : explicit;
        values.add(new Clause(clause, selected));
        inherited = selected;
      }
      if (!found) break;
      String separator = matcher.group().strip();
      if (separator.matches("[.!?;\\n]") || separator.equals("но") || separator.equals("а") || separator.equals("but")) inherited = "add";
      start = matcher.end();
    }
    return values;
  }
  private static String action(String clause) {
    if (has("убери|убрать|удали|удалить|(?:сними|снять).{0,12}(?:услов|фильтр|требован|огранич)|не (?:нуж|важ|требу|учитыва)|неваж|не хочу|не хотим|без требования|\\b(?:remove|delete|not needed)\\b", clause)) return "remove";
    if (has("не ?обязател|не принципиальн|желательн|по возможности|можно без|смягчи|\\b(?:optional|not required|not mandatory|preferably)\\b", clause)) return "optional";
    if (has("обязател|непременно|принципиальн|строго|только|\\b(?:required|mandatory|must have)\\b", clause)) return "required";
    if (has("(?:^|\\s)(?:хочу|хотим|нужен|нужна|нужно|нужны|добавь|добавить)(?:\\s|$)", clause)) return "add";
    return null;
  }
  private static boolean has(String pattern, String text) { return Pattern.compile(pattern).matcher(text).find(); }
  static boolean unsupportedAmenityAbsence(String text) {
    String normalized = text.toLowerCase(java.util.Locale.ROOT).replace('ё', 'е');
    return parse(normalized).stream().anyMatch(clause ->
        Amenities.patterns().values().stream().anyMatch(pattern -> has(pattern, clause.text()))
            && !clause.action().equals("remove") && !clause.action().equals("optional")
            && has("(?:^|\\s)без\\s|не должно быть|не было|отсутств|\\bwithout\\b", clause.text()));
  }
  static boolean unsupportedAmenityDetail(String text) {
    String normalized = text.toLowerCase(java.util.Locale.ROOT).replace('ё', 'е');
    return parse(normalized).stream().anyMatch(clause ->
        Amenities.patterns().values().stream().anyMatch(pattern -> has(pattern, clause.text()))
            && (has("бесплат|включен.{0,16}(?:цен|стоим)|подогрев|горк|круглосуточ|частн.{0,12}бассейн|приватн.{0,12}бассейн|\\d+\\s*(?:мбит|mbps)|\\b(?:free|heated|private pool)\\b", clause.text())
                || Amenities.definitions().entrySet().stream().anyMatch(entry ->
                    entry.getValue().scope().equals("room")
                        && has(Amenities.patterns().get(entry.getKey()), clause.text())
                        && has("общ(?:ая|ей|ую|ем|ий|его)|совместн|прачечн|лобби|\\b(?:shared|communal|lobby|laundry room)\\b", clause.text()))));
  }
}
