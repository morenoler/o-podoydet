package ru.opodoydet;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Local demo API. A production service would additionally need user authentication and
 * authorization.
 */
final class Api implements AutoCloseable {
  private final Store store;
  private final Agents agents;
  private final Path dist;
  private final Path areaData;
  private final String frontendOrigin;
  private final HttpServer server;
  private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

  Api(Store store, Agents agents, Path dist, Path areaData, String frontendOrigin, int port)
      throws IOException {
    this.store = store;
    this.agents = agents;
    this.dist = dist.toAbsolutePath().normalize();
    this.areaData = areaData;
    this.frontendOrigin = frontendOrigin;
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
    server.setExecutor(executor);
    server.createContext("/", this::handle);
  }

  void start() {
    server.start();
  }

  int port() {
    return server.getAddress().getPort();
  }

  private void handle(HttpExchange exchange) throws IOException {
    try {
      if (exchange.getRequestURI().getPath().startsWith("/api")) {
        if (!exchange.getRequestMethod().equals("GET") && !originAllowed(exchange)) {
          send(
              exchange,
              403,
              Json.obj("error", "Запрос должен быть отправлен из этого приложения."));
          return;
        }
        route(exchange);
      } else staticFile(exchange);
    } catch (IllegalArgumentException error) {
      send(
          exchange,
          400,
          Json.obj(
              "error", error.getMessage() == null ? "Некорректный запрос" : error.getMessage()));
    } catch (Exception error) {
      System.err.println("Request failed: " + error.getClass().getSimpleName());
      send(exchange, 500, Json.obj("error", "Не удалось выполнить действие. Повторите запрос."));
    } finally {
      exchange.close();
    }
  }

  private boolean originAllowed(HttpExchange exchange) {
    String origin = exchange.getRequestHeaders().getFirst("Origin");
    if (origin == null) return true;
    try {
      URI parsed = URI.create(origin);
      return (parsed.getScheme().equals("http") || parsed.getScheme().equals("https"))
          && parsed.getRawUserInfo() == null
          && (parsed.getAuthority().equals(exchange.getRequestHeaders().getFirst("Host"))
              || (!frontendOrigin.isBlank() && origin.equals(frontendOrigin)));
    } catch (RuntimeException error) {
      return false;
    }
  }

