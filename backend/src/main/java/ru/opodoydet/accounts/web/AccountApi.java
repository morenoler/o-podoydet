package ru.opodoydet.accounts.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.sql.SQLException;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.auth.AuthService;
import ru.opodoydet.accounts.bookings.BookingService;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.accounts.photos.PhotoService;
import ru.opodoydet.accounts.questions.QuestionService;
import ru.opodoydet.accounts.clarifications.ClarificationService;
import ru.opodoydet.accounts.search.OwnerListingSearchProvider;
import ru.opodoydet.application.SearchExtension;
import ru.opodoydet.shared.Json;

/** HTTP adapter; each feature owns its validation, authorization and persistence. */
public final class AccountApi implements AutoCloseable {
  private final AccountDatabase db;
  private final AuthService auth;
  private final ListingService listings;
  private final BookingService bookings;
  private final QuestionService questions;
  private final ClarificationService clarifications;
  private final PhotoService photos;

  public AccountApi(String path, boolean secureCookie, Path uploads)
      throws SQLException, IOException {
    db = new AccountDatabase(path);
    auth = new AuthService(db, secureCookie);
    listings = new ListingService(db);
    bookings = new BookingService(db, listings);
    questions = new QuestionService(db, listings);
    clarifications = new ClarificationService(db, listings);
    photos = new PhotoService(db, uploads);
  }

  public SearchExtension searchExtension() {
    return new OwnerListingSearchProvider(db);
  }

  /** Narrow identity boundary for private advisor runs; never exposes account details. */
  public String currentUserId(HttpExchange exchange) throws SQLException {
    JsonNode user = auth.current(exchange);
    return user == null ? null : Json.str(user, "id");
  }

  public boolean handle(HttpExchange exchange) throws IOException, SQLException {
    String path = exchange.getRequestURI().getPath();
    if (!(path.startsWith("/api/auth/")
        || path.startsWith("/api/account/")
        || path.startsWith("/api/host/")
        || path.equals("/api/listings")
        || path.startsWith("/api/listings/"))) return false;
    try {
      if (path.equals("/api/host/photos") && exchange.getRequestMethod().equals("POST")) {
        send(
            exchange, 201, photos.upload(exchange, Json.str(auth.require(exchange, "host"), "id")));
        return true;
      }
      if (exchange.getRequestMethod().equals("POST")) {
        String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
        if (contentType == null
            || !contentType.split(";", 2)[0].trim().equalsIgnoreCase("application/json"))
          throw new AccountProblem(415, "Используйте формат application/json.");
      }
      route(exchange, path, exchange.getRequestMethod());
    } catch (AccountProblem problem) {
      send(exchange, problem.status, Json.obj("error", problem.getMessage()));
    }
    return true;
  }

  public void asset(HttpExchange exchange) throws IOException, SQLException {
    try {
      photos.serve(exchange, auth.current(exchange));
    } catch (AccountProblem problem) {
      send(exchange, problem.status, Json.obj("error", problem.getMessage()));
    }
  }

