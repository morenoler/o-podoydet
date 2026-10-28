package ru.opodoydet.server.web;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.auth.AuthService;
import ru.opodoydet.accounts.photos.PhotoService;
import ru.opodoydet.advisor.AdvisorService;
import ru.opodoydet.application.Agents;
import ru.opodoydet.application.Environment;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.application.WindowViewClient;
import ru.opodoydet.domain.Features;
import ru.opodoydet.domain.Matching;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;
import ru.opodoydet.shared.Json;

/**
 * Остальные маршруты старого API: оценка района, помощник подбора, лаборатория, демонстрационные
 * вопросы по каталогу и фото из кабинетов. Логика перенесена из старого Api без изменений.
 */
@RestController
public class PlatformController {

  private final Store store;
  private final Agents agents;
  private final Environment environment;
  private final SearchService search;
  private final AdvisorService advisor;
  private final AuthService auth;
  private final PhotoService photos;
  private final Path areaData;
  private final boolean accounts;
  private final boolean labMode;
  private final AdvisorIdentity identity;
  private final WindowViewClient windowViews;
  private final Clock clock;

  PlatformController(
      Store store,
      Agents agents,
      Environment environment,
      SearchService search,
      AdvisorService advisor,
      AuthService auth,
      PhotoService photos,
      AdvisorIdentity identity,
      WindowViewClient windowViews,
      RuntimeEnv env,
      Clock clock) {
    this.identity = identity;
    this.windowViews = windowViews;
    this.clock = clock;
    this.store = store;
    this.agents = agents;
    this.environment = environment;
    this.search = search;
    this.advisor = advisor;
    this.auth = auth;
    this.photos = photos;
    this.areaData = Path.of(env.get("AREA_DATA_PATH", "data/area-assessments.json"));
    this.accounts = env.accountsEnabled();
    this.labMode = env.labMode();
  }

  // ---- Фото из кабинетов ----

  @RequestMapping("/uploads/**")
  public ResponseEntity<String> upload(HttpServletRequest request, HttpServletResponse response)
      throws IOException, SQLException {
    if (!accounts) return JsonResponses.notFound("Фотография не найдена.");
    try {
      photos.serve(request, response, auth.current(request));
      return null; // ответ уже записан
    } catch (AccountProblem problem) {
      return JsonResponses.send(problem.status, Json.obj("error", problem.getMessage()));
    }
  }

  // ---- Оценка района ----

  @RequestMapping("/api/areas/**")
  public ResponseEntity<String> area(HttpServletRequest request) throws IOException {
    if (!request.getMethod().equals("GET")) return JsonResponses.notFound("Метод не найден");
    JsonNode hotel = store.hotel(request.getRequestURI().substring("/api/areas/".length()));
    if (hotel == null) return JsonResponses.notFound("Отель не найден");
    return JsonResponses.send(200, Json.obj("assessment", assessment(hotel, clock.instant())));
  }

  // ---- Геометрическая оценка вида из окна ----

  @RequestMapping("/api/views/estimate")
  public ResponseEntity<String> windowView(HttpServletRequest request) throws IOException {
    if (!request.getMethod().equals("POST"))
      return JsonResponses.send(405, Json.obj("error", "Метод не поддерживается"));
    String type = request.getContentType();
    if (type == null || !type.split(";", 2)[0].trim().equalsIgnoreCase("application/json"))
      return JsonResponses.send(415, Json.obj("error", "application_json_required"));
    byte[] input = request.getInputStream().readNBytes(WindowViewClient.MAX_REQUEST_BYTES + 1);
    if (input.length > WindowViewClient.MAX_REQUEST_BYTES)
      return JsonResponses.send(
          413,
          Json.obj("error", "request_too_large", "max_bytes", WindowViewClient.MAX_REQUEST_BYTES));
    JsonNode payload;
    try {
      payload =
          Json.MAPPER.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(input);
    } catch (IOException invalid) {
      throw new IllegalArgumentException("Некорректный JSON");
    }
    WindowViewClient.Result result = windowViews.estimate(payload);
    return JsonResponses.send(result.status(), result.body());
  }

  // ---- Лаборатория ----

