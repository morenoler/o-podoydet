package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.domain.BinaryDecisionPolicy;
import ru.opodoydet.domain.Features;
import ru.opodoydet.domain.Matching;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;
import ru.opodoydet.web.Api;

class EnvironmentTest {
  @TempDir Path temporary;
  private static final Instant NOW = Instant.parse("2026-10-24T12:00:00Z");

  private static ObjectNode trip() {
    return Json.obj(
        "region",
        "Пусан",
        "checkIn",
        "2026-10-25",
        "checkOut",
        "2026-10-26",
        "adults",
        2,
        "children",
        0,
        "scenarios",
        List.of(),
        "preferences",
        List.of(),
        "text",
        "");
  }

  private static ObjectNode hotel() {
    return Json.obj(
        "id",
        "test",
        "name",
        "Тест",
        "coordinates",
        List.of(129.16, 35.16),
        "rooms",
        List.of(
            Json.obj(
                "id",
                "room",
                "capacity",
                2,
                "name",
                "Номер",
                "demo",
                false,
                "evidenceStatus",
                "verified",
                "sourceUrl",
                "https://example.org/test-room",
                "quote",
                "Synthetic fixture: maximum 2 guests",
                "obtainedAt",
                "2026-10-01T00:00:00Z")),
        "noise",
        List.of(),
        "route",
        null);
  }

  private static ObjectNode pref(String feature) {
    return Json.obj("feature", feature, "required", true);
  }

  private static ObjectNode forecast(double aqi) {
    List<JsonNode> hours = new ArrayList<>();
    Instant first = Instant.parse("2026-10-24T15:00:00Z");
    for (int i = 0; i < 24; i++)
      hours.add(
          Json.obj(
              "time",
              first.plusSeconds(i * 3600L).toString(),
              "usAqi",
              aqi,
              "pm25",
              3,
              "pm10",
              4,
              "no2",
              5));
    return Json.obj(
        "status",
        "available",
        "fetchedAt",
        NOW.toString(),
        "issuedAt",
        null,
        "sourceUrl",
        "https://open-meteo.com/en/docs/air-quality-api",
        "requestUrl",
        "https://air-quality-api.open-meteo.com/v1/air-quality",
        "timezone",
        "UTC",
        "tripTimezone",
        "Asia/Seoul",
        "intervalSeconds",
        3600,
        "model",
        "CAMS Global",
        "resolutionKm",
        45,
        "modelCoordinates",
        List.of(129.16, 35.16),
        "units",
        Json.obj("usAqi", "USAQI"),
        "coverageStart",
        first.toString(),
        "coverageEnd",
        first.plusSeconds(24 * 3600).toString(),
        "hourly",
        hours,
        "limitations",
        List.of());
  }

  private static ObjectNode area(JsonNode forecast) {
    return Json.obj(
        "hotelId",
        "test",
        "coordinates",
        hotel().path("coordinates"),
        "airQuality",
        Json.obj("status", "available", "usAqi", 20, "forecast", forecast),
        "safety",
        Json.obj("status", "unknown", "evidence", List.of()));
  }

  private static String status(JsonNode value) {
    return Json.str(value, "status");
  }

  @Test
  void currentAirCannotStandInForTripAndKoreanMidnightCoverageIsExact() {
    assertEquals("unknown", status(Environment.air(area(Json.obj()), trip(), NOW)));
    JsonNode match = Environment.air(area(forecast(50)), trip(), NOW);
    assertEquals("match", status(match));
    assertEquals(50, match.path("value").asDouble());
    assertTrue(match.path("details").toString().contains("24 из 24"));
    assertEquals("mismatch", status(Environment.air(area(forecast(51)), trip(), NOW)));
    assertEquals(
        "unknown",
        status(Environment.air(area(forecast(20)), trip().put("checkOut", "2026-10-27"), NOW)));
  }

