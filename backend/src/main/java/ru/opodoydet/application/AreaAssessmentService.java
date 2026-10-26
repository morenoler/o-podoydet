package ru.opodoydet.application;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import ru.opodoydet.config.AppSettings;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/** Reads the saved area assessment without extending its source freshness window. */
@Service
public final class AreaAssessmentService {
  private final Store store;
  private final Path areaData;

  public AreaAssessmentService(Store store, AppSettings settings) {
    this.store = store;
    this.areaData = settings.path("AREA_DATA_PATH", "data/area-assessments.json");
  }

  public JsonNode assessment(JsonNode hotel, Instant now) throws IOException {
    if (!Files.isRegularFile(areaData)) return null;
    JsonNode file = Json.MAPPER.readTree(areaData.toFile());
    if (file.hasNonNull("region") && !Json.str(file, "region").equals(store.region)) return null;
    for (JsonNode item : file.path("assessments"))
      if (Json.str(item, "hotelId").equals(Json.str(hotel, "id"))) {
        JsonNode coordinates = item.path("coordinates"), expected = hotel.path("coordinates");
        if (!coordinates.isArray()
            || coordinates.size() != 2
            || !expected.isArray()
            || expected.size() != 2) return null;
        for (int i = 0; i < 2; i++)
          if (!coordinates.path(i).isNumber()
              || Math.abs(coordinates.path(i).asDouble() - expected.path(i).asDouble()) > 0.0001)
            return null;
        ObjectNode assessment = (ObjectNode) item.deepCopy();
        JsonNode air = assessment.path("airQuality");
        if (air.isObject() && !Json.str(air, "status").equals("unknown")) {
          Instant assessed = parseTime(Json.str(item, "assessedAt")),
              source = parseTime(Json.str(air, "time")),
              fetched = parseTime(Json.str(air, "fetchedAt"));
          if (!fresh(assessed, now) || !fresh(source, now) || !fresh(fetched, now)) {
            ((ObjectNode) air).put("status", "stale");
            List<String> limitations =
                new ArrayList<>(
                    Json.list(air.path("limitations")).stream().map(JsonNode::asText).toList());
            limitations.add(
                "Данные о воздухе старше 6 часов или время источника/загрузки не подтверждено."
                    + " Обновите оценку перед поездкой.");
            ((ObjectNode) air).set("limitations", Json.array(limitations));
          }
        }
        return assessment;
      }
    return null;
  }

  private static boolean fresh(Instant time, Instant now) {
    return time != null && !time.isAfter(now) && !time.isBefore(now.minus(6, ChronoUnit.HOURS));
  }

  private static Instant parseTime(String value) {
    try {
      return Instant.parse(value);
    } catch (DateTimeParseException ignored) {
      try {
        return LocalDateTime.parse(value).toInstant(ZoneOffset.UTC);
      } catch (DateTimeParseException invalid) {
        return null;
      }
    }
  }
}
