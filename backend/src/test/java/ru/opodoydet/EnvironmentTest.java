package ru.opodoydet;

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
        List.of(Json.obj("id", "room", "capacity", 2, "name", "Номер", "demo", true)),
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
        "clarify",
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
