package ru.opodoydet.accounts.search;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;
import ru.opodoydet.accounts.listings.ListingRepository;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.accounts.clarifications.ClarificationRepository;
import ru.opodoydet.accounts.clarifications.ClarificationScope;
import ru.opodoydet.accounts.clarifications.ClarificationService;
import ru.opodoydet.accounts.clarifications.ReportedEvidence;
import ru.opodoydet.application.SearchExtension;
import ru.opodoydet.domain.Features;
import ru.opodoydet.domain.AdmissionPolicy;
import ru.opodoydet.shared.Json;

/**
 * Public projections of private owner assertions. No private notes or raw facts cross this
 * boundary.
 */
public final class OwnerListingSearchProvider implements SearchExtension {
  private final AccountDatabase db;
  private final ListingRepository listings;
  private final SearchProfileRepository profiles;
  private final ClarificationRepository clarifications;
  private final Clock clock;

  private record Source(
      ObjectNode listing, Map<String, Boolean> assertions, Set<String> conflicts,
      List<JsonNode> statements, Integer floor, Set<String> directions) {}

  public OwnerListingSearchProvider(AccountDatabase db) {
    this(db, Clock.systemUTC());
  }

  public OwnerListingSearchProvider(AccountDatabase db, Clock clock) {
    this.db = db;
    this.clock = clock;
    listings = new ListingRepository(db);
    profiles = new SearchProfileRepository(db);
    clarifications = new ClarificationRepository(db);
  }