  @Test
  void currentAirFallbackIsAnExplicitEstimateWithStrictTwentyFourHourFreshness() {
    ObjectNode area = area(Json.obj());
    ObjectNode current = (ObjectNode) area.path("airQuality");
    current
        .put("time", NOW.toString())
        .put("fetchedAt", NOW.toString())
        .put("concentrationUnit", "µg/m³")
        .put("sourceUrl", "https://open-meteo.com/en/docs/air-quality-api");
    current.set("modelCoordinates", hotel().path("coordinates"));
    JsonNode raw = Environment.airForDecision(area, trip(), NOW);
    assertEquals("unknown", status(raw));
    assertEquals(20, raw.path("currentAirUsAqi").asInt());
    JsonNode decision = BinaryDecisionPolicy.decide(raw, hotel());
    assertEquals("match", status(decision));
    assertTrue(decision.path("assumed").asBoolean());
    assertTrue(Json.str(decision, "explanation").contains("не прогноз"));
    assertTrue(Json.str(decision, "explanation").contains(NOW.toString()));
    for (JsonNode wrongGrid :
        List.of(
            Json.array(List.of(39.7, 43.5)), Json.array(List.of(129.16)), Json.MAPPER.nullNode())) {
      ObjectNode changed = area.deepCopy();
      ((ObjectNode) changed.path("airQuality")).set("modelCoordinates", wrongGrid);
      assertFalse(Environment.airForDecision(changed, trip(), NOW).has("currentAirUsAqi"));
      assertEquals(
          "mismatch",
          status(
              BinaryDecisionPolicy.decide(
                  Environment.airForDecision(changed, trip(), NOW), hotel())));
    }
    ObjectNode wrongUnit = area.deepCopy();
    ((ObjectNode) wrongUnit.path("airQuality")).put("concentrationUnit", "mg/m³");
    assertFalse(Environment.airForDecision(wrongUnit, trip(), NOW).has("currentAirUsAqi"));
    for (String field : List.of("time", "fetchedAt")) {
      for (String bad :
          List.of("invalid", NOW.plusSeconds(1).toString(), NOW.minusSeconds(86401).toString())) {
        ObjectNode changed = area.deepCopy();
        ((ObjectNode) changed.path("airQuality")).put(field, bad);
        assertFalse(Environment.airForDecision(changed, trip(), NOW).has("currentAirUsAqi"));
      }
    }
    current.put("time", NOW.minusSeconds(86400).toString()).put("usAqi", 51);
    assertEquals(
        "mismatch",
        status(
            BinaryDecisionPolicy.decide(Environment.airForDecision(area, trip(), NOW), hotel())));
    current.put("sourceUrl", "file:///invalid");
    assertFalse(Environment.airForDecision(area, trip(), NOW).has("currentAirUsAqi"));
    assertFalse(
        Environment.airForDecision(area(forecast(100)), trip(), NOW).has("currentAirUsAqi"));
  }

  @Test
  void savedCurrentAirSnapshotSatisfiesTheRuntimeGridAndUnitContract() throws Exception {
    Path source = Path.of("../data/area-assessments.json");
    if (!Files.isRegularFile(source)) source = Path.of("data/area-assessments.json");
    JsonNode snapshot = Json.read(Files.readString(source)).path("assessments").get(0);
    JsonNode current = snapshot.path("airQuality");
    Instant checkedAt = Instant.parse(Json.str(current, "fetchedAt")).plusSeconds(60);
    if (Instant.parse(Json.str(current, "time")).isAfter(checkedAt))
      checkedAt = Instant.parse(Json.str(current, "time")).plusSeconds(60);
    JsonNode raw =
        Environment.airForDecision(
            snapshot, trip().put("checkIn", "2030-01-01").put("checkOut", "2030-01-02"), checkedAt);
    assertEquals("unknown", status(raw));
    assertEquals(current.path("usAqi").asDouble(), raw.path("currentAirUsAqi").asDouble(-1));
  }

  @Test
  void gapsNullsAndDuplicateHoursCannotBeHiddenByDeclaredCoverageOrABadHour() {
    ObjectNode gap = forecast(100);
    ((com.fasterxml.jackson.databind.node.ArrayNode) gap.path("hourly")).remove(1);
    assertEquals("unknown", status(Environment.air(area(gap), trip(), NOW)));
    ObjectNode missing = forecast(20);
    ((ObjectNode) missing.path("hourly").get(5)).putNull("usAqi");
    assertEquals("unknown", status(Environment.air(area(missing), trip(), NOW)));
    ObjectNode duplicate = forecast(20);
    ((ObjectNode) duplicate.path("hourly").get(5))
        .put("time", Json.str(duplicate.path("hourly").get(4), "time"));
    assertEquals("unknown", status(Environment.air(area(duplicate), trip(), NOW)));
    ObjectNode partial = forecast(20).put("status", "partial");
    ((ObjectNode) partial.path("hourly").get(5)).putNull("pm25");
    assertEquals("match", status(Environment.air(area(partial), trip(), NOW)));
  }

