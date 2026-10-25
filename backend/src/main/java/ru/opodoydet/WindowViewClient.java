package ru.opodoydet;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.DeserializationFeature;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Transport for the separate geometry service. Never infers a floor or room orientation. */
final class WindowViewClient implements AutoCloseable {
  static final int MAX_REQUEST_BYTES = 32 * 1024;
  private static final int MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
  private static final Set<Integer> EXPECTED_ERRORS = Set.of(400, 403, 413, 415, 422, 429, 502, 503);
  private final URI endpoint;
  private final Duration timeout;
  private final int responseLimit;
  private final HttpClient client;

  record Result(int status, JsonNode body) {}

  static WindowViewClient from(Map<String, String> environment) {
    return new WindowViewClient(
        environment.getOrDefault("WINDOW_VIEW_URL", "http://127.0.0.1:8011"),
        Duration.ofSeconds(120),
        MAX_RESPONSE_BYTES);
  }

  WindowViewClient(String origin, Duration timeout, int responseLimit) {
    URI base = URI.create(origin);
    if (!("http".equals(base.getScheme()) || "https".equals(base.getScheme()))
        || base.getHost() == null
        || base.getRawUserInfo() != null
        || base.getRawQuery() != null
        || base.getRawFragment() != null
        || !(base.getPath().isEmpty() || base.getPath().equals("/")))
      throw new IllegalArgumentException(
          "WINDOW_VIEW_URL должен быть HTTP(S) origin без пути и пароля");
    if (timeout.isZero() || timeout.isNegative() || responseLimit < 1)
      throw new IllegalArgumentException("Некорректные ограничения сервиса вида из окна");
    this.endpoint = base.resolve("/v1/views/estimate");
    this.timeout = timeout;
    this.responseLimit = responseLimit;
    this.client =
        HttpClient.newBuilder()
            .connectTimeout(
                timeout.compareTo(Duration.ofSeconds(5)) < 0 ? timeout : Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
  }

  Result estimate(JsonNode input) {
    if (input == null || !input.isObject())
      throw new IllegalArgumentException("Ожидается JSON-объект");
    JsonNode floor = input.path("floor"), ground = input.path("ground_floor_number");
    double minimum = ground.isMissingNode() ? 1 : ground.asDouble(Double.NaN);
    if ((!ground.isMissingNode() && !ground.isNumber()) || (minimum != 0 && minimum != 1))
      throw new IllegalArgumentException("ground_floor_number должен быть 0 или 1");
    if (!floor.isNumber()
        || !Double.isFinite(floor.asDouble())
        || floor.asDouble() != Math.rint(floor.asDouble())
        || floor.asDouble() < minimum
        || floor.asDouble() > 100)
      throw new IllegalArgumentException("Укажите floor: целый этаж от ground_floor_number до 100");
    byte[] payload = Json.write(input).getBytes(StandardCharsets.UTF_8);
    if (payload.length > MAX_REQUEST_BYTES)
      return error(413, "request_too_large", "Максимальный размер запроса — 32 KiB");
    HttpRequest request =
        HttpRequest.newBuilder(endpoint)
            .timeout(timeout)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
            .build();
    CompletableFuture<HttpResponse<byte[]>> pending =
        client.sendAsync(request, ignored -> new LimitedBody(responseLimit));
    try {
      // This deadline includes streaming the entire response, not only receiving headers.
      HttpResponse<byte[]> response = pending.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
      String type = response.headers().firstValue("Content-Type").orElse("");
      if (!type.split(";", 2)[0].trim().toLowerCase(Locale.ROOT).equals("application/json"))
        return invalidResponse();
      JsonNode output;
      try {
        output =
            Json.MAPPER.reader()
                .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .readTree(response.body());
      } catch (IOException invalid) {
        return invalidResponse();
      }
      if (output == null || !output.isObject()) return invalidResponse();
      if (EXPECTED_ERRORS.contains(response.statusCode()) && output.path("error").isTextual())
        return new Result(response.statusCode(), output);
      if (response.statusCode() != 200
          || !output.path("schema_version").isTextual()
          || !output.path("schema_version").asText().equals("1.0")
          || !output.path("actual_visibility_confirmed").isBoolean()
          || output.path("actual_visibility_confirmed").asBoolean()
          || !output.path("is_demo").isBoolean()
          || !output.path("room_resolution").isObject()
          || !output.path("assessments").isArray()
          || !output.path("sources").isArray()
          || !output.path("limitations").isArray())
        return invalidResponse();
      return new Result(200, output);
    } catch (TimeoutException timeoutError) {
      pending.cancel(true);
      return error(504, "window_view_timeout", "Сервис вида из окна не ответил за отведённое время");
    } catch (InterruptedException interrupted) {
      pending.cancel(true);
      Thread.currentThread().interrupt();
      return error(503, "window_view_interrupted", "Расчёт прерван");
    } catch (ExecutionException failed) {
      Throwable cause = failed.getCause();
      if (cause instanceof java.net.http.HttpTimeoutException)
        return error(504, "window_view_timeout", "Сервис вида из окна не ответил за отведённое время");
      if (cause instanceof ResponseTooLarge) return invalidResponse();
      return error(503, "window_view_unavailable", "Сервис вида из окна недоступен");
    }
  }

  private static Result invalidResponse() {
    return error(502, "invalid_window_view_response", "Сервис вида из окна вернул некорректный ответ");
  }

  private static Result error(int status, String code, String detail) {
    return new Result(status, Json.obj("error", code, "detail", detail));
  }

  @Override
  public void close() {
    client.shutdownNow();
  }

  private static final class ResponseTooLarge extends IOException {}

  /** Bound memory even for a chunked upstream response without Content-Length. */
  private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
    private final int limit;
    private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    private final CompletableFuture<byte[]> complete = new CompletableFuture<>();
    private Flow.Subscription subscription;

    LimitedBody(int limit) {
      this.limit = limit;
    }

    @Override
    public CompletionStage<byte[]> getBody() {
      return complete;
    }

    @Override
    public void onSubscribe(Flow.Subscription subscription) {
      this.subscription = subscription;
      subscription.request(1);
    }

    @Override
    public void onNext(List<ByteBuffer> buffers) {
      for (ByteBuffer buffer : buffers) {
        if (buffer.remaining() > limit - bytes.size()) {
          subscription.cancel();
          complete.completeExceptionally(new ResponseTooLarge());
          return;
        }
        byte[] next = new byte[buffer.remaining()];
        buffer.get(next);
        bytes.writeBytes(next);
      }
      subscription.request(1);
    }

    @Override
    public void onError(Throwable error) {
      complete.completeExceptionally(error);
    }

    @Override
    public void onComplete() {
      complete.complete(bytes.toByteArray());
    }
  }
}
