package ru.opodoydet.accounts.search;

import java.sql.SQLException;
import java.util.*;
import java.util.stream.Collectors;
import ru.opodoydet.accounts.listings.ListingRepository;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.application.SearchExtension;
import ru.opodoydet.domain.Features;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Public projections of private owner assertions. No private notes or raw facts cross this
 * boundary.
 */
public final class OwnerListingSearchProvider implements SearchExtension {
  private final AccountDatabase db;
  private final ListingRepository listings;
  private final SearchProfileRepository profiles;

  private record Source(
      ObjectNode listing, Map<String, Boolean> assertions, Integer floor, Set<String> directions) {}

  public OwnerListingSearchProvider(AccountDatabase db) {
    this.db = db;
    listings = new ListingRepository(db);
    profiles = new SearchProfileRepository(db);
  }

  @Override
  public Snapshot snapshot(JsonNode trip) throws SQLException {
    OwnerRequirements requirements = OwnerRequirements.parse(Json.str(trip, "text"));
    int guests = trip.path("adults").asInt() + trip.path("children").asInt();
    List<Source> sources =
        db.transaction(
            () -> {
              List<Source> values = new ArrayList<>();
              for (ObjectNode listing : listings.published()) {
                if (!Json.str(listing, "city").equalsIgnoreCase(Json.str(trip, "region"))) continue;
                ObjectNode profile = profiles.find(Json.str(listing, "id"));
                values.add(
                    new Source(
                        listing.deepCopy(),
                        OwnerNotesExtractor.extract(Json.str(profile, "notes")),
                        listing.path("floor").isIntegralNumber()
                            ? listing.path("floor").asInt()
                            : null,
                        Json.list(listing.path("windowDirections")).stream()
                            .map(JsonNode::asText)
                            .collect(Collectors.toUnmodifiableSet())));
              }
              return List.copyOf(values);
            });
    return new Snapshot() {
      public int additionalHotels() {
        return sources.size();
      }

      public List<JsonNode> apply(List<JsonNode> baseline, List<JsonNode> preferences) {
        List<JsonNode> ranked = new ArrayList<>();
        for (JsonNode match : baseline) {
          ObjectNode decorated = (ObjectNode) match.deepCopy();
          if (requirements.any())
            decorate(decorated, requirements.decisions(null, Set.of(), false));
          ranked.add(decorated);
        }
        for (Source source : sources) {
          ObjectNode match = rank(source, preferences, guests);
          if (requirements.any())
            decorate(match, requirements.decisions(source.floor(), source.directions(), true));
          ranked.add(match);
        }
        ranked.sort(
            Comparator.comparingInt(
                    (JsonNode match) ->
                        Json.str(match.path("best"), "status").equals("fits") ? 0 : 1)
                .thenComparing(
                    Comparator.comparingInt(
                            (JsonNode match) -> match.path("best").path("score").asInt())
                        .reversed())
                .thenComparingDouble(
                    match ->
                        match
                            .path("hotel")
                            .path("route")
                            .path("meters")
                            .asDouble(Double.POSITIVE_INFINITY)));
        return ranked;
      }
    };
  }

  private static ObjectNode rank(Source source, List<JsonNode> preferences, int guests) {
    JsonNode listing = source.listing();
    String listingId = Json.str(listing, "id"), hotelId = "account-listing:" + listingId;
    ObjectNode room =
        Json.obj(
            "id",
            "account-room:" + listingId,
            "name",
            Json.str(listing, "roomType"),
            "capacity",
            listing.path("capacity"),
            "demo",
            false,
            "evidenceStatus",
            "unknown");
    ObjectNode hotel =
        Json.obj(
            "id",
            hotelId,
            "accountListingId",
            listingId,
            "name",
            Json.str(listing, "title"),
            "address",
            Json.str(listing, "address"),
            "floor",
            listing.path("floor"),
            "windowDirections",
            listing.path("windowDirections"),
            "photos",
            listing.path("photos"),
            "pricePerNight",
            listing.path("pricePerNight"),
            "currency",
            "KRW",
            "coordinates",
            null,
            "osmUrl",
            "",
            "rooms",
            List.of(room),
            "route",
            null,
            "noise",
            List.of(),
            "dataNotes",
            List.of(OwnerRequirements.SOURCE));
    List<JsonNode> criteria =
        preferences.stream().map(preference -> criterion(preference, source.assertions())).toList();
    boolean capacity = listing.path("capacity").asInt() >= guests;
    boolean fits =
        capacity
            && criteria.stream()
                .noneMatch(
                    c -> c.path("required").asBoolean() && !Json.str(c, "status").equals("match"));
    int score =
        criteria.stream().mapToInt(c -> Json.str(c, "status").equals("match") ? 3 : -2).sum();
    ObjectNode best =
        Json.obj(
            "room",
            room,
            "criteria",
            criteria,
            "status",
            fits ? "fits" : "excluded",
            "score",
            score,
            "capacityStatus",
            capacity ? "match" : "mismatch",
            "capacityEvidenceStatus",
            capacity ? "match" : "mismatch",
            "capacityAssumed",
            true,
            "capacityExplanation",
            (capacity
                    ? "Заявленной вместимости достаточно для выбранного числа гостей. "
                    : "Заявленной вместимости недостаточно для выбранного числа гостей. ")
                + OwnerRequirements.SOURCE);
    return Json.obj("hotel", hotel, "best", best, "rooms", List.of(best.deepCopy()));
  }

  private static JsonNode criterion(JsonNode preference, Map<String, Boolean> assertions) {
    String feature = Json.str(preference, "feature");
    Boolean value = assertions.get(feature);
    String explanation;
    if (Features.get(feature).tool().equals("area"))
      explanation =
          "Нет независимых данных о районе на даты поездки; сведения отельера не заменяют такую"
              + " проверку.";
    else if (value == null)
      explanation =
          "Из описания отельера нельзя однозначно установить выполнение этого пожелания. "
              + OwnerRequirements.SOURCE;
    else
      explanation =
          (value
                  ? "Пожелание выполняется по сведениям отельера. "
                  : "Пожелание не выполняется по сведениям отельера. ")
              + OwnerRequirements.SOURCE;
    return Json.obj(
        "feature",
        feature,
        "required",
        preference.path("required").asBoolean(),
        "status",
        Boolean.TRUE.equals(value) ? "match" : "mismatch",
        "evidenceStatus",
        value == null ? "unknown" : value ? "match" : "mismatch",
        "assumed",
        true,
        "decisionBasis",
        "estimate",
        "facts",
        List.of(),
        "explanation",
        explanation,
        "sourceExplanation",
        explanation,
        "assumption",
        OwnerRequirements.SOURCE);
  }

  private static void decorate(ObjectNode match, List<JsonNode> criteria) {
    match.set("ownerCriteria", Json.array(criteria));
    boolean blocked =
        criteria.stream()
            .anyMatch(
                c -> c.path("required").asBoolean() && !Json.str(c, "status").equals("match"));
    int score =
        criteria.stream().mapToInt(c -> Json.str(c, "status").equals("match") ? 3 : -2).sum();
    for (JsonNode room : match.path("rooms")) {
      ObjectNode changed = (ObjectNode) room;
      changed.put("score", room.path("score").asInt() + score);
      if (blocked) changed.put("status", "excluded");
    }
    ObjectNode best = (ObjectNode) match.path("best");
    best.put("score", best.path("score").asInt() + score);
    if (blocked) best.put("status", "excluded");
  }
}
