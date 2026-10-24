package ru.opodoydet;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Derived criteria are evaluated on the trip, never imported as permanent hotel facts. */
final class Environment {
  private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
  private final Path areaPath;
  private final Path noisePath;
  private final Path trafficPath;

  Environment(Path areaPath, Path noisePath) {
    this(areaPath, noisePath, noisePath.resolveSibling("traffic-ktdb-2024.json"));
  }

  Environment(Path areaPath, Path noisePath, Path trafficPath) {
    this.areaPath = areaPath;
    this.noisePath = noisePath;
    this.trafficPath = trafficPath;
  }

  Map<String, Map<String, JsonNode>> evaluate(List<JsonNode> hotels, JsonNode trip, Instant now) {
    JsonNode areas = read(areaPath), noise = read(noisePath), traffic = read(trafficPath);
    Map<String, Map<String, JsonNode>> result = new HashMap<>();
    for (JsonNode hotel : hotels) {
      JsonNode area = findArea(areas, hotel, Json.str(trip, "region"));
      result.put(
          Json.str(hotel, "id"),
          Map.of(
              "clean_air",
              air(area, trip, now),
              "area_safety",
              safety(area, hotel, trip, now),
              "low_noise",
              noise(noise, traffic, hotel, trip, now)));
    }
    return result;
  }

  private static JsonNode read(Path path) {
    try {
      JsonNode value = Files.isRegularFile(path) ? Json.MAPPER.readTree(path.toFile()) : Json.obj();
      return value == null ? Json.obj() : value;
    } catch (Exception ignored) {
      return Json.obj();
    }
  }

  private static JsonNode findArea(JsonNode data, JsonNode hotel, String region) {
    if (data.hasNonNull("region") && !Json.str(data, "region").equals(region)) return Json.obj();
    for (JsonNode area : data.path("assessments"))
      if (Json.str(area, "hotelId").equals(Json.str(hotel, "id"))
          && samePoint(area.path("coordinates"), hotel.path("coordinates"))) return area;
    return Json.obj();
  }

  static boolean samePoint(JsonNode a, JsonNode b) {
    return point(a)
        && point(b)
        && Math.abs(a.get(0).asDouble() - b.get(0).asDouble()) <= 0.0001
        && Math.abs(a.get(1).asDouble() - b.get(1).asDouble()) <= 0.0001;
  }

  private static boolean point(JsonNode node) {
    return node.isArray()
        && node.size() == 2
        && number(node.get(0))
        && number(node.get(1))
        && Math.abs(node.get(0).asDouble()) <= 180
        && Math.abs(node.get(1).asDouble()) <= 90;
  }

  private static boolean number(JsonNode value) {
    return value != null && value.isNumber() && Double.isFinite(value.asDouble());
  }

  private static boolean nonnegative(JsonNode value) {
    return number(value) && value.asDouble() >= 0;
  }

  private static ObjectNode criterion(
      String feature,
      String status,
      String explanation,
      List<String> details,
      List<JsonNode> evidence,
      Object value) {
    return Json.obj(
        "feature",
        feature,
        "required",
        false,
        "status",
        status,
        "explanation",
        explanation,
        "facts",
        List.of(),
        "details",
        details,
        "environmentalEvidence",
        evidence,
        "value",
        value);
  }

  private static ObjectNode unknown(
      String feature, String explanation, List<String> details, List<JsonNode> evidence) {
    return criterion(feature, "unknown", explanation, details, evidence, null);
  }

  static Instant time(String value) {
    try {
      return Instant.parse(value);
    } catch (DateTimeParseException ignored) {
      try {
        return OffsetDateTime.parse(value).toInstant();
      } catch (DateTimeParseException invalid) {
        return null;
      }
    }
  }

  private static boolean fresh(Instant timestamp, Instant now) {
    return timestamp != null
        && !timestamp.isAfter(now)
        && !timestamp.isBefore(now.minus(Duration.ofHours(6)));
  }

  private static Instant start(JsonNode trip) {
    return LocalDate.parse(Json.str(trip, "checkIn")).atStartOfDay(SEOUL).toInstant();
  }

  private static Instant end(JsonNode trip) {
    return LocalDate.parse(Json.str(trip, "checkOut")).atStartOfDay(SEOUL).toInstant();
  }

  private static boolean url(String value) {
    try {
      URI uri = URI.create(value);
      return Set.of("https", "http").contains(uri.getScheme())
          && uri.getHost() != null
          && uri.getUserInfo() == null;
    } catch (Exception error) {
      return false;
    }
  }