  @Test
  void staleFutureWrongUnitOrWrongGridForecastDoesNotMatch() {
    for (String fetched :
        List.of(NOW.minusSeconds(7 * 3600).toString(), NOW.plusSeconds(60).toString(), "invalid"))
      assertEquals(
          "unknown",
          status(Environment.air(area(forecast(20).put("fetchedAt", fetched)), trip(), NOW)));
    ObjectNode units = forecast(20);
    ((ObjectNode) units.path("units")).put("usAqi", "European AQI");
    assertEquals("unknown", status(Environment.air(area(units), trip(), NOW)));
    ObjectNode grid = forecast(20);
    grid.set("modelCoordinates", Json.array(List.of(39.7, 43.5)));
    assertEquals("unknown", status(Environment.air(area(grid), trip(), NOW)));
  }

  private static ObjectNode polygon() {
    return Json.obj(
        "type",
        "Polygon",
        "name",
        "District",
        "code",
        "district-a",
        "sourceUrl",
        "https://www.openstreetmap.org/relation/1",
        "coordinates",
        List.of(
            List.of(
                List.of(129.15, 35.15),
                List.of(129.17, 35.15),
                List.of(129.17, 35.17),
                List.of(129.15, 35.17),
                List.of(129.15, 35.15))));
  }

  private static ObjectNode rate() {
    ObjectNode period = Json.obj("from", "2025-01-01", "to", "2025-12-31"),
        definition =
            Json.obj(
                "categoryCode",
                "all_registered",
                "denominatorBasis",
                "annual_average_resident_population",
                "methodologyId",
                "official-v1");
    ObjectNode comparator =
        Json.obj(
            "metric",
            "crime_rate_per_100000",
            "categoryCode",
            "all_registered",
            "period",
            period,
            "unit",
            "incidents_per_100000_residents",
            "denominatorBasis",
            "annual_average_resident_population",
            "methodologyId",
            "official-v1",
            "value",
            120,
            "baselineRegion",
            Json.obj("name", "Busan", "code", "busan"),
            "sourcePublisher",
            "Official authority",
            "sourceUrl",
            "https://www.busan.go.kr/official",
            "sourceRecord",
            "row regional",
            "publishedAt",
            "2026-03-01",
            "retrievedAt",
            NOW.toString(),
            "verification",
            "operator-checked-official-source");
    return Json.obj(
        "id",
        "rate",
        "metric",
        "crime_rate_per_100000",
        "metricLabel",
        "Зарегистрированные происшествия",
        "period",
        period,
        "unit",
        "incidents_per_100000_residents",
        "value",
        100,
        "rateDefinition",
        definition,
        "comparator",
        comparator,
        "geography",
        polygon(),
        "sourcePublisher",
        "Official authority",
        "sourceUrl",
        "https://www.busan.go.kr/official",
        "sourceRecord",
        "row district",
        "publishedAt",
        "2026-03-01",
        "retrievedAt",
        NOW.toString(),
        "verification",
        "operator-checked-official-source");
  }

  private static ObjectNode safetyArea(JsonNode evidence) {
    ObjectNode area = area(Json.obj());
    area.set("safety", Json.obj("status", "evidence", "evidence", List.of(evidence)));
    return area;
  }

  @Test
  void crimeCountsNeverBecomeSafetyAndComparableRatesKeepHistoricalScope() {
    assertEquals(
        "unknown",
        status(
            Environment.safety(
                safetyArea(rate().put("metric", "reported_incidents")), hotel(), trip(), NOW)));
    assertEquals("match", status(Environment.safety(safetyArea(rate()), hotel(), trip(), NOW)));
    assertEquals(
        "mismatch",
        status(Environment.safety(safetyArea(rate().put("value", 121)), hotel(), trip(), NOW)));
    assertEquals(
        "unknown",
        status(
            Environment.safety(
                safetyArea(rate()),
                hotel(),
                trip().put("checkIn", "2029-01-01").put("checkOut", "2029-01-02"),
                NOW)));
  }