  @RequestMapping("/api/lab/search")
  public ResponseEntity<String> lab(HttpServletRequest request, HttpServletResponse response)
      throws IOException, SQLException {
    if (!labMode || !request.getMethod().equals("POST"))
      return JsonResponses.notFound("Метод не найден");
    return JsonResponses.send(
        200, search.searchLab(body(request), identity.resolve(request, response)));
  }

  // ---- Помощник подбора ----

  @RequestMapping("/api/search/conversation")
  public ResponseEntity<String> conversation(HttpServletRequest request) throws IOException {
    if (!request.getMethod().equals("POST"))
      return JsonResponses.send(405, Json.obj("error", "Метод не поддерживается"));
    return JsonResponses.send(200, search.refine(body(request)));
  }

  @RequestMapping("/api/advisor/**")
  public ResponseEntity<String> advisor(HttpServletRequest request, HttpServletResponse response)
      throws IOException, SQLException {
    String path = request.getRequestURI(), method = request.getMethod();
    try {
      if (method.equals("GET") && path.equals("/api/advisor/config"))
        return JsonResponses.send(200, advisor.config());
      String actor = identity.resolve(request, response);
      if (path.equals("/api/advisor/runs")) {
        if (method.equals("GET")) return JsonResponses.send(200, advisor.list(actor));
        if (method.equals("POST"))
          return JsonResponses.send(202, advisor.start(body(request), actor));
      }
      String[] parts = path.split("/");
      JsonNode result = null;
      if (parts.length == 5 && parts[3].equals("runs") && method.equals("GET"))
        result = advisor.get(parts[4], actor);
      else if (parts.length == 6 && parts[3].equals("runs") && method.equals("POST")) {
        body(request);
        if (parts[5].equals("cancel")) result = advisor.cancel(parts[4], actor);
      }
      return result == null
          ? JsonResponses.notFound("Задание помощника или действие не найдено")
          : JsonResponses.send(200, result);
    } catch (IllegalStateException error) {
      return JsonResponses.send(409, Json.obj("error", error.getMessage()));
    }
  }

  // ---- Демонстрационные вопросы по каталогу ----

  @RequestMapping({"/api/questions", "/api/questions/**", "/api/drafts/**"})
  public ResponseEntity<String> questions(HttpServletRequest request) throws IOException {
    if (accounts)
      return JsonResponses.send(
          403,
          Json.obj("error", "Ответы принимаются только по вашим объявлениям в личном кабинете."));
    String path = request.getRequestURI(), method = request.getMethod();
    if (method.equals("GET") && path.equals("/api/questions"))
      return JsonResponses.send(200, store.forRegion(request.getParameter("region")).questions());
    if (!method.equals("POST")) return JsonResponses.notFound("Метод не найден");
    JsonNode input = body(request);
    if (path.equals("/api/questions")) return ask(input);
    String[] parts = path.split("/");
    if (parts.length == 5 && parts[2].equals("questions") && parts[4].equals("preview")) {
      String text = Validation.text(input, "text", 3, 1500).trim();
      if (text.length() < 3) throw new IllegalArgumentException("Ответ слишком короткий");
      JsonNode question = store.question(parts[3]);
      if (question == null || !Json.str(question, "status").equals("open"))
        return JsonResponses.notFound("Открытый вопрос не найден");
      ObjectNode draft = agents.extract(text, Json.str(question, "feature"));
      draft
          .put("id", UUID.randomUUID().toString())
          .put("questionId", Json.str(question, "id"))
          .put("text", text);
      JsonNode latest = store.question(Json.str(question, "id"));
      if (latest == null || !Json.str(latest, "createdAt").equals(Json.str(question, "createdAt")))
        return JsonResponses.send(
            409, Json.obj("error", "Вопрос был обновлён во время разбора. Откройте его заново."));
      store.saveDraft(draft, Json.str(question, "createdAt"));
      return JsonResponses.send(200, draft);
    }
    if (parts.length == 5 && parts[2].equals("drafts") && parts[4].equals("confirm"))
      return JsonResponses.send(
          200,
          Json.obj("facts", store.confirm(parts[3], Validation.bool(input, "resolveConflict"))));
    return JsonResponses.notFound("Метод не найден");
  }

