package ru.opodoydet.domain;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public final class Validation {
  private Validation() {}

  public static String text(JsonNode input, String key, int min, int max) {
    JsonNode value = input.path(key);
    if (!value.isTextual() || value.textValue().length() < min || value.textValue().length() > max)
      throw new IllegalArgumentException("Некорректное поле: " + key);
    return value.textValue();
  }

  public static boolean bool(JsonNode input, String key) {
    if (!input.path(key).isBoolean())
      throw new IllegalArgumentException("Ожидается логическое значение: " + key);
    return input.path(key).booleanValue();
  }

  public static void integer(JsonNode input, String key, int min, int max) {
    JsonNode value = input.path(key);
    if (!value.isIntegralNumber()
        || !value.canConvertToInt()
        || value.intValue() < min
        || value.intValue() > max)
      throw new IllegalArgumentException("Некорректное число гостей: " + key);
  }

  public static String feature(JsonNode input, String key) {
    String feature = text(input, key, 1, 50);
    Features.get(feature);
    return feature;
  }

  public static JsonNode trip(JsonNode input, String region) {
    return trip(input, region, false);
  }

  public static JsonNode tripDraft(JsonNode input, String region) {
    return trip(input, region, true);
  }

  private static JsonNode trip(JsonNode input, String region, boolean draft) {
    if (input.has("admissionMode")
        && (!input.path("admissionMode").isTextual()
            || !Set.of("explore", "verified").contains(input.path("admissionMode").asText())))
      throw new IllegalArgumentException("Некорректный режим подбора");
    if (!input.isObject() || !text(input, "region", 1, 100).equals(region))
      throw new IllegalArgumentException("Доступен регион: " + region);
    String from = text(input, "checkIn", draft ? 0 : 10, 10),
        to = text(input, "checkOut", draft ? 0 : 10, 10);
    if (!(draft && from.isEmpty() && to.isEmpty())) {
      try {
        if (!from.matches("\\d{4}-\\d{2}-\\d{2}")
            || !to.matches("\\d{4}-\\d{2}-\\d{2}")
            || !LocalDate.parse(to).isAfter(LocalDate.parse(from)))
          throw new IllegalArgumentException("Дата выезда должна быть позже даты заезда");
      } catch (DateTimeParseException e) {
        throw new IllegalArgumentException("Некорректная дата");
      }
    }
    integer(input, "adults", 1, 6);
    integer(input, "children", 0, 4);
    text(input, "text", 0, 1500);
    JsonNode scenarios = input.path("scenarios");
    Set<String> unique = new HashSet<>();
    if (!scenarios.isArray() || scenarios.size() > 3)
      throw new IllegalArgumentException("Некорректные сценарии");
    for (JsonNode scenario : scenarios)
      if (!scenario.isTextual()
          || !Set.of("sea", "family", "quiet").contains(scenario.asText())
          || !unique.add(scenario.asText()))
        throw new IllegalArgumentException("Некорректные или повторяющиеся сценарии");
    preferences(input.path("preferences"), true);
    if (input.has("locationWishes"))
      ru.opodoydet.application.places.PlaceSearch.validateWishes(input.path("locationWishes"));
    if (input.hasNonNull("pendingLocationQuery"))
      ru.opodoydet.application.places.PlaceSearch.validatePending(input.path("pendingLocationQuery"));
    if (input.has("preferenceOverrides")) {
      preferences(input.path("preferenceOverrides"), true);
      for (JsonNode override : input.path("preferenceOverrides")) bool(override, "enabled");
    }
    if (input.has("hotelFilters")) hotelFilters(input.path("hotelFilters"));
    return input;
  }

  public static void hotelFilters(JsonNode filters) {
    if (!filters.isObject()) throw new IllegalArgumentException("Некорректные фильтры жилья");
    filters.fieldNames().forEachRemaining(key -> {
      if (!Set.of("query", "lodgingTypes", "maxPricePerNight", "maxBeachMeters", "nearby").contains(key))
        throw new IllegalArgumentException("Неизвестный фильтр жилья: " + key);
    });
    if (filters.has("query")) text(filters, "query", 0, 240);
    if (filters.has("nearby")) {
      JsonNode nearby = filters.path("nearby");
      Set<String> kinds = Set.of("cafe", "restaurant", "supermarket", "convenience", "pharmacy", "park",
          "subway", "museum", "shopping_mall", "beach", "train_station", "city_center");
      Set<String> unique = new HashSet<>();
      if (!nearby.isArray() || nearby.size() > kinds.size())
        throw new IllegalArgumentException("Некорректные условия расположения");
      for (JsonNode requirement : nearby) {
        if (!requirement.isObject() || requirement.size() != 2
            || !requirement.path("kind").isTextual()
            || !kinds.contains(requirement.path("kind").asText())
            || !unique.add(requirement.path("kind").asText()))
          throw new IllegalArgumentException("Некорректные или повторяющиеся условия расположения");
        JsonNode limit = requirement.path("maxMeters");
        if (!limit.isNumber() || !Double.isFinite(limit.asDouble())
            || limit.asDouble() < 1 || limit.asDouble() > 10_000)
          throw new IllegalArgumentException("Расстояние до места должно быть от 1 до 10000 метров");
      }
    }
    if (filters.has("lodgingTypes")) {
      JsonNode types = filters.path("lodgingTypes");
      Set<String> unique = new HashSet<>();
      if (!types.isArray() || types.size() > 5)
        throw new IllegalArgumentException("Некорректные типы жилья");
      for (JsonNode type : types)
        if (!type.isTextual() || !Set.of("hotel", "motel", "guest_house", "hostel", "apartment").contains(type.asText())
            || !unique.add(type.asText())) throw new IllegalArgumentException("Некорректные или повторяющиеся типы жилья");
    }
    for (String key : List.of("maxPricePerNight", "maxBeachMeters")) {
      if (!filters.has(key)) continue;
      JsonNode value = filters.path(key);
      double maximum = key.equals("maxPricePerNight") ? 100_000_000 : 100_000;
      if (!value.isNumber() || !Double.isFinite(value.asDouble()) || value.asDouble() <= 0 || value.asDouble() > maximum)
        throw new IllegalArgumentException("Некорректное ограничение: " + key);
    }
  }

  public static void preferences(JsonNode values, boolean unique) {
    if (!values.isArray() || values.size() > Features.ids().size())
      throw new IllegalArgumentException("Некорректные пожелания");
    Set<String> ids = new HashSet<>();
    for (JsonNode value : values) {
      String feature = feature(value, "feature");
      bool(value, "required");
      if (unique && !ids.add(feature)) throw new IllegalArgumentException("Пожелания повторяются");
    }
  }

  public static void extraction(JsonNode result, String feature, String text) {
    JsonNode values = result.path("extractions");
    if (!values.isArray() || values.size() > 1)
      throw new IllegalArgumentException("Ответ должен описывать одно условие выбранной категории");
    if (!values.isEmpty() && !Features.get(feature).tool().equals("host"))
      throw new IllegalArgumentException("Условие района нельзя подтвердить ответом отельера");
    for (JsonNode value : values) {
      if (!feature(value, "feature").equals(feature)
          || !text.contains(text(value, "quote", 1, 1500)))
        throw new IllegalArgumentException("Факт не подтверждён исходным ответом");
      bool(value, "value");
    }
    strings(result.path("warnings"));
  }

  public static void strings(JsonNode values) {
    if (!values.isArray() || values.size() > 20)
      throw new IllegalArgumentException("Некорректный список пояснений");
    for (JsonNode value : values)
      if (!value.isTextual() || value.asText().length() > 3000)
        throw new IllegalArgumentException("Некорректное пояснение");
  }
}