  @Test
  void incomparableFutureSelfBaselineAndWrongGeographyRatesRemainUnknown() {
    ObjectNode noBoundarySource = rate();
    ((ObjectNode) noBoundarySource.path("geography")).remove("sourceUrl");
    assertEquals(
        "unknown", status(Environment.safety(safetyArea(noBoundarySource), hotel(), trip(), NOW)));
    ObjectNode openPolygon = rate();
    ((com.fasterxml.jackson.databind.node.ArrayNode)
            openPolygon.path("geography").path("coordinates").get(0))
        .remove(4);
    assertEquals(
        "unknown", status(Environment.safety(safetyArea(openPolygon), hotel(), trip(), NOW)));
    ObjectNode category = rate();
    ((ObjectNode) category.path("comparator")).put("categoryCode", "other");
    ObjectNode denominator = rate();
    ((ObjectNode) denominator.path("comparator")).put("denominatorBasis", "tourist_population");
    ObjectNode future = rate();
    ((ObjectNode) future.path("comparator")).put("retrievedAt", NOW.plusSeconds(3600).toString());
    ObjectNode self = rate();
    ((ObjectNode) self.path("comparator").path("baselineRegion")).put("code", "district-a");
    for (ObjectNode bad : List.of(category, denominator, future, self))
      assertEquals("unknown", status(Environment.safety(safetyArea(bad), hotel(), trip(), NOW)));
    ObjectNode outside = hotel();
    outside.set("coordinates", Json.array(List.of(129.2, 35.2)));
    assertEquals("unknown", status(Environment.safety(safetyArea(rate()), outside, trip(), NOW)));
    ObjectNode hole = rate();
    ((com.fasterxml.jackson.databind.node.ArrayNode) hole.path("geography").path("coordinates"))
        .add(
            Json.array(
                List.of(
                    List.of(129.159, 35.159),
                    List.of(129.161, 35.159),
                    List.of(129.161, 35.161),
                    List.of(129.159, 35.161),
                    List.of(129.159, 35.159))));
    assertEquals("unknown", status(Environment.safety(safetyArea(hole), hotel(), trip(), NOW)));
  }

  private static ObjectNode source() {
    return Json.obj(
        "url",
        "https://www.busan.go.kr/event",
        "publisher",
        "Busan",
        "retrievedAt",
        NOW.toString());
  }

  private static ObjectNode context() {
    return Json.obj(
        "schemaVersion",
        1,
        "region",
        "Пусан",
        "timeZone",
        "Asia/Seoul",
        "generatedAt",
        NOW.toString(),
        "bbox",
        List.of(129.1, 35.1, 129.2, 35.2),
        "roads",
        List.of(
            Json.obj(
                "id",
                "road",
                "name",
                "Дорога",
                "roadClass",
                "primary",
                "oneWay",
                false,
                "geometry",
                List.of(List.of(129.159, 35.1601), List.of(129.161, 35.1601)),
                "source",
                source())),
        "trafficObservations",
        List.of(),
        "events",
        List.of(),
        "coverage",
        Json.obj(
            "traffic",
            Json.obj("status", "unavailable"),
            "events",
            Json.obj("status", "partial", "verifiedAt", NOW.toString())));
  }

  private static ObjectNode event() {
    return Json.obj(
        "id",
        "event",
        "name",
        "Концерт",
        "eventType",
        "concert",
        "status",
        "scheduled",
        "startsAt",
        "2026-10-25T19:00:00+09:00",
        "endsAt",
        "2026-10-25T20:00:00+09:00",
        "timePrecision",
        "minute",
        "geometry",
        Json.obj("type", "Point", "coordinates", hotel().path("coordinates")),
        "influenceRadiusMeters",
        1500,
        "noisePotential",
        "high",
        "source",
        source(),
        "geometrySource",
        source());
  }