  private static List<JsonNode> provenance(JsonNode source, String timeField, String details) {
    String sourceUrl = Json.str(source, "sourceUrl");
    if (sourceUrl.isBlank()) sourceUrl = Json.str(source, "url");
    return url(sourceUrl)
        ? List.of(
            Json.obj(
                "sourceUrl",
                sourceUrl,
                "observedAt",
                Json.str(source, timeField),
                "details",
                details))
        : List.of();
  }

  static ObjectNode air(JsonNode area, JsonNode trip, Instant now) {
    JsonNode forecast = area.path("airQuality").path("forecast");
    List<String> details =
        new ArrayList<>(
            List.of(
                "Проверяем US AQI ≤ 50 в каждом часу пребывания: от 00:00 дня заезда до 00:00 дня"
                    + " выезда по Asia/Seoul.",
                "CAMS Global — модель с разрешением около 45 км, не измерение у отеля. Прогноз"
                    + " может измениться."));
    List<JsonNode> evidence =
        provenance(forecast, "fetchedAt", "Почасовой прогноз качества воздуха CAMS Global");
    if (!Set.of("available", "partial").contains(Json.str(forecast, "status"))
        || !fresh(time(Json.str(forecast, "fetchedAt")), now))
      return unknown(
          "clean_air", "Нет свежего почасового прогноза на даты поездки", details, evidence);
    if (!Json.str(forecast, "timezone").equals("UTC")
        || !Json.str(forecast, "tripTimezone").equals("Asia/Seoul")
        || forecast.path("intervalSeconds").asInt() != 3600
        || !Json.str(forecast.path("units"), "usAqi").equals("USAQI")
        || evidence.isEmpty()
        || distance(area.path("coordinates"), forecast.path("modelCoordinates")) > 80000)
      return unknown(
          "clean_air",
          "Не подтверждены время, координаты, единицы или источник прогноза",
          details,
          evidence);
    JsonNode hours = forecast.path("hourly");
    if (!hours.isArray() || hours.isEmpty() || hours.size() > 168)
      return unknown(
          "clean_air", "Почасовой прогноз отсутствует или некорректен", details, evidence);
    Map<Instant, JsonNode> indexed = new HashMap<>();
    Instant previous = null, fetched = time(Json.str(forecast, "fetchedAt"));
    for (JsonNode hour : hours) {
      Instant instant = time(Json.str(hour, "time"));
      if (instant == null
          || instant.getNano() != 0
          || instant.getEpochSecond() % 3600 != 0
          || (previous != null && !instant.isAfter(previous))
          || instant.isBefore(fetched.minus(Duration.ofHours(24)))
          || instant.isAfter(fetched.plus(Duration.ofDays(7))))
        return unknown(
            "clean_air",
            "Часы прогноза некорректны, повторяются или выходят за проверяемый горизонт",
            details,
            evidence);
      indexed.put(instant, hour);
      previous = instant;
    }
    Instant from = start(trip), to = end(trip);
    long expected = Duration.between(from, to).toHours();
    if (expected <= 0 || expected > 168)
      return unknown("clean_air", "Прогноз не покрывает всё пребывание", details, evidence);
    double maximum = 0;
    int covered = 0;
    for (Instant hour = from; hour.isBefore(to); hour = hour.plusSeconds(3600)) {
      JsonNode row = indexed.get(hour);
      if (row != null && nonnegative(row.path("usAqi"))) {
        maximum = Math.max(maximum, row.path("usAqi").asDouble());
        covered++;
      }
    }
    details.add("Покрытие выбранных дат: " + covered + " из " + expected + " часов.");
    if (covered != expected)
      return unknown(
          "clean_air",
          "Прогноз не покрывает все часы поездки; чистый воздух не подтверждён",
          details,
          evidence);
    boolean matches = maximum <= 50;
    return criterion(
        "clean_air",
        matches ? "match" : "mismatch",
        matches
            ? "Во все часы поездки прогноз US AQI не выше 50"
            : "На даты поездки прогнозируется US AQI выше 50 (максимум " + format(maximum) + ")",
        details,
        evidence,
        maximum);
  }

