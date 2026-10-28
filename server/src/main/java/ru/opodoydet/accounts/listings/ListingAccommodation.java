package ru.opodoydet.accounts.listings;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import java.util.Set;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.Inputs;
import ru.opodoydet.shared.Json;

/** Owner-entered location and physical sleeping furniture, without environmental claims. */
final class ListingAccommodation {
  private static final Set<String> TYPES =
      Set.of("single", "double", "sofa", "bunk", "folding", "futon", "crib", "other");
  private static final Map<String, Integer> FIXED_PLACES =
      Map.of("single", 1, "double", 2, "bunk", 2, "folding", 1, "crib", 1);

  private ListingAccommodation() {}

  static void apply(ObjectNode listing, JsonNode input, JsonNode existing) {
    JsonNode coordinates = selected(input, existing, "coordinates");
    if (coordinates == null || coordinates.isNull() || coordinates.isMissingNode()) {
      listing.putNull("coordinates");
    } else {
      if (!coordinates.isArray() || coordinates.size() != 2
          || !coordinate(coordinates.get(0), 180) || !coordinate(coordinates.get(1), 90))
        throw new AccountProblem(400, "Выберите корректную точку на карте.");
      listing.set("coordinates", Json.array(java.util.List.of(coordinates.get(0).asDouble(), coordinates.get(1).asDouble())));
    }

    JsonNode rawBeds = selected(input, existing, "beds");
    ArrayNode beds = Json.MAPPER.createArrayNode();
    int total = 0;
    if (rawBeds != null && !rawBeds.isMissingNode()) {
      if (!rawBeds.isArray() || rawBeds.size() > 20)
        throw new AccountProblem(400, "Укажите не более 20 вариантов кроватей и диванов.");
      for (JsonNode bed : rawBeds) {
        String type = Inputs.text(bed, "type", "Тип спального места", 1, 20);
        if (!TYPES.contains(type))
          throw new AccountProblem(400, "Выберите тип кровати или дивана из списка.");
        int count = Inputs.integer(bed, "count", "Количество кроватей / диванов", 1, 20);
        int places = Inputs.integer(bed, "placesPerUnit", "Мест на одной кровати / диване", 1, 4);
        if (FIXED_PLACES.containsKey(type) && FIXED_PLACES.get(type) != places)
          throw new AccountProblem(400, "Количество мест не соответствует типу кровати.");
        ObjectNode normalized = Json.obj("type", type, "count", count, "placesPerUnit", places);
        if (bed.has("room")) {
          String room = Inputs.text(bed, "room", "Комната", 0, 60);
          if (!room.isEmpty()) normalized.put("room", room);
        }
        beds.add(normalized);
        if (!type.equals("crib")) total += count * places;
      }
    }
    JsonNode places = selected(input, existing, "sleepingPlaces");
    boolean missingPlaces = places == null || places.isMissingNode() || places.isNull();
    boolean published = Json.str(listing, "status").equals("published");
    // Preserve old, genuinely unknown layouts on unrelated edits. A new publication or an
    // explicit attempt to clear a published layout must satisfy today's publication contract.
    boolean unchangedLegacy = existing != null
        && Json.str(existing, "status").equals("published")
        && !existing.hasNonNull("sleepingPlaces") && existing.path("beds").isEmpty()
        && !input.has("sleepingPlaces") && !input.has("beds")
        && existing.path("capacity").equals(listing.path("capacity"));
    if (beds.isEmpty() && missingPlaces) {
      if (published && !unchangedLegacy)
        throw new AccountProblem(400, "Для публикации укажите спальные места и кровати / диваны.");
      listing.putNull("sleepingPlaces");
    } else {
      int declared = Inputs.integer(Json.obj("sleepingPlaces", places), "sleepingPlaces", "Спальные места", 1, 40);
      if (beds.isEmpty() || declared != total)
        throw new AccountProblem(400, "Число спальных мест должно совпадать с расстановкой кроватей; детская кроватка не входит в общий итог.");
      if (published && declared < listing.path("capacity").asInt())
        throw new AccountProblem(400, "Спальных мест должно хватать для указанного количества гостей.");
      listing.put("sleepingPlaces", declared);
    }
    listing.set("beds", beds);
    // The marker can only originate from an explicit fixture import, never a public request.
    listing.put("demo", existing != null && existing.path("demo").asBoolean());
  }

  private static boolean coordinate(JsonNode value, int bound) {
    return value.isNumber() && Double.isFinite(value.asDouble()) && Math.abs(value.asDouble()) <= bound;
  }

  private static JsonNode selected(JsonNode input, JsonNode existing, String key) {
    return input.has(key) ? input.path(key) : existing == null ? null : existing.path(key);
  }
}