  @Test
  void baselineProximityDoesNotInventTrafficAndEventsMustOverlapDatesAndSpace() {
    ObjectNode missingGeometry = context(), missingEvent = event();
    missingEvent.remove("geometrySource");
    missingGeometry.set("events", Json.array(List.of(missingEvent)));
    assertEquals("unknown", status(Environment.noise(missingGeometry, hotel(), trip(), NOW)));
    assertEquals("unknown", status(Environment.noise(context(), hotel(), trip(), NOW)));
    ObjectNode scheduled = context();
    scheduled.set("events", Json.array(List.of(event())));
    assertEquals("mismatch", status(Environment.noise(scheduled, hotel(), trip(), NOW)));
    assertTrue(
        Environment.noise(scheduled, hotel(), trip(), NOW)
            .path("explanation")
            .asText()
            .contains("высокий"));
    assertEquals(
        "unknown",
        status(
            Environment.noise(
                scheduled,
                hotel(),
                trip().put("checkIn", "2026-10-26").put("checkOut", "2026-10-27"),
                NOW)));
    for (String status : List.of("cancelled", "tentative")) {
      ObjectNode data = context();
      data.set("events", Json.array(List.of(event().put("status", status))));
      assertEquals("unknown", status(Environment.noise(data, hotel(), trip(), NOW)));
    }
    ObjectNode outside = hotel();
    outside.set("coordinates", Json.array(List.of(130, 36)));
    assertEquals("unknown", status(Environment.noise(scheduled, outside, trip(), NOW)));
  }

  private static ObjectNode historicalProfile(double peak) {
    var counts = Json.MAPPER.createArrayNode();
    for (int i = 0; i < 24; i++)
      if (i == 8) counts.add(peak);
      else counts.addNull();
    return Json.obj(
        "id",
        "ktdb-2024-link",
        "sourceLinkId",
        "link",
        "referenceYear",
        2024,
        "dayType",
        "weekday",
        "geometry",
        Json.obj(
            "type",
            "LineString",
            "coordinates",
            List.of(List.of(129.159, 35.1601), List.of(129.161, 35.1601))),
        "hourlyVehicleCounts",
        counts,
        "availableHours",
        24,
        "reportedTotal",
        999999,
        "lanes",
        null,
        "direction",
        "source_link_unspecified",
        "source",
        source(),
        "limitations",
        List.of("Полосы неизвестны"));
  }

  private static ObjectNode history(JsonNode profile) {
    return Json.obj(
        "schemaVersion",
        1,
        "region",
        "Пусан",
        "referenceYear",
        2024,
        "dayType",
        "weekday",
        "kind",
        "historical_observed_profile",
        "timeZone",
        "Asia/Seoul",
        "source",
        source(),
        "historicalTrafficProfiles",
        List.of(profile));
  }

  private static ObjectNode weekdayTrip() {
    return trip().put("checkIn", "2026-10-26").put("checkOut", "2026-10-27");
  }

  @Test
  void historicalCountsAreUnknownHintsWithMeasuredHourlyCoverageAndDistance() {
    for (double peak : new double[] {0, 500, 501, 1500, 1501}) {
      JsonNode result =
          Environment.noise(
              context(), history(historicalProfile(peak)), hotel(), weekdayTrip(), NOW);
      assertEquals("unknown", status(result));
      assertEquals("historical", Json.str(result, "assessmentBasis"));
      assertEquals(
          peak > 1500 ? "high" : peak > 500 ? "moderate" : "low", Json.str(result, "riskLevel"));
      assertTrue(result.path("details").toString().contains("1 из 24"));
      assertTrue(result.path("explanation").asText().contains("2024"));
      assertTrue(result.path("explanation").asText().contains("прогноз"));
    }
    for (double latitude : new double[] {35.161, 35.162, 35.17}) {
      ObjectNode location = hotel();
      location.set("coordinates", Json.array(List.of(129.16, latitude)));
      JsonNode result =
          Environment.noise(
              context(), history(historicalProfile(2000)), location, weekdayTrip(), NOW);
      assertEquals(
          latitude < 35.162 ? "moderate" : latitude < 35.17 ? "low" : "unknown",
          Json.str(result, "riskLevel"));
    }
    ObjectNode datedEvent = context();
    datedEvent.set(
        "events",
        Json.array(
            List.of(
                event()
                    .put("startsAt", "2026-10-26T19:00:00+09:00")
                    .put("endsAt", "2026-10-26T20:00:00+09:00"))));
    JsonNode known =
        Environment.noise(datedEvent, history(historicalProfile(1)), hotel(), weekdayTrip(), NOW);
    assertEquals("mismatch", status(known));
    assertEquals("high", Json.str(known, "riskLevel"));
    assertFalse(known.has("assessmentBasis"));
  }