  static ObjectNode safety(JsonNode area, JsonNode hotel, JsonNode trip, Instant now) {
    List<String> details =
        new ArrayList<>(
            List.of(
                "Сравниваем только зарегистрированные происшествия на 100 000 жителей за один"
                    + " период, с одинаковой категорией, знаменателем и методикой.",
                "Исторический показатель района не оценивает личный риск гостя и не гарантирует"
                    + " безопасность будущей поездки."));
    details.add(
        "Период статистики должен завершиться до заезда и не более чем за два года до него;"
            + " публикация и получение источника не могут быть в будущем.");
    List<JsonNode> sources = new ArrayList<>();
    List<JsonNode> comparable = new ArrayList<>();
    LocalDate tripDate = LocalDate.parse(Json.str(trip, "checkIn"));
    for (JsonNode entry : area.path("safety").path("evidence")) {
      sources.addAll(
          provenance(
              entry,
              "retrievedAt",
              Json.str(entry, "metricLabel")
                  + " · "
                  + Json.str(entry.path("period"), "from")
                  + " — "
                  + Json.str(entry.path("period"), "to")));
      JsonNode baseline = entry.path("comparator"), definition = entry.path("rateDefinition");
      if (!Json.str(entry, "metric").equals("crime_rate_per_100000")
          || !Json.str(baseline, "metric").equals("crime_rate_per_100000")
          || !Json.str(entry, "unit").equals("incidents_per_100000_residents")
          || !entry.path("unit").equals(baseline.path("unit"))
          || !entry.path("period").equals(baseline.path("period"))
          || !nonnegative(entry.path("value"))
          || !nonnegative(baseline.path("value"))) continue;
      if (!Json.str(definition, "denominatorBasis").equals("annual_average_resident_population")
          || Json.str(definition, "categoryCode").isBlank()
          || Json.str(definition, "methodologyId").isBlank()
          || !definition.path("categoryCode").equals(baseline.path("categoryCode"))
          || !definition.path("denominatorBasis").equals(baseline.path("denominatorBasis"))
          || !definition.path("methodologyId").equals(baseline.path("methodologyId"))) continue;
      if (!official(entry, now)
          || !official(baseline, now)
          || Json.str(baseline.path("baselineRegion"), "name").isBlank()
          || Json.str(baseline.path("baselineRegion"), "code").isBlank()
          || baseline
              .path("baselineRegion")
              .path("code")
              .equals(entry.path("geography").path("code"))
          || !boundaryProvenance(entry.path("geography"))
          || !inside(hotel.path("coordinates"), entry.path("geography"))) continue;
      try {
        LocalDate periodFrom = LocalDate.parse(Json.str(entry.path("period"), "from")),
            periodEnd = LocalDate.parse(Json.str(entry.path("period"), "to"));
        if (periodFrom.isAfter(periodEnd)
            || periodEnd.isAfter(tripDate)
            || periodEnd.isBefore(tripDate.minusYears(2))) continue;
      } catch (DateTimeParseException invalid) {
        continue;
      }
      comparable.add(entry);
      sources.addAll(
          provenance(
              baseline,
              "retrievedAt",
              "Сопоставимый показатель: " + Json.str(baseline.path("baselineRegion"), "name")));
    }
    if (comparable.isEmpty())
      return unknown(
          "area_safety",
          "Нет сопоставимого районного показателя: абсолютное число происшествий не является"
              + " оценкой безопасности",
          details,
          sources);
    Map<String, String> seen = new HashMap<>();
    boolean mismatch = false;
    String summary = "";
    for (JsonNode entry : comparable) {
      JsonNode baseline = entry.path("comparator");
      String
          key =
              Json.str(entry.path("rateDefinition"), "categoryCode")
                  + entry.path("period").toString(),
          values = entry.path("value").toString() + "/" + baseline.path("value").toString();
      if (seen.containsKey(key) && !seen.get(key).equals(values))
        return criterion(
            "area_safety",
            "conflict",
            "Сопоставимые источники расходятся в значениях; нужна проверка",
            details,
            sources,
            null);
      seen.put(key, values);
      mismatch |= entry.path("value").asDouble() > baseline.path("value").asDouble();
      summary =
          format(entry.path("value").asDouble())
              + " против "
              + format(baseline.path("value").asDouble())
              + " на 100 000 жителей";
      details.add(
          Json.str(entry, "metricLabel")
              + ": "
              + summary
              + "; период "
              + Json.str(entry.path("period"), "from")
              + " — "
              + Json.str(entry.path("period"), "to"));
    }
    return criterion(
        "area_safety",
        mismatch ? "mismatch" : "match",
        mismatch
            ? "Исторический районный показатель выше сопоставимого регионального"
            : "Исторический районный показатель не выше сопоставимого регионального",
        details,
        sources,
        summary);
  }