  private void route(HttpExchange ex, String path, String method) throws SQLException, IOException {
    if (path.startsWith("/api/auth/")) {
      if (method.equals("GET") && path.equals("/api/auth/me")) {
        send(ex, 200, Json.obj("user", auth.current(ex)));
        return;
      }
      if (method.equals("POST")) {
        JsonNode body = body(ex);
        if (path.equals("/api/auth/register")) {
          send(ex, 201, Json.obj("user", auth.register(ex, body)));
          return;
        }
        if (path.equals("/api/auth/login")) {
          send(ex, 200, Json.obj("user", auth.login(ex, body)));
          return;
        }
        if (path.equals("/api/auth/logout")) {
          auth.logout(ex);
          send(ex, 200, Json.obj("ok", true));
          return;
        }
      }
    }
    if (path.equals("/api/account/profile") && method.equals("POST")) {
      send(ex, 200, Json.obj("user", auth.profile(auth.require(ex, null), body(ex))));
      return;
    }
    String[] parts = path.split("/");
    if (path.startsWith("/api/account/")) {
      String user = Json.str(auth.require(ex, "user"), "id");
      if (method.equals("GET") && path.equals("/api/account/bookings")) {
        send(ex, 200, bookings.user(user));
        return;
      }
      if (method.equals("GET") && path.equals("/api/account/questions")) {
        send(ex, 200, questions.user(user));
        return;
      }
      if (method.equals("GET") && path.equals("/api/account/clarifications")) {
        send(ex, 200, clarifications.user(user));
        return;
      }
      if (method.equals("POST")
          && parts.length == 6
          && parts[3].equals("bookings")
          && parts[5].equals("cancel")) {
        body(ex);
        send(ex, 200, bookings.cancel(user, parts[4]));
        return;
      }
    }
    if (path.startsWith("/api/host/")) {
      String host = Json.str(auth.require(ex, "host"), "id");
      if (path.equals("/api/host/listings")) {
        if (method.equals("GET")) {
          send(ex, 200, listings.owned(host));
          return;
        }
        if (method.equals("POST")) {
          send(ex, 201, listings.create(host, body(ex)));
          return;
        }
      }
      if (parts.length == 5 && parts[3].equals("listings")) {
        if (method.equals("GET")) {
          send(ex, 200, listings.owned(parts[4], host));
          return;
        }
        if (method.equals("POST")) {
          send(ex, 200, listings.update(host, parts[4], body(ex)));
          return;
        }
      }
      if (method.equals("GET") && path.equals("/api/host/bookings")) {
        send(ex, 200, bookings.host(host));
        return;
      }
      if (method.equals("GET") && path.equals("/api/host/questions")) {
        send(ex, 200, questions.host(host));
        return;
      }
      if (method.equals("GET") && path.equals("/api/host/clarifications")) {
        send(ex, 200, clarifications.host(host));
        return;
      }
      if (method.equals("POST") && parts.length == 6) {
        if (parts[3].equals("clarifications") && parts[5].equals("answers")) {
          send(ex, 200, clarifications.answer(host, parts[4], body(ex)));
          return;
        }
        if (parts[3].equals("questions") && parts[5].equals("answer")) {
          send(ex, 200, questions.answer(host, parts[4], body(ex)));
          return;
        }
        if (parts[3].equals("bookings") && parts[5].equals("status")) {
          send(ex, 200, bookings.status(host, parts[4], body(ex)));
          return;
        }
      }
    }
    if (path.equals("/api/listings") && method.equals("GET")) {
      send(ex, 200, listings.published());
      return;
    }
    if (parts.length == 4 && parts[2].equals("listings") && method.equals("GET")) {
      send(ex, 200, listings.published(parts[3]));
      return;
    }
    if (parts.length == 5 && parts[2].equals("listings")) {
      if (parts[4].equals("clarifications") && method.equals("POST")) {
        send(ex, 201, clarifications.ask(Json.str(auth.require(ex, "user"), "id"), parts[3], body(ex)));
        return;
      }
      if (parts[4].equals("questions")) {
        if (method.equals("GET")) {
          send(ex, 200, questions.published(parts[3]));
          return;
        }
        if (method.equals("POST")) {
          send(
              ex, 201, questions.ask(Json.str(auth.require(ex, "user"), "id"), parts[3], body(ex)));
          return;
        }
      }
      if (parts[4].equals("bookings") && method.equals("POST")) {
        send(
            ex,
            201,
            bookings.request(Json.str(auth.require(ex, "user"), "id"), parts[3], body(ex)));
        return;
      }
    }
    throw new AccountProblem(404, "Метод не найден.");
  }

  private static JsonNode body(HttpExchange exchange) throws IOException {
    byte[] bytes = exchange.getRequestBody().readNBytes(24577);
    if (bytes.length > 24576) throw new AccountProblem(413, "Запрос слишком большой.");
    JsonNode data = Json.read(new String(bytes, StandardCharsets.UTF_8));
    if (data == null || !data.isObject()) throw new AccountProblem(400, "Ожидается JSON-объект.");
    return data;
  }

  private static void send(HttpExchange exchange, int status, Object value) throws IOException {
    byte[] bytes = Json.write(value).getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    exchange.getResponseHeaders().set("Cache-Control", "no-store");
    exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
    // A rejected upload can still be in flight. Tell the client not to reuse this connection,
    // and finish the response before the outer handler closes its unread request stream.
    if (status == 413) exchange.getResponseHeaders().set("Connection", "close");
    exchange.sendResponseHeaders(status, bytes.length);
    try (var response = exchange.getResponseBody()) {
      response.write(bytes);
    }
  }

  @Override
  public void close() throws SQLException {
    db.close();
  }
}
