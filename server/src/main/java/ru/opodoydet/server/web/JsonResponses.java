package ru.opodoydet.server.web;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import ru.opodoydet.shared.Json;

/** Ответы в том же виде, что у старого API: JSON, no-store, nosniff. */
public final class JsonResponses {

  private JsonResponses() {}

  public static ResponseEntity<String> send(int status, Object body) {
    return ResponseEntity.status(status)
        .header(HttpHeaders.CONTENT_TYPE, "application/json; charset=utf-8")
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Json.write(body));
  }

  public static ResponseEntity<String> notFound(String message) {
    return send(404, Json.obj("error", message));
  }
}