  private static boolean official(JsonNode value, Instant now) {
    if (!Json.str(value, "verification").equals("operator-checked-official-source")
        || !officialUrl(Json.str(value, "sourceUrl"))
        || Json.str(value, "sourcePublisher").isBlank()
        || Json.str(value, "sourceRecord").isBlank()) return false;
    Instant retrieved = time(Json.str(value, "retrievedAt"));
    if (retrieved == null || retrieved.isAfter(now)) return false;
    try {
      LocalDate published = LocalDate.parse(Json.str(value, "publishedAt"));
      return !published.isAfter(now.atZone(SEOUL).toLocalDate())
          && !published.isAfter(retrieved.atZone(SEOUL).toLocalDate())
          && !LocalDate.parse(Json.str(value.path("period"), "to")).isAfter(published);
    } catch (DateTimeParseException invalid) {
      return false;
    }
  }

  private static boolean officialUrl(String value) {
    if (!url(value)) return false;
    URI uri = URI.create(value);
    return uri.getScheme().equals("https")
        && (uri.getHost().equals("go.kr") || uri.getHost().endsWith(".go.kr"));
  }

  static ObjectNode noise(JsonNode context, JsonNode hotel, JsonNode trip, Instant now) {
    List<String> details =
        new ArrayList<>(
            List.of(
                "Оценка относительного риска внешнего шума, не децибелы и не уровень внутри"
                    + " номера.",
                "Близость дороги — фоновая экспозиция. Отсутствие найденного события или данных о"
                    + " трафике не подтверждает тишину."));
    List<JsonNode> sources = new ArrayList<>();
    if (!Json.str(context, "region").equals(Json.str(trip, "region"))
        || !Json.str(context, "timeZone").equals("Asia/Seoul"))
      return noiseResult("unknown", 0, details, sources);
    String trafficReason = Json.str(context.path("coverage").path("traffic"), "reason"),
        eventsReason = Json.str(context.path("coverage").path("events"), "reason");
    if (!trafficReason.isBlank()) details.add("Данные о движении: " + trafficReason);
    if (!eventsReason.isBlank()) details.add("Полнота календаря: " + eventsReason);
    Instant from = start(trip), to = end(trip);
    JsonNode location = hotel.path("coordinates"), bbox = context.path("bbox");
    if (!point(location) || !bbox.isArray() || bbox.size() != 4)
      return noiseResult("unknown", 0, details, sources);
    for (JsonNode bound : bbox)
      if (!number(bound)) return noiseResult("unknown", 0, details, sources);
    if (location.get(0).asDouble() < bbox.get(0).asDouble()
        || location.get(0).asDouble() > bbox.get(2).asDouble()
        || location.get(1).asDouble() < bbox.get(1).asDouble()
        || location.get(1).asDouble() > bbox.get(3).asDouble()) {
      details.add("Отель вне территории сохранённого контекста.");
      return noiseResult("unknown", 0, details, sources);
    }
    int risk = 0;
    String cause = "";
    boolean dated = false;
    boolean validInventory = true;
    List<JsonNode> nearRoads = new ArrayList<>();
    for (JsonNode road : context.path("roads")) {
      if (!datedSource(road.path("source"), now) || !validLine(road.path("geometry"))) {
        validInventory = false;
        continue;
      }
      double distance = lineDistance(location, road.path("geometry"));
      if (distance <= 300) nearRoads.add(road);
    }
    nearRoads.sort(
        Comparator.comparingDouble(road -> lineDistance(location, road.path("geometry"))));
    for (JsonNode road : nearRoads.stream().limit(5).toList()) {
      double distance = lineDistance(location, road.path("geometry"));
      details.add(
          "Фоновая экспозиция: "
              + Json.str(road, "name")
              + " ("
              + Json.str(road, "roadClass")
              + "), около "
              + Math.round(distance)
              + " м; интенсивность движения из типа дороги не выводится.");
      sources.addAll(
          provenance(road.path("source"), "retrievedAt", "Геометрия и класс дороги OSM"));
    }
    if (nearRoads.size() > 5)
      details.add(
          "В расчёте учтены все "
              + nearRoads.size()
              + " дорожных сегментов в пределах 300 м; показаны 5 ближайших.");
    for (JsonNode event : context.path("events")) {
      if (Json.str(event, "eventType").equals("holiday")
          || !Set.of("scheduled", "historical").contains(Json.str(event, "status"))) continue;
      Instant starts = time(Json.str(event, "startsAt")), ends = time(Json.str(event, "endsAt"));
      if (!overlaps(starts, ends, from, to)
          || !datedSource(event.path("source"), now)
          || !datedSource(event.path("geometrySource"), now)
          || !number(event.path("influenceRadiusMeters"))) continue;
      double radius = event.path("influenceRadiusMeters").asDouble(),
          distance = geometryDistance(location, event.path("geometry"));
      if (radius <= 0 || radius > 10000 || distance > radius) continue;
      String potential = Json.str(event, "noisePotential");
      int eventRisk =
          switch (potential) {
            case "high" -> distance <= radius / 2 ? 3 : 2;
            case "moderate" -> 2;
            case "low" -> 1;
            default -> 0;
          };
      if (eventRisk == 0) continue;
      dated = true;
      if (eventRisk > risk)
        cause = "событие «" + Json.str(event, "name") + "», " + localTime(starts) + " (Пусан)";
      risk = Math.max(risk, eventRisk);
      details.add(
          "На даты поездки: "
              + Json.str(event, "name")
              + ", "
              + localTime(starts)
              + " — "
              + localTime(ends)
              + " (Пусан), около "
              + Math.round(distance)
              + " м. Зона влияния — допущение оценки, а не измерение звука.");
      if (!Json.str(event, "influenceBasis").isBlank())
        details.add("Основание зоны влияния: " + Json.str(event, "influenceBasis"));
      for (JsonNode limitation : event.path("limitations"))
        if (limitation.isTextual()) details.add(limitation.asText());
      sources.addAll(
          provenance(
              event.path("source"),
              "retrievedAt",
              "Расписание события: " + Json.str(event, "name")));
      sources.addAll(
          provenance(
              event.path("geometrySource"),
              "retrievedAt",
              "Местоположение события: " + Json.str(event, "name")));
    }
    boolean allRoadsCovered = !nearRoads.isEmpty() && validInventory;
    for (JsonNode road : nearRoads) {
      List<Instant[]> intervals = new ArrayList<>();
      double distance = lineDistance(location, road.path("geometry"));
      for (JsonNode observation : context.path("trafficObservations")) {
        Instant starts = time(Json.str(observation, "startsAt")),
            ends = time(Json.str(observation, "endsAt"));
        if (!Json.str(observation, "roadId").equals(Json.str(road, "id"))
            || !overlaps(starts, ends, from, to)
            || ends.isAfter(now)
            || !datedSource(observation.path("source"), now)
            || ends.isAfter(time(Json.str(observation.path("source"), "retrievedAt")))
            || !nonnegative(observation.path("vehicleCount"))
            || !observation.path("vehicleCount").isIntegralNumber()
            || !observation.path("lanes").isIntegralNumber()
            || observation.path("lanes").asInt() <= 0
            || observation.path("lanes").asInt() > 20
            || !Set.of("one_direction", "both_directions")
                .contains(Json.str(observation, "direction"))) continue;
        if (Duration.between(starts, ends).toSeconds() < 60
            || Duration.between(starts, ends).toSeconds() > 86400) continue;
        double hours = Duration.between(starts, ends).toSeconds() / 3600.0;
        if (hours <= 0) continue;
        double perLane =
            observation.path("vehicleCount").asDouble() / hours / observation.path("lanes").asInt();
        int trafficRisk =
            perLane > 700
                ? (distance <= 75 ? 3 : distance <= 150 ? 2 : 1)
                : perLane > 300 ? (distance <= 150 ? 2 : 1) : 1;
        if (trafficRisk > risk)
          cause = "наблюдаемая транспортная нагрузка на «" + Json.str(road, "name") + "»";
        risk = Math.max(risk, trafficRisk);
        dated = true;
        if (Json.str(observation, "direction").equals("both_directions")
            || (road.path("oneWay").isBoolean() && road.path("oneWay").asBoolean()))
          intervals.add(new Instant[] {starts, ends});
        details.add(
            "Наблюдаемая средняя нагрузка: "
                + format(perLane)
                + " автомобилей/час/полосу, "
                + localTime(starts)
                + " — "
                + localTime(ends)
                + " (Пусан). Порог риска — эвристика, не шумомер.");
        sources.addAll(
            provenance(
                observation.path("source"),
                "retrievedAt",
                "Подсчёт транспорта на " + Json.str(road, "name")));
      }
      if (!covers(intervals, from, to)) allRoadsCovered = false;
    }
    if (risk >= 2 && dated) {
      ObjectNode result = noiseResult("mismatch", risk, details, sources);
      if (!cause.isBlank())
        result.put("explanation", Json.str(result, "explanation") + " — " + cause);
      return result;
    }
    boolean eventsComplete =
        completeCoverage(context.path("coverage").path("events"), location, from, to, now);
    boolean trafficComplete =
        completeCoverage(context.path("coverage").path("traffic"), location, from, to, now);
    trafficComplete &=
        boundaryClearance(location, context.path("coverage").path("traffic").path("geometry"))
            >= 300;
    if (allRoadsCovered && trafficComplete && eventsComplete)
      return noiseResult("match", 1, details, sources);
    details.add(
        "Нет полного подтверждённого покрытия транспортной нагрузки и событий на всё пребывание.");
    return noiseResult("unknown", 0, details, sources);
  }

