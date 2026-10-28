package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.SocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import ru.opodoydet.shared.Json;

/** Native Ollama JSON-schema protocol shared by local interpretation paths, never remote. */
public final class LocalJsonModel implements StructuredModel {
  public static final Duration TIMEOUT = Duration.ofSeconds(10);
  private static final int MAX_RESPONSE_BYTES = 100_000;
  private final URI endpoint;
  private final String model;
  private final Duration timeout;
  private final HttpClient http;

  public static boolean loopback(String url) {
    try {
      URI base = URI.create(url);
      return Set.of("http", "https").contains(base.getScheme())
          && Set.of("localhost", "127.0.0.1", "[::1]", "::1").contains(base.getHost())
          && base.getUserInfo() == null && base.getQuery() == null && base.getFragment() == null;
    } catch (Exception invalid) { return false; }
  }

  public LocalJsonModel(String baseUrl, String model) { this(baseUrl, model, TIMEOUT); }

  LocalJsonModel(String baseUrl, String model, Duration timeout) {
    if (!loopback(baseUrl) || model.isBlank() || model.toLowerCase(Locale.ROOT).contains("cloud"))
      throw new IllegalArgumentException("Локальная модель должна работать по loopback-адресу.");
    this.endpoint = URI.create(baseUrl).resolve("/api/chat");
    this.model = model;
    this.timeout = timeout;
    this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
        .followRedirects(HttpClient.Redirect.NEVER)
        .proxy(new ProxySelector() {
          public List<Proxy> select(URI uri) { return List.of(Proxy.NO_PROXY); }
          public void connectFailed(URI uri, SocketAddress address, IOException error) {}
        }).build();
  }

  public JsonNode complete(String instructions, JsonNode input, JsonNode schema) throws IOException, InterruptedException {
    // Do not let a custom localhost resolver send private input outside the machine.
    for (InetAddress address : InetAddress.getAllByName(endpoint.getHost()))
      if (!address.isLoopbackAddress()) throw new IOException("Local model address is not loopback");
    String content = Json.write(input);
    if (content.length() > 24_000) throw new IOException("Local model input too large");
    JsonNode body = Json.obj("model", model, "stream", false, "format", schema,
        "options", Json.obj("temperature", 0, "num_predict", 500), "keep_alive", "10m",
        "messages", List.of(Json.obj("role", "system", "content", instructions), Json.obj("role", "user", "content", content)));
    HttpRequest request = HttpRequest.newBuilder(endpoint).timeout(timeout)
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(Json.write(body))).build();
    var pending = http.sendAsync(request, ignored -> new LimitedBody());
    try {
      // Covers the entire response, including a stalled or oversized chunked body.
      HttpResponse<byte[]> response = pending.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
      if (response.statusCode() != 200) throw new IOException("Local model HTTP " + response.statusCode());
      JsonNode result = Json.read(new String(response.body(), StandardCharsets.UTF_8));
      if (!result.path("done").asBoolean() || !Json.str(result, "done_reason").equals("stop"))
        throw new IOException("Local model incomplete response");
      JsonNode parsed = Json.read(Json.str(result.path("message"), "content"));
      if (parsed == null || !parsed.isObject()) throw new IOException("Local model did not return an object");
      return parsed;
    } catch (TimeoutException timedOut) {
      pending.cancel(true);
      throw new IOException("Local model timeout");
    } catch (ExecutionException failed) {
      throw new IOException("Local model unavailable", failed.getCause());
    } catch (InterruptedException interrupted) {
      pending.cancel(true);
      throw interrupted;
    }
  }

  private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
    private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    private final CompletableFuture<byte[]> complete = new CompletableFuture<>();
    private Flow.Subscription subscription;
    public CompletionStage<byte[]> getBody() { return complete; }
    public void onSubscribe(Flow.Subscription subscription) { this.subscription = subscription; subscription.request(1); }
    public void onNext(List<ByteBuffer> buffers) {
      for (ByteBuffer buffer : buffers) {
        if (buffer.remaining() > MAX_RESPONSE_BYTES - bytes.size()) {
          subscription.cancel(); complete.completeExceptionally(new IOException("Local model response too large")); return;
        }
        byte[] next = new byte[buffer.remaining()]; buffer.get(next); bytes.writeBytes(next);
      }
      subscription.request(1);
    }
    public void onError(Throwable error) { complete.completeExceptionally(error); }
    public void onComplete() { complete.complete(bytes.toByteArray()); }
  }
}