  @Test
  void historicalCountsRejectWrongPeriodDayTypeMissingAndNegativeValues() {
    for (ObjectNode invalid :
        List.of(
            historicalProfile(-1000),
            historicalProfile(10).put("referenceYear", 2023),
            historicalProfile(10).put("dayType", "weekend")))
      assertFalse(
          Environment.noise(context(), history(invalid), hotel(), weekdayTrip(), NOW)
              .has("assessmentBasis"));
    ObjectNode empty = historicalProfile(10);
    ((com.fasterxml.jackson.databind.node.ArrayNode) empty.path("hourlyVehicleCounts"))
        .set(8, Json.MAPPER.nullNode());
    assertFalse(
        Environment.noise(context(), history(empty), hotel(), weekdayTrip(), NOW)
            .has("assessmentBasis"));
    ObjectNode futureSource = historicalProfile(10);
    ((ObjectNode) futureSource.path("source")).put("retrievedAt", NOW.plusSeconds(1).toString());
    assertFalse(
        Environment.noise(context(), history(futureSource), hotel(), weekdayTrip(), NOW)
            .has("assessmentBasis"));
    for (ObjectNode dates :
        List.of(
            trip(),
            trip().put("checkIn", "2028-10-23").put("checkOut", "2028-10-24"),
            trip().put("checkIn", "2023-10-23").put("checkOut", "2023-10-24")))
      assertFalse(
          Environment.noise(context(), history(historicalProfile(2000)), hotel(), dates, NOW)
              .has("assessmentBasis"));
    ObjectNode future = historicalProfile(2000).put("referenceYear", 2027);
    ObjectNode futureData = history(future).put("referenceYear", 2027);
    assertFalse(
        Environment.noise(
                context(),
                futureData,
                hotel(),
                trip().put("checkIn", "2027-10-25").put("checkOut", "2027-10-26"),
                NOW)
            .has("assessmentBasis"));
    assertTrue(
        Environment.noise(
                context(),
                history(historicalProfile(2000)),
                hotel(),
                trip().put("checkOut", "2026-10-27"),
                NOW)
            .has("assessmentBasis"));
  }

  @Test
  void historicalRiskRanksOptionalNoiseWithoutExcludingMandatoryUnknown() {
    ObjectNode highHotel = hotel().put("id", "high"), moderateHotel = hotel().put("id", "moderate");
    JsonNode
        high =
            Environment.noise(
                context(), history(historicalProfile(2000)), highHotel, weekdayTrip(), NOW),
        moderate =
            Environment.noise(
                context(), history(historicalProfile(1000)), moderateHotel, weekdayTrip(), NOW);
    Map<String, Map<String, JsonNode>> environment =
        Map.of("high", Map.of("low_noise", high), "moderate", Map.of("low_noise", moderate));
    List<JsonNode> ranked =
        Matching.rank(
            List.of(highHotel, moderateHotel),
            List.of(),
            List.of(pref("low_noise").put("required", false)),
            weekdayTrip(),
            NOW,
            environment);
    assertEquals("moderate", Json.str(ranked.getFirst().path("hotel"), "id"));
    assertEquals(-2, ranked.getFirst().path("best").path("score").asInt());
    assertEquals(-3, ranked.getLast().path("best").path("score").asInt());
    for (JsonNode match :
        Matching.rank(
            List.of(highHotel, moderateHotel),
            List.of(),
            List.of(pref("low_noise")),
            weekdayTrip(),
            NOW,
            environment)) {
      assertEquals("excluded", Json.str(match.path("best"), "status"));
      assertTrue(match.path("best").path("score").asInt() <= -2);
    }
  }