  /** Historical link counts are ranking hints only, never observations for the selected dates. */
  static ObjectNode noise(
      JsonNode context, JsonNode history, JsonNode hotel, JsonNode trip, Instant now) {
    ObjectNode dated = noise(context, hotel, trip, now);
    if (!Json.str(dated, "status").equals("unknown")) return dated;
    if (!Json.str(history, "region").equals(Json.str(trip, "region"))
        || !Json.str(history, "kind").equals("historical_observed_profile")
        || !Json.str(history, "timeZone").equals("Asia/Seoul")
        || !Json.str(history, "dayType").equals("weekday")
        || !history.path("referenceYear").isIntegralNumber()
        || !datedSource(history.path("source"), now)
        || !history.path("historicalTrafficProfiles").isArray()
        || !point(hotel.path("coordinates"))) return dated;
    LocalDate checkIn = start(trip).atZone(SEOUL).toLocalDate(),
        checkOut = end(trip).atZone(SEOUL).toLocalDate();
    int year = history.path("referenceYear").asInt();
    boolean weekday = false;
    for (LocalDate day = checkIn;
        day.isBefore(checkOut) && day.isBefore(checkIn.plusDays(7));
        day = day.plusDays(1)) if (day.getDayOfWeek().getValue() <= 5) weekday = true;
    if (!weekday
        || year < 1900
        || year > now.atZone(SEOUL).getYear()
        || year > checkIn.getYear()
        || checkIn.getYear() - year > 3) return dated;

    List<HistoricalLink> nearby = new ArrayList<>();
    for (JsonNode profile : history.path("historicalTrafficProfiles")) {
      JsonNode geometry = profile.path("geometry"), counts = profile.path("hourlyVehicleCounts");
      if (!profile.path("referenceYear").isIntegralNumber()
          || profile.path("referenceYear").asInt() != year
          || !Json.str(profile, "dayType").equals("weekday")
          || !Json.str(geometry, "type").equals("LineString")
          || !validLine(geometry.path("coordinates"))
          || !datedSource(profile.path("source"), now)
          || !counts.isArray()
          || counts.size() != 24) continue;
      double distance = lineDistance(hotel.path("coordinates"), geometry.path("coordinates"));
      if (distance > 300) continue;
      double peak = 0;
      int available = 0;
      boolean valid = true;
      for (JsonNode count : counts) {
        if (count.isNull()) continue;
        if (!nonnegative(count)) {
          valid = false;
          break;
        }
        peak = Math.max(peak, count.asDouble());
        available++;
      }
      if (!valid || available == 0) continue;
      int risk =
          peak > 1500
              ? (distance <= 75 ? 3 : distance <= 150 ? 2 : 1)
              : peak > 500 ? (distance <= 150 ? 2 : 1) : 1;
      nearby.add(new HistoricalLink(profile, distance, peak, available, risk));
    }
    if (nearby.isEmpty()) return dated;
    nearby.sort(
        Comparator.comparingInt(HistoricalLink::risk)
            .reversed()
            .thenComparingDouble(HistoricalLink::distance));
    List<String> details = new ArrayList<>();
    for (JsonNode detail : dated.path("details")) details.add(detail.asText());
    List<JsonNode> evidence = new ArrayList<>(Json.list(dated.path("environmentalEvidence")));
    details.add(
        "Предварительный фон по историческим будним подсчётам KTDB за "
            + year
            + " год. Это не наблюдение и не прогноз движения на даты поездки; для выходных профиль"
            + " не применяется.");
    details.add(
        "Пиковое доступное часовое значение относится ко всему исходному дорожному сегменту."
            + " Число полос и направление не установлены; пересчёта на полосу нет."
            + " Пороги ≤500, ≤1500 и >1500 автомобилей/час — эвристика риска, не измерение звука.");
    for (HistoricalLink link : nearby.stream().limit(5).toList()) {
      details.add(
          "KTDB "
              + Json.str(link.profile, "sourceLinkId")
              + ": около "
              + Math.round(link.distance)
              + " м, максимум "
              + format(link.peak)
              + " автомобилей/час среди "
              + link.available
              + " из 24 доступных часов (будни, "
              + year
              + "). Пропуски не считались нулями.");
      evidence.addAll(
          provenance(
              link.profile.path("source"),
              "retrievedAt",
              "Исторические подсчёты KTDB "
                  + year
                  + ", сегмент "
                  + Json.str(link.profile, "sourceLinkId")));
      for (JsonNode limitation : link.profile.path("limitations"))
        if (limitation.isTextual() && !details.contains(limitation.asText()))
          details.add(limitation.asText());
    }
    if (nearby.size() > 5)
      details.add(
          "Учтены все "
              + nearby.size()
              + " исторических сегментов в пределах 300 м; показаны 5 с наибольшим риском.");
    for (JsonNode limitation : history.path("limitations"))
      if (limitation.isTextual() && !details.contains(limitation.asText()))
        details.add(limitation.asText());
    ObjectNode result =
        noiseResult("unknown", nearby.getFirst().risk, details, evidence)
            .put("assessmentBasis", "historical");
    result.put(
        "explanation",
        Json.str(result, "explanation")
            + " — предварительная оценка по будним"
            + " подсчётам "
            + year
            + " года; прогноз на даты поездки неизвестен");
    return result;
  }

