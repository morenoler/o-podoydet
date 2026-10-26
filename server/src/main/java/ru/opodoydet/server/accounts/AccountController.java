package ru.opodoydet.server.accounts;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.auth.AuthService;
import ru.opodoydet.accounts.bookings.BookingService;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.photos.PhotoService;
import ru.opodoydet.accounts.questions.QuestionService;
import ru.opodoydet.accounts.clarifications.ClarificationService;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;
import ru.opodoydet.server.web.JsonResponses;
import ru.opodoydet.shared.Json;

/**
 * Кабинеты путешественника и отельера: вход, профиль, объявления, фото, заявки, вопросы.
 * Перенос старого AccountApi: те же пути, коды ответов и тексты ошибок.
 */
@RestController
public class AccountController {

  private final AuthService auth;
  private final ListingService listings;
  private final BookingService bookings;
  private final QuestionService questions;
  private final PhotoService photos;
  private final ClarificationService clarifications;
  private final boolean enabled;

  AccountController(
      AuthService auth,
      ListingService listings,
      BookingService bookings,
      QuestionService questions,
      PhotoService photos,
      ClarificationService clarifications,
      RuntimeEnv env) {
    this.auth = auth;
    this.listings = listings;
    this.bookings = bookings;
    this.questions = questions;
    this.photos = photos;
    this.clarifications = clarifications;
    this.enabled = env.accountsEnabled();
  }

  @RequestMapping({"/api/auth/**", "/api/account/**", "/api/host/**", "/api/listings", "/api/listings/**"})
  public ResponseEntity<String> handle(HttpServletRequest ex, HttpServletResponse res)
      throws IOException, SQLException {
    if (!enabled) return JsonResponses.send(404, Json.obj("error", "Метод не найден"));
    String path = ex.getRequestURI();
    try {
      if (path.equals("/api/host/photos") && ex.getMethod().equals("POST"))
        return JsonResponses.send(201, photos.upload(ex, Json.str(auth.require(ex, "host"), "id")));
      if (ex.getMethod().equals("POST")) {
        String contentType = ex.getHeader("Content-Type");
        if (contentType == null
            || !contentType.split(";", 2)[0].trim().equalsIgnoreCase("application/json"))
          throw new AccountProblem(415, "Используйте формат application/json.");
      }
      return route(ex, res, path, ex.getMethod());
    } catch (AccountProblem problem) {
      if (problem.status == 413) res.setHeader("Connection", "close");
      return JsonResponses.send(problem.status, Json.obj("error", problem.getMessage()));
    }
  }

  private ResponseEntity<String> route(
      HttpServletRequest ex, HttpServletResponse res, String path, String method)
      throws SQLException, IOException {
    if (path.startsWith("/api/auth/")) {
      if (method.equals("GET") && path.equals("/api/auth/me"))
        return JsonResponses.send(200, Json.obj("user", auth.current(ex)));
      if (method.equals("POST")) {
        JsonNode body = body(ex);
        if (path.equals("/api/auth/register"))
          return JsonResponses.send(201, Json.obj("user", auth.register(ex, res, body)));
        if (path.equals("/api/auth/login"))
          return JsonResponses.send(200, Json.obj("user", auth.login(ex, res, body)));
        if (path.equals("/api/auth/logout")) {
          auth.logout(ex, res);
          return JsonResponses.send(200, Json.obj("ok", true));
        }
      }
    }
    if (path.equals("/api/account/profile") && method.equals("POST"))
      return JsonResponses.send(200, Json.obj("user", auth.profile(auth.require(ex, null), body(ex))));
    String[] parts = path.split("/");
    if (path.startsWith("/api/account/")) {
      String user = Json.str(auth.require(ex, "user"), "id");
      if (method.equals("GET") && path.equals("/api/account/bookings"))
        return JsonResponses.send(200, bookings.user(user));
      if (method.equals("GET") && path.equals("/api/account/clarifications"))
        return JsonResponses.send(200, clarifications.user(user));
      if (method.equals("GET") && path.equals("/api/account/questions"))
        return JsonResponses.send(200, questions.user(user));
      if (method.equals("POST")
          && parts.length == 6
          && parts[3].equals("bookings")
          && parts[5].equals("cancel")) {
        body(ex);
        return JsonResponses.send(200, bookings.cancel(user, parts[4]));
      }
    }
    if (path.startsWith("/api/host/")) {
      String host = Json.str(auth.require(ex, "host"), "id");
      if (path.equals("/api/host/listings")) {
        if (method.equals("GET")) return JsonResponses.send(200, listings.owned(host));
        if (method.equals("POST")) return JsonResponses.send(201, listings.create(host, body(ex)));
      }
      if (parts.length == 5 && parts[3].equals("listings")) {
        if (method.equals("GET")) return JsonResponses.send(200, listings.owned(parts[4], host));
        if (method.equals("POST"))
          return JsonResponses.send(200, listings.update(host, parts[4], body(ex)));
      }
      if (method.equals("GET") && path.equals("/api/host/bookings"))
        return JsonResponses.send(200, bookings.host(host));
      if (method.equals("GET") && path.equals("/api/host/clarifications"))
        return JsonResponses.send(200, clarifications.host(host));
      if (method.equals("GET") && path.equals("/api/host/questions"))
        return JsonResponses.send(200, questions.host(host));
      if (method.equals("POST") && parts.length == 6) {
        if (parts[3].equals("clarifications") && parts[5].equals("answers"))
          return JsonResponses.send(200, clarifications.answer(host, parts[4], body(ex)));
        if (parts[3].equals("questions") && parts[5].equals("answer"))
          return JsonResponses.send(200, questions.answer(host, parts[4], body(ex)));
        if (parts[3].equals("bookings") && parts[5].equals("status"))
          return JsonResponses.send(200, bookings.status(host, parts[4], body(ex)));
      }
    }
    if (path.equals("/api/listings") && method.equals("GET"))
      return JsonResponses.send(200, listings.published());
    if (parts.length == 4 && parts[2].equals("listings") && method.equals("GET"))
      return JsonResponses.send(200, listings.published(parts[3]));
    if (parts.length == 5 && parts[2].equals("listings")) {
      if (parts[4].equals("clarifications") && method.equals("POST"))
        return JsonResponses.send(201, clarifications.ask(Json.str(auth.require(ex, "user"), "id"), parts[3], body(ex)));
      if (parts[4].equals("questions")) {
        if (method.equals("GET")) return JsonResponses.send(200, questions.published(parts[3]));
        if (method.equals("POST"))
          return JsonResponses.send(
              201, questions.ask(Json.str(auth.require(ex, "user"), "id"), parts[3], body(ex)));
      }
      if (parts[4].equals("bookings") && method.equals("POST"))
        return JsonResponses.send(
            201, bookings.request(Json.str(auth.require(ex, "user"), "id"), parts[3], body(ex)));
    }
    throw new AccountProblem(404, "Метод не найден.");
  }

  private static JsonNode body(HttpServletRequest ex) throws IOException {
    byte[] bytes = ex.getInputStream().readNBytes(24577);
    if (bytes.length > 24576) throw new AccountProblem(413, "Запрос слишком большой.");
    JsonNode data;
    try {
      data = Json.read(new String(bytes, StandardCharsets.UTF_8));
    } catch (IllegalArgumentException invalid) {
      throw invalid; // как раньше: некорректный JSON → 400 с текстом ошибки
    }
    if (data == null || !data.isObject()) throw new AccountProblem(400, "Ожидается JSON-объект.");
    return data;
  }
}