  @Test
  void lowNoiseRequiresCompleteTrafficAndEventsAndHistoricalCountsDoNotForecast() {
    ObjectNode pastTrip = trip().put("checkIn", "2026-10-23").put("checkOut", "2026-10-24");
    ObjectNode observation =
        Json.obj(
            "id",
            "count",
            "roadId",
            "road",
            "startsAt",
            "2026-10-23T00:00:00+09:00",
            "endsAt",
            "2026-10-24T00:00:00+09:00",
            "vehicleCount",
            4800,
            "lanes",
            2,
            "direction",
            "both_directions",
            "source",
            source());
    ObjectNode covered = context();
    covered.set("trafficObservations", Json.array(List.of(observation)));
    ((ObjectNode) covered.path("coverage"))
        .set(
            "events",
            Json.obj(
                "status",
                "complete",
                "verifiedAt",
                NOW.toString(),
                "startsAt",
                "2026-10-23T00:00:00+09:00",
                "endsAt",
                "2026-10-24T00:00:00+09:00",
                "geometry",
                polygon(),
                "verificationSource",
                source()));
    assertEquals(
        "unknown",
        status(Environment.noise(covered, hotel(), pastTrip, NOW)),
        "Counts alone do not establish full road inventory coverage");
    ((ObjectNode) covered.path("coverage"))
        .set("traffic", covered.path("coverage").path("events").deepCopy());
    assertEquals("match", status(Environment.noise(covered, hotel(), pastTrip, NOW)));
    ObjectNode futureRoad = covered.deepCopy();
    ((ObjectNode) futureRoad.path("roads").get(0).path("source"))
        .put("retrievedAt", NOW.plusSeconds(3600).toString());
    assertEquals("unknown", status(Environment.noise(futureRoad, hotel(), pastTrip, NOW)));
    ObjectNode smallInventory = covered.deepCopy();
    ((ObjectNode) smallInventory.path("coverage").path("traffic").path("geometry"))
        .set(
            "coordinates",
            Json.array(
                List.of(
                    List.of(
                        List.of(129.159, 35.159),
                        List.of(129.161, 35.159),
                        List.of(129.161, 35.161),
                        List.of(129.159, 35.161),
                        List.of(129.159, 35.159)))));
    assertEquals("unknown", status(Environment.noise(smallInventory, hotel(), pastTrip, NOW)));
    ObjectNode staleCoverage = covered.deepCopy();
    ((ObjectNode) staleCoverage.path("coverage").path("traffic"))
        .put("verifiedAt", NOW.minusSeconds(7 * 3600).toString());
    assertEquals("unknown", status(Environment.noise(staleCoverage, hotel(), pastTrip, NOW)));
    assertEquals("unknown", status(Environment.noise(covered, hotel(), trip(), NOW)));
    ObjectNode oneDirection = covered.deepCopy();
    ((ObjectNode) oneDirection.path("trafficObservations").get(0))
        .put("direction", "one_direction");
    assertEquals("unknown", status(Environment.noise(oneDirection, hotel(), pastTrip, NOW)));
    ObjectNode speed = covered.deepCopy();
    ((ObjectNode) speed.path("trafficObservations").get(0)).remove("vehicleCount");
    ((ObjectNode) speed.path("trafficObservations").get(0)).put("speedKph", 15);
    assertEquals("unknown", status(Environment.noise(speed, hotel(), pastTrip, NOW)));
    ((ObjectNode) covered.path("trafficObservations").get(0)).put("vehicleCount", 48000);
    assertEquals("mismatch", status(Environment.noise(covered, hotel(), pastTrip, NOW)));
  }

  @Test
  void environmentalCriteriaDriveMandatoryRankingAndCannotBeSavedAsHostFacts() {
    for (String text : List.of("Хочу тихий отель", "Ребёнок спит днём"))
      assertTrue(
          Json.list(Agents.parseRules(text, List.of()).path("preferences")).stream()
              .anyMatch(p -> Json.str(p, "feature").equals("low_noise")),
          text);
    Map<String, Map<String, JsonNode>> bad =
        Map.of("test", Map.of("clean_air", Environment.air(area(forecast(80)), trip(), NOW)));
    assertEquals(
        "excluded",
        Matching.rank(List.of(hotel()), List.of(), List.of(pref("clean_air")), trip(), NOW, bad)
            .getFirst()
            .path("best")
            .path("status")
            .asText());
    assertEquals(
        "excluded",
        Matching.rank(List.of(hotel()), List.of(), List.of(pref("clean_air")), trip(), NOW)
            .getFirst()
            .path("best")
            .path("status")
            .asText());
    assertTrue(
        Agents.extractRules("Да, чистый воздух.", "clean_air").path("extractions").isEmpty());
    ObjectNode all = trip();
    all.set("preferences", Json.array(Features.ids().stream().map(EnvironmentTest::pref).toList()));
    assertDoesNotThrow(() -> Validation.trip(all, "Пусан"));
    assertTrue(
        Agents.parseRules("Обязательно чистый воздух", List.of())
            .path("preferences")
            .path(0)
            .path("required")
            .asBoolean());
  }