  private record HistoricalLink(
      JsonNode profile, double distance, double peak, int available, int risk) {}

  private static boolean completeCoverage(
      JsonNode coverage, JsonNode location, Instant from, Instant to, Instant now) {
    boolean complete =
        Json.str(coverage, "status").equals("complete")
            && datedSource(coverage.path("verificationSource"), now)
            && fresh(time(Json.str(coverage.path("verificationSource"), "retrievedAt")), now)
            && inside(location, coverage.path("geometry"));
    Instant coverageStart = time(Json.str(coverage, "startsAt")),
        coverageEnd = time(Json.str(coverage, "endsAt")),
        verified = time(Json.str(coverage, "verifiedAt"));
    complete &=
        coverageStart != null
            && coverageEnd != null
            && !coverageStart.isAfter(from)
            && !coverageEnd.isBefore(to)
            && fresh(verified, now);
    return complete;
  }

  private static ObjectNode noiseResult(
      String status, int risk, List<String> details, List<JsonNode> evidence) {
    String label =
        switch (risk) {
          case 3 -> "высокий";
          case 2 -> "умеренный";
          case 1 -> "низкий";
          default -> "не определён";
        };
    String riskLevel =
        switch (risk) {
          case 3 -> "high";
          case 2 -> "moderate";
          case 1 -> "low";
          default -> "unknown";
        };
    return criterion("low_noise", status, "Риск внешнего шума: " + label, details, evidence, label)
        .put("riskLevel", riskLevel);
  }

