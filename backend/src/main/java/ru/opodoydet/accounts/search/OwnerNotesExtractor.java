package ru.opodoydet.accounts.search;

import java.util.*;
import java.util.regex.Pattern;

/** Local bounded extraction: no model call, source quotation or private text in the result. */
public final class OwnerNotesExtractor {
  private static final Pattern UNCERTAIN =
      Pattern.compile(
          "(?U)возможн|не знаю|неизвест|не уверен|уточн|вероят|кажется|не провер|не"
              + " всегда|част[ьи]|некотор|при условии|\\bесли\\b|зависит"
              + "|(?:номер|комнат)\\p{L}*\\s*№?\\s*\\d|друг\\p{L}*\\s+(?:номер|корпус|здани)|соседн\\p{L}*\\s+корпус");
  private static final Pattern DISTANCE =
      Pattern.compile(
          "(?:до пляжа|пляж)(?:\\s+(?:пешком|по"
              + " маршруту|расстояние|составляет|около|примерно))?\\s*[:—–-]?\\s*(\\d+(?:[.,]\\d+)?)\\s*(км|километр\\p{L}*|м(?:етр\\p{L}*)?)(?!\\p{L})");

  private OwnerNotesExtractor() {}

  record Assertions(Map<String, Boolean> values, Set<String> conflicts) {}

  public static Map<String, Boolean> extract(String notes) {
    return assess(notes).values();
  }

  static Assertions assess(String notes) {
    String normalized = normalize(notes);
    boolean qualified = notes.contains("?") || UNCERTAIN.matcher(normalized).find();
    // A standalone qualification can refer to the whole description. Never guess its scope.
    if (Pattern.compile("(?U)(?:^|[.!?;\\n]\\s*)(?:не уверен[а]?|не знаю|возможно|вероятно|кажется)[.!?;\\s]*(?:$|[.!?;\\n])")
        .matcher(normalized).find()) return new Assertions(Map.of(), Set.of());
    Map<String, Set<Boolean>> observations = new HashMap<>();
    Set<String> uncertain = new HashSet<>();
    // Keep question marks attached, while decimal separators remain part of a distance.
    for (String raw : normalized.split("(?<=[.!?;\\n])(?!\\d)")) {
      String text = raw.trim();
      if (text.isEmpty()) continue;
      boolean doubtful = text.contains("?") || UNCERTAIN.matcher(text).find();
      observe(
          "family",
          text,
          doubtful,
          "(?U)(?:подходит|предусмотрено|разрешено|принимаем).{0,35}(?:семей\\p{L}*|семь[яиюе]|дет(?:и|ей|ьми|ям|ях))\\b|семейн(?:ый|ое|ая)"
              + " (?:номер|размещение|комната)|(?:с"
              + " детьми|дети).{0,20}(?:можно|разрешен|принимаются)",
          "(?U)не подходит.{0,35}(?:семей\\p{L}*|семь[яиюе]|дет(?:и|ей|ьми|ям|ях))\\b|(?:с"
              + " детьми|дети).{0,25}(?:нельзя|запрещен|не допускаются)|без детей|только для"
          + " взрослых|не принимаем.{0,15}дет(?:ей|и|ьми)\\b|не разрешено.{0,35}дет(?:ей|и|ьми)\\b",
          observations,
          uncertain);
      observe(
          "courtyard",
          text,
          doubtful,
          "окн.{0,40}во двор",
          "окн.{0,35}(?:на улицу|на дорогу|на проспект)|окн.{0,20}не.{0,15}во двор",
          observations,
          uncertain);
      observe(
          "step_free_access",
          text,
          doubtful,
          "(?:путь|проход|доступ|вход|от улицы).{0,55}до номера.{0,25}без (?:ступен|лестниц)|без"
              + " (?:ступен|лестниц).{0,40}(?:от улицы|до номера)",
          "(?:до номера|в номер|пути к номеру).{0,35}(?:есть ступен|есть лестниц|со ступен|по"
              + " лестниц)|(?:ступени|лестница).{0,35}(?:до номера|в номер)|не.{0,15}без"
              + " ступен.{0,30}до номера|(?:перед|у|на) вход.{0,45}(?:ступен[ьи]|лестниц).{0,40}(?:пандуса?\\s+нет|без пандуса)",
          observations,
          uncertain);
      observe(
          "step_free_route",
          text,
          doubtful,
          "(?:путь|дорога|маршрут|проход).{0,35}до пляжа.{0,30}без (?:ступен|лестниц)|до"
              + " пляжа.{0,20}без (?:ступен|лестниц)",
          "(?:до пляжа|пути к пляжу).{0,35}(?:есть ступен|есть лестниц|со ступен|по"
              + " лестниц)|(?:ступени|лестница).{0,35}(?:до пляжа|к пляжу)|не.{0,15}без"
              + " ступен.{0,30}до пляжа",
          observations,
          uncertain);
      var distance = DISTANCE.matcher(text);
      while (distance.find()) {
        if (doubtful
            || !Pattern.compile("пешком|пешеход|пеший").matcher(text).find()
            || Pattern.compile(
                    "(?U)\\bне\\b|больше|дальше|по прямой|на" + " машине|автомобил|транспорт")
                .matcher(text)
                .find()) {
          uncertain.add("beach_walk");
          continue;
        }
        double meters =
            Double.parseDouble(distance.group(1).replace(',', '.'))
                * (distance.group(2).startsWith("к") ? 1000 : 1);
        if (meters < 0 || meters > 100000) uncertain.add("beach_walk");
        else observations.computeIfAbsent("beach_walk", key -> new HashSet<>()).add(meters <= 1000);
      }
    }
    Map<String, Boolean> result = new HashMap<>();
    Set<String> conflicts = new HashSet<>();
    observations.forEach(
        (feature, values) -> {
          if (values.size() > 1) conflicts.add(feature);
          if (values.size() == 1 && !uncertain.contains(feature)) {
            boolean value = values.iterator().next();
            // Unrelated uncertainty must not erase an explicit independent contraindication.
            // Positive claims still fail closed if the overall description is qualified.
            if (!qualified || !value) result.put(feature, value);
          }
        });
    return new Assertions(Map.copyOf(result), Set.copyOf(conflicts));
  }

  private static void observe(
      String feature,
      String text,
      boolean doubtful,
      String positive,
      String negative,
      Map<String, Set<Boolean>> observations,
      Set<String> uncertain) {
    boolean no = Pattern.compile(negative).matcher(text).find(),
        yes = Pattern.compile(positive).matcher(text).find();
    if (!yes && !no) return;
    if (doubtful
        || (yes
            && !no
            && Pattern.compile("(?U)\\b(?:не|нет|нельзя|запрещено)\\b").matcher(text).find())) {
      uncertain.add(feature);
      return;
    }
    // A literal negation dominates a positive substring within the same assertion.
    observations.computeIfAbsent(feature, key -> new HashSet<>()).add(!no);
  }

  static String normalize(String value) {
    return value
        .toLowerCase(Locale.ROOT)
        .replace('ё', 'е')
        .replace('−', '-')
        .replace('‑', '-')
        .replaceAll("[\\t ]+", " ");
  }
}
