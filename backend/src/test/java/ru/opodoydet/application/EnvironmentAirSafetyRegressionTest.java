package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import ru.opodoydet.shared.Json;

/** Synthetic contract cases plus the separately stored real Busan source snapshot. */
class EnvironmentAirSafetyRegressionTest {
  private static final Instant NOW = Instant.parse("2026-10-24T15:01:00Z");

  private static ObjectNode trip() {
    return Json.obj("checkIn", "2026-10-25", "checkOut", "2026-10-26");
  }

  private static ObjectNode area() {
    List<JsonNode> hours = new ArrayList<>();
    Instant first = Instant.parse("2026-10-24T15:00:00Z");
    for (int i = 0; i < 24; i++)
      hours.add(Json.obj("time", first.plusSeconds(i * 3600L).toString(), "usAqi", 20));
    return Json.obj(
        "hotelId", "synthetic-contract-test", "coordinates", List.of(129.16, 35.16),
        "airQuality", Json.obj("forecast", Json.obj(
            "status", "available", "fetchedAt", NOW.toString(),
            "sourceUrl", "https://open-meteo.com/en/docs/air-quality-api",
            "timezone", "UTC", "tripTimezone", "Asia/Seoul", "intervalSeconds", 3600,
            "model", "CAMS Global", "resolutionKm", 45,
            "modelCoordinates", List.of(129.16, 35.16),
            "units", Json.obj("usAqi", "USAQI"), "hourly", hours)));
  }

  private static String status(JsonNode criterion) {
    return Json.str(criterion, "status");
  }

  private static ObjectNode rate() {
    // Deliberately synthetic numbers; never written into the real evidence dataset.
    ObjectNode period = Json.obj("from", "2025-01-01", "to", "2025-12-31");
    ObjectNode shared = Json.obj(
        "metric", "crime_rate_per_100000", "period", period,
        "unit", "incidents_per_100000_residents", "categoryCode", "test-theft",
        "denominatorBasis", "annual_average_resident_population", "methodologyId", "test-v1",
        "sourcePublisher", "Synthetic test fixture", "sourceRecord", "Synthetic test row",
        "sourceUrl", "https://www.busan.go.kr/test-fixture", "publishedAt", "2026-10-25",
        "retrievedAt", "2026-10-24T15:00:00Z", "verification", "operator-checked-official-source");
    ObjectNode record = shared.deepCopy();
    record.put("value", 100);
    record.set("rateDefinition", Json.obj("categoryCode", "test-theft",
        "denominatorBasis", "annual_average_resident_population", "methodologyId", "test-v1"));
    record.set("comparator", shared.deepCopy().put("value", 120)
        .set("baselineRegion", Json.obj("name", "Test region", "code", "TEST-REGION")));
    record.set("geography", Json.obj("type", "Polygon", "name", "Test district", "code", "TEST-DISTRICT",
        "sourceUrl", "https://www.openstreetmap.org/relation/1",
        "coordinates", List.of(List.of(List.of(129.15, 35.15), List.of(129.17, 35.15),
            List.of(129.17, 35.17), List.of(129.15, 35.17), List.of(129.15, 35.15)))));
    return record;
  }

  private static ObjectNode safetyArea(JsonNode rate) {
    ObjectNode area = area();
    area.set("safety", Json.obj("status", "evidence", "evidence", List.of(rate)));
    return area;
  }

  @Test
  void forecastRejectsFractionalOrStringTimeStepAndWrongModelIdentity() {
    assertEquals("match", status(Environment.air(area(), trip(), NOW)));
    for (Object invalid : List.of(3600.5, "3600", 0)) {
      ObjectNode a = area();
      ((ObjectNode) a.at("/airQuality/forecast")).set("intervalSeconds", Json.MAPPER.valueToTree(invalid));
      assertEquals("unknown", status(Environment.air(a, trip(), NOW)));
    }
    ObjectNode a = area();
    ((ObjectNode) a.at("/airQuality/forecast")).put("model", "CAMS Europe");
    assertEquals("unknown", status(Environment.air(a, trip(), NOW)));
    ((ObjectNode) a.at("/airQuality/forecast")).put("model", "CAMS Global").put("resolutionKm", 11);
    assertEquals("unknown", status(Environment.air(a, trip(), NOW)));
  }

  @Test
  void koreanPublicationAtMidnightIsApplicableButFutureRetrievalIsNot() {
    ObjectNode a = safetyArea(rate());
    assertEquals("match", status(Environment.safety(a, a, trip(), NOW)));
    assertEquals("unknown", status(Environment.safety(a, a, trip(), Instant.parse("2026-10-24T14:59:00Z"))));
    ((ObjectNode) a.at("/safety/evidence/0")).put("retrievedAt", "2026-10-24T14:59:00Z");
    assertEquals("unknown", status(Environment.safety(a, a, trip(), NOW)));
  }

  @Test
  void crimeReportingPeriodMustEndBeforeArrivalNotDuringArrivalDay() {
    ObjectNode record = rate();
    ((ObjectNode) record.path("period")).put("to", "2026-10-25");
    ((ObjectNode) record.at("/comparator/period")).put("to", "2026-10-25");
    ObjectNode a = safetyArea(record);
    assertEquals("unknown", status(Environment.safety(a, a, trip(), NOW)));
  }

  @Test
  void realBusanCountsStayUnknownAndEveryForecastExpiresOnRead() throws Exception {
    Path path = Path.of("data/area-assessments.json");
    if (!Files.exists(path)) path = Path.of("../data/area-assessments.json");
    JsonNode records = Json.MAPPER.readTree(Files.readString(path)).path("assessments");
    assertEquals(96, records.size());
    for (JsonNode a : records) {
      Instant fetched = Instant.parse(Json.str(a.at("/airQuality/forecast"), "fetchedAt"));
      LocalDate tomorrow = fetched.atZone(ZoneId.of("Asia/Seoul")).toLocalDate().plusDays(1);
      ObjectNode within = Json.obj("checkIn", tomorrow.toString(), "checkOut", tomorrow.plusDays(1).toString());
      String applicable = status(Environment.air(a, within, fetched.plusSeconds(60)));
      assertTrue(List.of("match", "mismatch").contains(applicable), Json.str(a, "hotelId"));
      ObjectNode beyond = Json.obj("checkIn", tomorrow.toString(), "checkOut", tomorrow.plusDays(8).toString());
      assertEquals("unknown", status(Environment.air(a, beyond, fetched.plusSeconds(60))), Json.str(a, "hotelId"));
      assertEquals("unknown", status(Environment.safety(a, a, trip(), fetched.plusSeconds(60))), Json.str(a, "hotelId"));
      assertEquals("unknown", status(Environment.air(a, within, fetched.plusSeconds(7 * 3600))), Json.str(a, "hotelId"));
    }
  }
}
