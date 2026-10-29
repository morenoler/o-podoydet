package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
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
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import ru.opodoydet.shared.Json;

/** Compatibility transport for LLM_*; all domain callers use StructuredModel. */
public final class LegacyJsonModel implements StructuredModel {
  public enum Protocol { RESPONSES, CHAT_COMPLETIONS }
  private final String baseUrl, key, model;
  private final Protocol protocol;
  private final HttpClient http = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();

  public LegacyJsonModel(String baseUrl, String key, String model, Protocol protocol) {
    this.baseUrl = baseUrl.replaceAll("/+$", "");
    this.key = key;
    this.model = model;
    this.protocol = protocol;
  }

  @Override public JsonNode complete(String instructions, JsonNode input, JsonNode schema)
      throws IOException, InterruptedException {
    return completeNamed("structured_result", instructions, input, schema);
  }

  @Override public JsonNode completeNamed(String name, String instructions, JsonNode input, JsonNode schema)
      throws IOException, InterruptedException {
    if (Json.write(input).length() > 24_000) throw new IOException("Model input too large");
    boolean responses = protocol == Protocol.RESPONSES;
    JsonNode body = responses
        ? Json.obj("model", model, "store", false, "instructions", instructions,
            "input", Json.write(input), "max_output_tokens", 1400,
            "text", Json.obj("format", Json.obj("type", "json_schema", "name", name,
                "strict", true, "schema", schema)))
        : Json.obj("model", model, "temperature", 0, "max_tokens", 1400,
            "response_format", Json.obj("type", "json_object"), "messages", List.of(
                Json.obj("role", "system", "content", instructions),
                Json.obj("role", "user", "content", input.isTextual() ? input.asText() : Json.write(input))));
    HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + (responses ? "/responses" : "/chat/completions")))
        .timeout(Duration.ofSeconds(20)).header("Content-Type", "application/json")
        .header("Authorization", "Bearer " + key)
        .POST(HttpRequest.BodyPublishers.ofString(Json.write(body), StandardCharsets.UTF_8)).build();
    var pending = http.sendAsync(request, ignored -> new LimitedBody());
    try {
      var response = pending.get(20, TimeUnit.SECONDS);
      if (response.statusCode() / 100 != 2) throw new IOException("Model HTTP " + response.statusCode());
      JsonNode result = Json.read(new String(response.body(), StandardCharsets.UTF_8));
      StringBuilder text = new StringBuilder();
      if (responses) {
        if (!Json.str(result, "status").equals("completed")) throw new IOException("Incomplete model response");
        for (JsonNode message : result.path("output"))
          for (JsonNode content : message.path("content"))
            if (Json.str(content, "type").equals("output_text")) text.append(Json.str(content, "text"));
      } else {
        JsonNode choice = result.path("choices").path(0);
        if (choice.hasNonNull("finish_reason") && !Json.str(choice, "finish_reason").equals("stop"))
          throw new IOException("Incomplete model response");
        text.append(Json.str(choice.path("message"), "content"));
      }
      JsonNode parsed = Json.read(text.toString());
      if (parsed == null || !parsed.isObject()) throw new IOException("Model did not return an object");
      return parsed;
    } catch (TimeoutException timeout) {
      pending.cancel(true);
      throw new IOException("Model timeout");
    } catch (ExecutionException failed) {
      throw new IOException("Model unavailable or response exceeds limit");
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
    public void onSubscribe(Flow.Subscription value) { subscription = value; subscription.request(1); }
    public void onNext(List<ByteBuffer> buffers) {
      for (ByteBuffer buffer : buffers) {
        if (buffer.remaining() > 256_000 - bytes.size()) {
          subscription.cancel(); complete.completeExceptionally(new IOException("Model response too large")); return;
        }
        byte[] next = new byte[buffer.remaining()]; buffer.get(next); bytes.writeBytes(next);
      }
      subscription.request(1);
    }
    public void onError(Throwable error) { complete.completeExceptionally(error); }
    public void onComplete() { complete.complete(bytes.toByteArray()); }
  }
}