  @Override
  public Snapshot snapshot(JsonNode trip) throws SQLException {
    OwnerRequirements requirements = OwnerRequirements.parse(Json.str(trip, "text"));
    int guests = trip.path("adults").asInt() + trip.path("children").asInt();
    Instant now = clock.instant();
    List<Source> sources =
        db.readTransaction(
            () -> {
              List<Source> values = new ArrayList<>();
              for (ObjectNode listing : listings.published()) {
                if (!Json.str(listing, "city").equalsIgnoreCase(Json.str(trip, "region"))) continue;
                ObjectNode profile = profiles.find(Json.str(listing, "id"));
                var evidence = OwnerNotesExtractor.assess(Json.str(profile, "notes"));
                String fingerprint = ClarificationScope.fingerprint(listing, db);
                List<JsonNode> statements = clarifications.statements(Json.str(listing, "id")).stream()
                    .map(answer -> (JsonNode) ClarificationService.statement(answer, fingerprint, now)).toList();
                values.add(
                    new Source(
                        listing.deepCopy(),
                        evidence.values(), evidence.conflicts(), statements,
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

      public List<JsonNode> personalCriteria() {
        return requirements.decisions(null, Set.of(), false).stream()
            .map(criterion -> (JsonNode) Json.obj(
                "id", criterion.path("id"), "feature", criterion.path("feature"),
                "label", criterion.path("label"), "required", criterion.path("required")))
            .toList();
      }

      public List<JsonNode> apply(List<JsonNode> baseline, List<JsonNode> preferences) {
        List<JsonNode> ranked = new ArrayList<>();
        for (JsonNode match : baseline) {
          ObjectNode decorated = match.deepCopy();
          if (requirements.any())
            decorate(decorated, requirements.decisions(null, Set.of(), false), trip);
          ranked.add(decorated);
        }
        for (Source source : sources) {
          ObjectNode match = rank(source, preferences, guests, trip);
          if (requirements.any())
            decorate(match, requirements.decisions(source.floor(), source.directions(), true), trip);
          ranked.add(match);
        }
        ranked.sort(
            Comparator.comparingInt(
                    (JsonNode match) ->
                        Json.str(match.path("best"), "status").equals("fits") ? 0 : 1)
                .thenComparing(match -> match.path("best").path("provisional").asBoolean())
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

  private static ObjectNode rank(Source source, List<JsonNode> preferences, int guests, JsonNode trip) {
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
            "sleepingPlaces",
            listing.path("sleepingPlaces"),
            "beds",
            listing.path("beds"),
            "amenities",
            listing.path("amenities"),
            "demo",
            listing.path("demo").asBoolean(),
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
            Json.str(listing, "currency"),
            "region",
            Json.str(trip, "region"),
            "coordinates",
            listing.path("coordinates"),
            "synthetic",
            listing.path("demo").asBoolean(),
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
        preferences.stream().map(preference -> criterion(preference, source, trip)).toList();
    boolean capacity = listing.path("capacity").asInt() >= guests;
    int score =
        criteria.stream().mapToInt(c -> Json.str(c, "status").equals("match") ? 3 : -2).sum();
    ObjectNode best =
        Json.obj(
            "room",
            room,
            "criteria",
            criteria,
            "score",
            score,
            "capacityStatus",
            capacity ? "match" : "mismatch",
            "capacityEvidenceStatus",
            capacity ? "match" : "mismatch",
            "capacityAssumed",
            true,
            "capacitySource",
            "owner",
            "capacityExplanation",
            (capacity
                    ? "Заявленной вместимости достаточно для выбранного числа гостей. "
                    : "Заявленной вместимости недостаточно для выбранного числа гостей. ")
                + OwnerRequirements.SOURCE);
    best.setAll(AdmissionPolicy.decide(best, criteria, trip));
    return Json.obj("hotel", hotel, "best", best, "rooms", List.of(best.deepCopy()));
  }

  private static JsonNode criterion(JsonNode preference, Source source, JsonNode trip) {
    String feature = Json.str(preference, "feature");
    boolean area = Features.get(feature).tool().equals("area");
    Boolean value = area ? null : source.assertions().get(feature);
    ReportedEvidence.Assessment reported = ReportedEvidence.assess(source.statements(), feature, trip);
    ReportedEvidence.Decision decision = ReportedEvidence.combine(value, source.conflicts().contains(feature), reported);
    value = decision.value();
    String evidenceStatus = decision.status();
    boolean conflict = evidenceStatus.equals("conflict");
    String explanation;
    if (Features.get(feature).tool().equals("area"))
      explanation =
          "Нет независимых данных о районе на даты поездки; сведения отельера не заменяют такую"
              + " проверку.";
    else if (conflict)
      explanation = "Сведения отельера об этом условии противоречат друг другу. Требуется уточнение.";
    else if (evidenceStatus.equals("stale"))
      explanation = "Срок перепроверки ответа владельца истёк. Условие нужно уточнить заново.";
    else if (value == null && !reported.evidence().isEmpty())
      explanation = "Ответ владельца пока не позволяет проверить условие для выбранных дат и текущего варианта размещения. " + OwnerRequirements.SOURCE;
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
    ObjectNode result = Json.obj(
        "feature",
        feature,
        "required",
        preference.path("required").asBoolean(),
        "status",
        !conflict && Boolean.TRUE.equals(value) ? "match" : "mismatch",
        "evidenceStatus",
        evidenceStatus,
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
    if (!reported.evidence().isEmpty()) result.set("reportedEvidence", Json.array(reported.evidence()));
    return result;
  }

  private static void decorate(ObjectNode match, List<JsonNode> criteria, JsonNode trip) {
    match.set("ownerCriteria", Json.array(criteria));
    boolean blocked =
        criteria.stream()
            .anyMatch(
                c -> c.path("required").asBoolean() && !AdmissionPolicy.permits(c, trip));
    boolean preliminary = criteria.stream().anyMatch(c -> c.path("required").asBoolean()
        && !Json.str(c, "status").equals("match"));
    int score =
        criteria.stream().mapToInt(c -> Json.str(c, "status").equals("match") ? 3 : -2).sum();
    for (JsonNode room : match.path("rooms")) {
      ObjectNode changed = (ObjectNode) room;
      changed.put("score", room.path("score").asInt() + score);
      if (blocked) changed.put("status", "excluded").put("provisional", false);
      else if (Json.str(changed, "status").equals("fits") && preliminary) changed.put("provisional", true);
    }
    ObjectNode best = (ObjectNode) match.path("best");
    best.put("score", best.path("score").asInt() + score);
    if (blocked) best.put("status", "excluded").put("provisional", false);
    else if (Json.str(best, "status").equals("fits") && preliminary) best.put("provisional", true);
  }
}