  @Test
  void highNoiseRanksBelowModerateNoiseEvenWithAShorterBeachWalk() {
    ObjectNode highHotel = hotel().put("id", "high"), moderateHotel = hotel().put("id", "moderate");
    highHotel.set("route", Json.obj("meters", 100));
    moderateHotel.set("route", Json.obj("meters", 800));
    ObjectNode highContext = context(), moderateContext = context();
    highContext.set("events", Json.array(List.of(event())));
    moderateContext.set("events", Json.array(List.of(event().put("noisePotential", "moderate"))));
    JsonNode high = Environment.noise(highContext, highHotel, trip(), NOW),
        moderate = Environment.noise(moderateContext, moderateHotel, trip(), NOW);
    assertEquals("high", Json.str(high, "riskLevel"));
    assertEquals("moderate", Json.str(moderate, "riskLevel"));
    Map<String, Map<String, JsonNode>> environments =
        Map.of("high", Map.of("low_noise", high), "moderate", Map.of("low_noise", moderate));
    List<JsonNode> ranked =
        Matching.rank(
            List.of(highHotel, moderateHotel),
            List.of(),
            List.of(pref("low_noise").put("required", false)),
            trip(),
            NOW,
            environments);
    assertEquals("moderate", Json.str(ranked.getFirst().path("hotel"), "id"));
    assertEquals(-2, ranked.getFirst().path("best").path("score").asInt());
    assertEquals(-3, ranked.getLast().path("best").path("score").asInt());
    for (JsonNode result :
        Matching.rank(
            List.of(highHotel, moderateHotel),
            List.of(),
            List.of(pref("low_noise")),
            trip(),
            NOW,
            environments)) assertEquals("excluded", Json.str(result.path("best"), "status"));
  }

  @Test
  void detailEndpointUsesInterpretedPreferencesAndAllEightCriteriaWithoutHostQuestions()
      throws Exception {
    ObjectNode seed =
        Json.obj(
            "region", "Пусан", "hotels", List.of(hotel()), "facts", List.of(), "map", List.of());
    Path areaFile = temporary.resolve("areas.json");
    Files.writeString(
        areaFile,
        Json.write(Json.obj("region", "Пусан", "assessments", List.of(area(forecast(20))))));
    try (Store store = new Store(":memory:", seed);
        Api api =
            new Api(store, new Agents(Agents.Config.from(Map.of())), temporary, areaFile, "", 0)) {
      api.start();
      String base = "http://127.0.0.1:" + api.port();
      ObjectNode query = trip().put("text", "Обязательно чистый воздух");
      JsonNode result = post(base, "/api/hotels/test/evaluate", query);
      assertEquals(8, result.path("best").path("criteria").size());
      assertTrue(List.of("fits", "excluded").contains(Json.str(result.path("best"), "status")));
      for (JsonNode criterion : result.path("best").path("criteria")) {
        assertTrue(List.of("match", "mismatch").contains(Json.str(criterion, "status")));
        assertTrue(criterion.has("evidenceStatus"));
        assertTrue(criterion.has("decisionBasis"));
      }
      JsonNode air =
          Json.list(result.path("best").path("criteria")).stream()
              .filter(c -> Json.str(c, "feature").equals("clean_air"))
              .findFirst()
              .orElseThrow();
      assertTrue(air.path("required").asBoolean());
      assertTrue(air.path("facts").isEmpty());
      JsonNode answer =
          post(
              base,
              "/api/questions",
              Json.obj(
                  "hotelId", "test", "roomId", "room", "feature", "clean_air", "trip", trip()));
      assertTrue(answer.path("question").isNull());
      assertTrue(store.questions().isEmpty());
    }
  }

  private static JsonNode post(String base, String path, JsonNode body) throws Exception {
    HttpResponse<String> response =
        HttpClient.newHttpClient()
            .send(
                HttpRequest.newBuilder(URI.create(base + path))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(Json.write(body)))
                    .build(),
                HttpResponse.BodyHandlers.ofString());
    assertEquals(200, response.statusCode(), response.body());
    return Json.read(response.body());
  }
}