  private ResponseEntity<String> ask(JsonNode input) {
    Store store = this.store.forTrip(input.path("trip"));
    String hotelId = Validation.text(input, "hotelId", 1, 150),
        roomId = Validation.text(input, "roomId", 1, 150),
        feature = Validation.feature(input, "feature");
    JsonNode trip = Validation.trip(input.path("trip"), store.region());
    JsonNode hotel = store.hotel(hotelId), room = hotel == null ? null : Store.room(hotel, roomId);
    if (room == null) return JsonResponses.notFound("Категория номера не найдена");
    Features.Definition definition = Features.get(feature);
    if (definition.tool().equals("area")) {
      JsonNode result =
          environment.evaluate(List.of(hotel), trip, clock.instant()).get(hotelId).get(feature);
      return JsonResponses.send(
          200,
          Json.obj(
              "question",
              null,
              "message",
              Json.str(result, "explanation")
                  + ". Условие проверяется по независимым источникам на даты поездки; ответ"
                  + " отельера не заменяет эти данные."));
    }
    JsonNode criterion =
        Matching.evaluate(
            store.matchingFacts().stream()
                .filter(f -> Json.str(f, "hotelId").equals(hotelId))
                .toList(),
            Json.obj("feature", feature, "required", false),
            room,
            trip,
            clock.instant(),
            store.evidencePolicy());
    if (definition.tool().equals("route"))
      return JsonResponses.send(
          200,
          Json.obj(
              "question",
              null,
              "message",
              hotel.hasNonNull("route")
                  ? "Маршрут рассчитан по сохранённой карте. Доступность всего пути требует"
                      + " обследования; отсутствие отметок не подтверждает отсутствие"
                      + " препятствий."
                  : "Для этого отеля маршрут по сохранённой карте не найден. Геоданных"
                      + " недостаточно; расстояние и доступность пути остаются"
                      + " неизвестными."));
    JsonNode question =
        store.ask(
            Json.obj(
                "hotelId", hotelId,
                "roomId", roomId,
                "feature", feature,
                "text", Json.str(room, "name") + ": " + definition.question(),
                "trace",
                    List.of(
                        Json.obj(
                            "step", "Проверка базы",
                            "detail", "Состояние характеристики: " + Json.str(criterion, "status"),
                            "tool", "facts.lookup"),
                        Json.obj(
                            "step", "Выбор инструмента",
                            "detail",
                                "Для условий внутри номера геоданных недостаточно. Выбран вопрос"
                                    + " отельеру.",
                            "tool", "host.ask"),
                        Json.obj(
                            "step",
                            "Вопрос",
                            "detail",
                            "Привязан к конкретной категории. Повторный открытый вопрос не"
                                + " создаётся."))));
    return JsonResponses.send(
        200,
        Json.obj(
            "question",
            question,
            "message",
            "Вопрос добавлен в демонстрационный кабинет отельера."));
  }

  // ---- Всё остальное под /api ----

  @RequestMapping({"/api", "/api/**"})
  public ResponseEntity<String> unknown() {
    return JsonResponses.notFound("Метод не найден");
  }

  /** Оценка района из data/area-assessments.json — перенос Api.assessment. */
  public JsonNode assessment(JsonNode hotel, Instant now) throws IOException {
    if (!Files.isRegularFile(areaData)) return null;
    JsonNode file = Json.MAPPER.readTree(areaData.toFile());
    String region = store.hotelRegion(Json.str(hotel, "id"));
    if (region == null) region = store.region();
    if (file.hasNonNull("region") && !Json.str(file, "region").equals(region)) return null;
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
        ObjectNode assessment = item.deepCopy();
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

  /** Тело запроса: JSON-объект не больше 24 КБ — как в старом Api. */
  public static JsonNode body(HttpServletRequest request) throws IOException {
    byte[] input = request.getInputStream().readNBytes(24 * 1024 + 1);
    if (input.length > 24 * 1024) throw new IllegalArgumentException("Запрос слишком большой");
    JsonNode parsed = Json.read(new String(input, StandardCharsets.UTF_8));
    if (parsed == null || !parsed.isObject())
      throw new IllegalArgumentException("Ожидается JSON-объект");
    return parsed;
  }
}