  private void route(HttpExchange exchange) throws IOException, SQLException {
    String path = exchange.getRequestURI().getPath(), method = exchange.getRequestMethod();
    if (method.equals("GET")) {
      if (path.equals("/api/health")) {
        send(
            exchange,
            200,
            Json.obj(
                "ok",
                true,
                "hotels",
                store.hotels().size(),
                "mode",
                agents.mode(),
                "runtime",
                "Java " + Runtime.version().feature(),
                "database",
                "SQLite 3",
                "region",
                store.region));
        return;
      }
      if (path.equals("/api/catalog")) {
        send(exchange, 200, store.dataset().put("mode", agents.mode()));
        return;
      }
      if (path.equals("/api/questions")) {
        send(exchange, 200, store.questions());
        return;
      }
      if (path.startsWith("/api/hotels/")) {
        String id = path.substring("/api/hotels/".length());
        JsonNode hotel = store.hotel(id);
        if (hotel == null) {
          notFound(exchange, "Отель не найден");
          return;
        }
        send(
            exchange,
            200,
            Json.obj(
                "hotel",
                hotel,
                "facts",
                store.facts().stream().filter(f -> Json.str(f, "hotelId").equals(id)).toList(),
                "questions",
                store.questions().stream()
                    .filter(q -> Json.str(q, "hotelId").equals(id))
                    .toList()));
        return;
      }
      if (path.startsWith("/api/areas/")) {
        JsonNode hotel = store.hotel(path.substring("/api/areas/".length()));
        if (hotel == null) {
          notFound(exchange, "Отель не найден");
          return;
        }
        send(exchange, 200, Json.obj("assessment", assessment(hotel, Instant.now())));
        return;
      }
    }
    if (method.equals("POST")) {
      JsonNode input = body(exchange);
      if (path.equals("/api/search")) {
        JsonNode trip = Validation.trip(input, store.region);
        ObjectNode interpreted = agents.interpret(trip);
        List<JsonNode> hotels = store.hotels();
        List<JsonNode> ranked =
            Matching.rank(
                hotels,
                store.facts(),
                Json.list(interpreted.path("preferences")),
                trip,
                Instant.now());
        interpreted.set(
            "results",
            Json.array(
                interpreted.path("conflicts").isEmpty()
                    ? ranked.stream()
                        .filter(h -> !Json.str(h.path("best"), "status").equals("excluded"))
                        .toList()
                    : List.of()));
        interpreted.set(
            "excluded",
            Json.array(
                ranked.stream()
                    .filter(h -> Json.str(h.path("best"), "status").equals("excluded"))
                    .toList()));
        interpreted.set(
            "trace",
            Json.array(
                List.of(
                    Json.obj(
                        "step",
                        "Запрос",
                        "detail",
                        Json.str(trip, "region")
                            + ", "
                            + Json.str(trip, "checkIn")
                            + " — "
                            + Json.str(trip, "checkOut")
                            + ". "
                            + interpreted.path("preferences").size()
                            + " пожеланий.",
                        "tool",
                        Json.str(interpreted, "mode").equals("llm")
                            ? "structured LLM"
                            : "local rules"),
                    Json.obj(
                        "step",
                        "Поиск",
                        "detail",
                        "Проверены "
                            + hotels.size()
                            + " отелей. Условия сопоставлены внутри одной категории номера.",
                        "tool",
                        "rankHotels"),
                    Json.obj(
                        "step",
                        "Доказательства",
                        "detail",
                        "Географические расчёты из локальной выгрузки; условия номеров —"
                            + " демонстрационные. Бронирование и цены не проверены.",
                        "tool",
                        "SQLite 3"))));
        send(exchange, 200, interpreted);
        return;
      }
      if (path.equals("/api/questions")) {
        String hotelId = Validation.text(input, "hotelId", 1, 150),
            roomId = Validation.text(input, "roomId", 1, 150),
            feature = Validation.feature(input, "feature");
        JsonNode trip = Validation.trip(input.path("trip"), store.region);
        JsonNode hotel = store.hotel(hotelId),
            room = hotel == null ? null : Store.room(hotel, roomId);
        if (room == null) {
          notFound(exchange, "Категория номера не найдена");
          return;
        }
        Features.Definition definition = Features.get(feature);
        JsonNode criterion =
            Matching.evaluate(
                store.facts().stream().filter(f -> Json.str(f, "hotelId").equals(hotelId)).toList(),
                Json.obj("feature", feature, "required", false),
                room,
                trip,
                Instant.now());
        if (definition.tool().equals("route")) {
          send(
              exchange,
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
          return;
        }
        JsonNode question =
            store.ask(
                Json.obj(
                    "hotelId",
                    hotelId,
                    "roomId",
                    roomId,
                    "feature",
                    feature,
                    "text",
                    Json.str(room, "name") + ": " + definition.question(),
                    "trace",
                    List.of(
                        Json.obj(
                            "step",
                            "Проверка базы",
                            "detail",
                            "Состояние характеристики: " + Json.str(criterion, "status"),
                            "tool",
                            "facts.lookup"),
                        Json.obj(
                            "step",
                            "Выбор инструмента",
                            "detail",
                            "Для условий внутри номера геоданных недостаточно. Выбран вопрос"
                                + " отельеру.",
                            "tool",
                            "host.ask"),
                        Json.obj(
                            "step",
                            "Вопрос",
                            "detail",
                            "Привязан к конкретной категории. Повторный открытый вопрос не"
                                + " создаётся."))));
        send(
            exchange,
            200,
            Json.obj(
                "question",
                question,
                "message",
                "Вопрос добавлен в демонстрационный кабинет отельера."));
        return;
      }
      String[] parts = path.split("/");
      if (parts.length == 5 && parts[2].equals("questions") && parts[4].equals("preview")) {
        String text = Validation.text(input, "text", 3, 1500).trim();
        if (text.length() < 3) throw new IllegalArgumentException("Ответ слишком короткий");
        JsonNode question = store.question(parts[3]);
        if (question == null || !Json.str(question, "status").equals("open")) {
          notFound(exchange, "Открытый вопрос не найден");
          return;
        }
        ObjectNode draft = agents.extract(text, Json.str(question, "feature"));
        draft
            .put("id", UUID.randomUUID().toString())
            .put("questionId", Json.str(question, "id"))
            .put("text", text);
        JsonNode latest = store.question(Json.str(question, "id"));
        if (latest == null
            || !Json.str(latest, "createdAt").equals(Json.str(question, "createdAt"))) {
          send(
              exchange,
              409,
              Json.obj("error", "Вопрос был обновлён во время разбора. Откройте его заново."));
          return;
        }
        store.saveDraft(draft, Json.str(question, "createdAt"));
        send(exchange, 200, draft);
        return;
      }
      if (parts.length == 5 && parts[2].equals("drafts") && parts[4].equals("confirm")) {
        send(
            exchange,
            200,
            Json.obj("facts", store.confirm(parts[3], Validation.bool(input, "resolveConflict"))));
        return;
      }
    }
    notFound(exchange, "Метод не найден");
  }

  JsonNode assessment(JsonNode hotel, Instant now) throws IOException {
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

  private static JsonNode body(HttpExchange exchange) throws IOException {
    byte[] input = exchange.getRequestBody().readNBytes(24 * 1024 + 1);
    if (input.length > 24 * 1024) throw new IllegalArgumentException("Запрос слишком большой");
    JsonNode parsed = Json.read(new String(input, StandardCharsets.UTF_8));
    if (parsed == null || !parsed.isObject())
      throw new IllegalArgumentException("Ожидается JSON-объект");
    return parsed;
  }

  private static void notFound(HttpExchange exchange, String message) throws IOException {
    send(exchange, 404, Json.obj("error", message));
  }

  private static void send(HttpExchange exchange, int status, Object body) throws IOException {
    byte[] output = Json.write(body).getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    exchange.getResponseHeaders().set("Cache-Control", "no-store");
    exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
    exchange.sendResponseHeaders(status, output.length);
    exchange.getResponseBody().write(output);
  }

  private void staticFile(HttpExchange exchange) throws IOException {
    if (!List.of("GET", "HEAD").contains(exchange.getRequestMethod())) {
      send(exchange, 405, Json.obj("error", "Метод не поддерживается"));
      return;
    }
    String requested = exchange.getRequestURI().getPath();
    Path path = dist.resolve(requested.replaceFirst("^/+", "")).normalize();
    if (!path.startsWith(dist)) {
      notFound(exchange, "Файл не найден");
      return;
    }
    if (!Files.isRegularFile(path) && !path.getFileName().toString().contains("."))
      path = dist.resolve("index.html");
    if (!Files.isRegularFile(path) || !path.toRealPath().startsWith(dist.toRealPath())) {
      notFound(exchange, "Интерфейс не собран. Выполните npm run build либо запустите Vite.");
      return;
    }
    String name = path.getFileName().toString(),
        extension = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1) : "";
    String mime =
        switch (extension) {
          case "html" -> "text/html; charset=utf-8";
          case "js" -> "text/javascript; charset=utf-8";
          case "css" -> "text/css; charset=utf-8";
          case "json" -> "application/json; charset=utf-8";
          case "svg" -> "image/svg+xml";
          case "png" -> "image/png";
          case "jpg", "jpeg" -> "image/jpeg";
          case "woff2" -> "font/woff2";
          default -> "application/octet-stream";
        };
    exchange.getResponseHeaders().set("Content-Type", mime);
    exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
    exchange
        .getResponseHeaders()
        .set("Cache-Control", extension.equals("html") ? "no-cache" : "public, max-age=3600");
    exchange.sendResponseHeaders(
        200, exchange.getRequestMethod().equals("HEAD") ? -1 : Files.size(path));
    if (!exchange.getRequestMethod().equals("HEAD")) Files.copy(path, exchange.getResponseBody());
  }

  @Override
  public void close() {
    server.stop(0);
    executor.close();
  }
}
