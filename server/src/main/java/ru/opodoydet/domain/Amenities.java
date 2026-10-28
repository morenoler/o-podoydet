package ru.opodoydet.domain;

import java.util.LinkedHashMap;
import java.util.Map;

/** Exact feature meanings; public descriptive prose is never converted to these values. */
public final class Amenities {
  private Amenities() {}
  public static Map<String, Features.Definition> definitions() {
    Map<String, Features.Definition> values = new LinkedHashMap<>();
    add(values, "dishwasher", "Посудомоечная машина", "room", "Есть ли посудомоечная машина в самом номере?", "В номере есть посудомоечная машина", "В номере нет посудомоечной машины");
    add(values, "washing_machine", "Стиральная машина", "room", "Есть ли стиральная машина в самом номере, а не общая прачечная?", "В номере есть стиральная машина", "В номере нет стиральной машины");
    add(values, "pool", "Бассейн", "hotel", "Есть ли бассейн на территории и открыт ли он на даты поездки?", "На территории есть бассейн", "На территории нет бассейна");
    add(values, "kitchen", "Своя кухня", "room", "Есть ли собственная кухня в этом номере?", "В номере есть своя кухня", "В номере нет своей кухни");
    add(values, "wifi", "Wi-Fi в номере", "room", "Доступен ли Wi-Fi в самом номере?", "В номере доступен Wi-Fi", "В номере нет Wi-Fi");
    add(values, "air_conditioning", "Кондиционер", "room", "Есть ли кондиционер в этом номере?", "В номере есть кондиционер", "В номере нет кондиционера");
    add(values, "parking", "Парковка", "hotel", "Есть ли парковка на территории и нужно ли бронировать место?", "На территории есть парковка", "На территории нет парковки");
    add(values, "balcony", "Балкон", "room", "Есть ли собственный балкон у этого номера?", "У номера есть балкон", "У номера нет балкона");
    add(values, "breakfast", "Завтрак", "hotel", "Предлагается ли завтрак и входит ли он в стоимость?", "Объект предлагает завтрак", "Объект не предлагает завтрак");
    add(values, "pets_allowed", "Можно с питомцем", "room", "Разрешены ли питомцы в этом номере и какие есть ограничения?", "В этом номере разрешены питомцы", "В этом номере питомцы не разрешены");
    return values;
  }
  private static void add(Map<String, Features.Definition> values, String id, String label, String scope, String question, String positive, String negative) {
    values.put(id, new Features.Definition(label, scope, "amenity", question, positive, negative, null));
  }
  public static boolean contains(String id) { return patterns().containsKey(id); }
  public static Map<String, String> patterns() {
    return Map.of(
        "dishwasher", "посудомоеч|посудомой|\\bdishwashers?\\b",
        "washing_machine", "стиральн|стиралк|\\bwashing machines?\\b|\\bwashers?\\b",
        "pool", "бассейн|\\b(?:swimming )?pool\\b",
        "kitchen", "кухн|готовить (?:сам|еду)|\\bkitchen\\b",
        "wifi", "wi[ -]?fi|вай[ -]?фай|вайфай|интернет",
        "air_conditioning", "кондиционер|\\bair conditioning\\b",
        "parking", "парков|стоянк|\\bparking\\b",
        "balcony", "балкон|\\bbalcony\\b",
        "breakfast", "завтрак|\\bbreakfast\\b",
        "pets_allowed", "питомц|питомец|с собак|с кошк|с котом|\\bpets? allowed\\b|\\bpet[ -]friendly\\b");
  }
}
