package ru.opodoydet.web;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.JsonNode;

/** Bounded JSON reads apply equally to fixed-length and chunked request bodies. */
public final class RequestBodies {
  private static final int MAX_BYTES = 24 * 1024;

  private RequestBodies() {}

  public static JsonNode json(HttpServletRequest request) throws IOException {
    return json(request, 400);
  }

  public static JsonNode json(HttpServletRequest request, int oversizedStatus) throws IOException {
    byte[] bytes = request.getInputStream().readNBytes(MAX_BYTES + 1);
    if (bytes.length > MAX_BYTES) throw new ApiProblem(oversizedStatus, "Запрос слишком большой.");
    JsonNode value = Json.read(new String(bytes, StandardCharsets.UTF_8));
    if (value == null || !value.isObject()) throw new ApiProblem(400, "Ожидается JSON-объект.");
    return value;
  }
}