  private static boolean datedSource(JsonNode source, Instant now) {
    Instant retrieved = time(Json.str(source, "retrievedAt"));
    return url(Json.str(source, "url"))
        && !Json.str(source, "publisher").isBlank()
        && retrieved != null
        && !retrieved.isAfter(now);
  }

  private static boolean overlaps(Instant a, Instant b, Instant from, Instant to) {
    return a != null && b != null && a.isBefore(b) && a.isBefore(to) && b.isAfter(from);
  }

  private static boolean covers(List<Instant[]> intervals, Instant from, Instant to) {
    intervals.sort(Comparator.comparing(i -> i[0]));
    Instant cursor = from;
    for (Instant[] interval : intervals) {
      if (interval[0].isAfter(cursor)) return false;
      if (interval[1].isAfter(cursor)) cursor = interval[1];
      if (!cursor.isBefore(to)) return true;
    }
    return false;
  }

  static boolean inside(JsonNode point, JsonNode geometry) {
    if (!point(point)) return false;
    String type = Json.str(geometry, "type");
    if (type.equals("Polygon")) return polygon(point, geometry.path("coordinates"));
    if (type.equals("MultiPolygon")) {
      for (JsonNode polygon : geometry.path("coordinates"))
        if (polygon(point, polygon)) return true;
    }
    return false;
  }

  private static boolean polygon(JsonNode point, JsonNode rings) {
    if (!rings.isArray() || rings.isEmpty() || ring(point, rings.get(0)) != 1) return false;
    for (int i = 1; i < rings.size(); i++) if (ring(point, rings.get(i)) != 0) return false;
    return true;
  }

