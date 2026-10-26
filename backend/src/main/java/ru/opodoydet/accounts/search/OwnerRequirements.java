package ru.opodoydet.accounts.search;

import java.util.*;
import java.util.function.IntPredicate;
import java.util.regex.Pattern;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/** Recognizes a small explicit guest-query grammar; source values remain private. */
final class OwnerRequirements {
  static final String SOURCE = "Сведения отельера; независимая проверка не проведена.";

  private record FloorRule(String label, IntPredicate accepts, boolean required) {}

  private record DirectionRule(
      String label, Set<String> directions, boolean negative, boolean all, boolean required) {}

  private final List<FloorRule> floors;
  private final List<DirectionRule> directions;

  private OwnerRequirements(List<FloorRule> floors, List<DirectionRule> directions) {
    this.floors = List.copyOf(floors);
    this.directions = List.copyOf(directions);
  }

  static OwnerRequirements parse(String query) {
    List<FloorRule> floors = new ArrayList<>();
    List<DirectionRule> directions = new ArrayList<>();
    for (String sentence : OwnerNotesExtractor.normalize(query).split("[.!?;,\\n]+")) {
      boolean required = !sentence.matches(".*(?:желательно|предпочтительно|по возможности).*");
      addFloor(
          sentence,
          "не выше\\s*(-?\\d{1,3})(?:-?(?:го|й))?\\s*этаж",
          "Этаж не выше ",
          (number, value) -> value <= number,
          required,
          floors);
      addFloor(
          sentence,
          "этаж\\s*(?:должен быть\\s*)?не выше\\s*(-?\\d{1,3})",
          "Этаж не выше ",
          (number, value) -> value <= number,
          required,
          floors);
      addFloor(
          sentence,
          "не ниже\\s*(-?\\d{1,3})(?:-?(?:го|й))?\\s*этаж",
          "Этаж не ниже ",
          (number, value) -> value >= number,
          required,
          floors);
      addFloor(
          sentence,
          "этаж\\s*(?:должен быть\\s*)?не ниже\\s*(-?\\d{1,3})",
          "Этаж не ниже ",
          (number, value) -> value >= number,
          required,
          floors);
      addFloor(
          sentence,
          "(?<!не )(?<!не\\s{2})(?:на|именно)\\s+(-?\\d{1,3})(?:-?(?:м|ом))?\\s*этаже",
          "Этаж ",
          (number, value) -> value == number,
          required,
          floors);
      addFloor(
          sentence,
          "не на\\s+(-?\\d{1,3})(?:-?(?:м|ом))?\\s*этаже",
          "Не этаж ",
          (number, value) -> value != number,
          required,
          floors);
      if (Pattern.compile("не (?:первый|на первом|1-й|на 1-м) этаж").matcher(sentence).find())
        floors.add(new FloorRule("Не первый этаж", value -> value != 1, required));
      var windows =
          Pattern.compile("окн[^.!?;]{0,25}?(не\\s+)?на\\s+([^.!?;]{1,100})").matcher(sentence);
      if (windows.find()) {
        String tail = windows.group(2);
        Set<String> values = new LinkedHashSet<>();
        List<String> labels = new ArrayList<>();
        var compass =
            Pattern.compile(
                    "северо[- ]восток|северо[- ]запад|юго[- ]восток|юго[-"
                        + " ]запад|север|юг|восток|запад")
                .matcher(tail);
        while (compass.find()) {
          String label = compass.group();
          values.add(direction(label));
          labels.add(label);
        }
        if (!values.isEmpty()) {
          String prefix = sentence.substring(windows.start(), windows.start(2));
          if (prefix.contains("не только") || prefix.contains("не важ") || prefix.contains("неваж"))
            continue;
          boolean no = Pattern.compile("(?U)\\bне\\b").matcher(prefix).find(),
              all = !tail.contains("или");
          directions.add(
              new DirectionRule(
                  "Окна " + (no ? "не " : "") + "на " + String.join(all ? " и " : " или ", labels),
                  Set.copyOf(values),
                  no,
                  all,
                  required));
        }
      }
    }
    return new OwnerRequirements(floors, directions);
  }

  boolean any() {
    return !floors.isEmpty() || !directions.isEmpty();
  }

  List<JsonNode> decisions(Integer floor, Set<String> facing, boolean ownerListing) {
    List<JsonNode> result = new ArrayList<>();
    for (int i = 0; i < floors.size(); i++) {
      FloorRule rule = floors.get(i);
      result.add(
          decision(
                  "floor",
                  rule.label(),
                  rule.required(),
                  floor != null,
                  floor != null && rule.accepts().test(floor),
                  ownerListing)
              .put("id", "floor-" + i));
    }
    for (int i = 0; i < directions.size(); i++) {
      DirectionRule rule = directions.get(i);
      boolean known = !facing.isEmpty();
      boolean matched =
          known
              && (rule.negative()
                  ? Collections.disjoint(facing, rule.directions())
                  : rule.all()
                      ? facing.containsAll(rule.directions())
                      : !Collections.disjoint(facing, rule.directions()));
      result.add(
          decision("window_direction", rule.label(), rule.required(), known, matched, ownerListing)
              .put("id", "window_direction-" + i));
    }
    return result;
  }

  private static ObjectNode decision(
      String feature,
      String label,
      boolean required,
      boolean known,
      boolean matched,
      boolean ownerListing) {
    String explanation =
        !known
            ? "Недостаточно сведений для проверки этого пожелания."
            : matched
                ? "Пожелание выполняется по сведениям отельера."
                : "Пожелание не выполняется по сведениям отельера.";
    String source =
        ownerListing
            ? SOURCE
            : "В открытом каталоге нет подтверждённых сведений об этаже и сторонах света.";
    return Json.obj(
        "feature",
        feature,
        "label",
        label,
        "required",
        required,
        "status",
        matched ? "match" : "mismatch",
        "evidenceStatus",
        !known ? "unknown" : matched ? "match" : "mismatch",
        "assumed",
        true,
        "explanation",
        explanation + " " + source,
        "sourceExplanation",
        source);
  }

  @FunctionalInterface
  private interface Check {
    boolean test(int number, int value);
  }

  private static void addFloor(
      String sentence,
      String regex,
      String label,
      Check check,
      boolean required,
      List<FloorRule> rules) {
    if (!sentence.contains("этаж")) return;
    var matcher = Pattern.compile(regex).matcher(sentence);
    while (matcher.find()) {
      int number = Integer.parseInt(matcher.group(1));
      if (number >= -3
          && number <= 200
          && rules.stream()
              .noneMatch(
                  rule -> rule.label().equals(label + number) && rule.required() == required))
        rules.add(new FloorRule(label + number, value -> check.test(number, value), required));
    }
  }

  private static String direction(String label) {
    return switch (label.replace(' ', '-')) {
      case "север" -> "north";
      case "северо-восток" -> "north_east";
      case "восток" -> "east";
      case "юго-восток" -> "south_east";
      case "юг" -> "south";
      case "юго-запад" -> "south_west";
      case "запад" -> "west";
      case "северо-запад" -> "north_west";
      default -> throw new IllegalArgumentException("Unknown direction");
    };
  }
}