  private static int ring(JsonNode point, JsonNode ring) {
    if (!ring.isArray() || ring.size() < 4) return -1;
    JsonNode first = ring.get(0), last = ring.get(ring.size() - 1);
    if (!point(first)
        || !point(last)
        || first.get(0).asDouble() != last.get(0).asDouble()
        || first.get(1).asDouble() != last.get(1).asDouble()) return -1;
    double x = point.get(0).asDouble(), y = point.get(1).asDouble();
    boolean inside = false;
    for (int i = 0, j = ring.size() - 1; i < ring.size(); j = i++) {
      JsonNode a = ring.get(i), b = ring.get(j);
      if (!point(a) || !point(b)) return -1;
      double ax = a.get(0).asDouble(),
          ay = a.get(1).asDouble(),
          bx = b.get(0).asDouble(),
          by = b.get(1).asDouble();
      double cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
      if (Math.abs(cross) < 1e-12
          && x >= Math.min(ax, bx)
          && x <= Math.max(ax, bx)
          && y >= Math.min(ay, by)
          && y <= Math.max(ay, by)) return -1;
      if ((ay > y) != (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    }
    return inside ? 1 : 0;
  }

  private static boolean validLine(JsonNode line) {
    return line.isArray()
        && line.size() >= 2
        && Json.list(line).stream().allMatch(Environment::point);
  }

  private static boolean boundaryProvenance(JsonNode geometry) {
    if (Json.str(geometry, "name").isBlank() || Json.str(geometry, "code").isBlank()) return false;
    String value = Json.str(geometry, "sourceUrl");
    if (officialUrl(value)) return true;
    if (!url(value)) return false;
    URI uri = URI.create(value);
    return uri.getScheme().equals("https")
        && Set.of("www.openstreetmap.org", "openstreetmap.org").contains(uri.getHost())
        && uri.getPath().matches("/relation/\\d+/?");
  }

  private static double boundaryClearance(JsonNode location, JsonNode geometry) {
    if (!Json.str(geometry, "type").equals("Polygon")) return 0;
    double minimum = Double.POSITIVE_INFINITY;
    for (JsonNode ring : geometry.path("coordinates"))
      minimum = Math.min(minimum, lineDistance(location, ring));
    return minimum;
  }

  private static double geometryDistance(JsonNode location, JsonNode geometry) {
    if (Json.str(geometry, "type").equals("Point"))
      return distance(location, geometry.path("coordinates"));
    if (inside(location, geometry)) return 0;
    if (Json.str(geometry, "type").equals("Polygon")) {
      double min = Double.POSITIVE_INFINITY;
      for (JsonNode ring : geometry.path("coordinates"))
        min = Math.min(min, lineDistance(location, ring));
      return min;
    }
    return Double.POSITIVE_INFINITY;
  }

  private static double distance(JsonNode a, JsonNode b) {
    if (!point(a) || !point(b)) return Double.POSITIVE_INFINITY;
    double lat = Math.toRadians((a.get(1).asDouble() + b.get(1).asDouble()) / 2),
        x = Math.toRadians(a.get(0).asDouble() - b.get(0).asDouble()) * Math.cos(lat),
        y = Math.toRadians(a.get(1).asDouble() - b.get(1).asDouble());
    return Math.hypot(x, y) * 6371000;
  }

  private static double lineDistance(JsonNode p, JsonNode line) {
    if (!point(p) || !line.isArray() || line.size() < 2) return Double.POSITIVE_INFINITY;
    double min = Double.POSITIVE_INFINITY, scale = Math.cos(Math.toRadians(p.get(1).asDouble()));
    for (int i = 1; i < line.size(); i++) {
      JsonNode a = line.get(i - 1), b = line.get(i);
      if (!point(a) || !point(b)) continue;
      double ax = (a.get(0).asDouble() - p.get(0).asDouble()) * scale,
          ay = a.get(1).asDouble() - p.get(1).asDouble(),
          bx = (b.get(0).asDouble() - p.get(0).asDouble()) * scale,
          by = b.get(1).asDouble() - p.get(1).asDouble(),
          dx = bx - ax,
          dy = by - ay,
          len = dx * dx + dy * dy,
          t = len == 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
      min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy) * 111195);
    }
    return min;
  }

  private static String format(double value) {
    return String.format(java.util.Locale.ROOT, "%.1f", value);
  }

  private static String localTime(Instant value) {
    return DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm").withZone(SEOUL).format(value);
  }
}
