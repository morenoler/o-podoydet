package ru.opodoydet.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Минимальный клиент OpenAI-совместимого API ({@code POST /chat/completions}). Подходит OpenAI,
 * OpenRouter, YandexGPT/GigaChat через совместимые шлюзы и локальная Ollama
 * ({@code LLM_BASE_URL=http://127.0.0.1:11434/v1}).
 *
 * <p>Без ключа и модели клиент выключен — вызывающий код обязан иметь запасной путь без LLM.
 */
@Component
public class LlmClient {

  private static final Logger log = LoggerFactory.getLogger(LlmClient.class);

  private final String baseUrl;
  private final String apiKey;
  private final String model;
  private final ObjectMapper json;
  private final HttpClient http;

  public LlmClient(
      @Value("${LLM_BASE_URL:https://api.openai.com/v1}") String baseUrl,
      @Value("${LLM_API_KEY:}") String apiKey,
      @Value("${LLM_MODEL:}") String model,
      ObjectMapper json) {
    this.baseUrl = baseUrl.replaceAll("/+$", "");
    this.apiKey = apiKey;
    this.model = model;
    this.json = json;
    this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
  }

  public boolean enabled() {
    return !apiKey.isBlank() && !model.isBlank();
  }

  public String model() {
    return model;
  }

  /** Один запрос с ответом в JSON. Пустой результат — сеть, лимиты или невалидный JSON. */
  public Optional<JsonNode> completeJson(String system, String user) {
    if (!enabled()) return Optional.empty();
    ObjectNode body = json.createObjectNode();
    body.put("model", model);
    body.put("temperature", 0);
    body.putObject("response_format").put("type", "json_object");
    var messages = body.putArray("messages");
    messages.addObject().put("role", "system").put("content", system);
    messages.addObject().put("role", "user").put("content", user);
    try {
      HttpResponse<String> response =
          http.send(
              HttpRequest.newBuilder(URI.create(baseUrl + "/chat/completions"))
                  .timeout(Duration.ofSeconds(60))
                  .header("Authorization", "Bearer " + apiKey)
                  .header("Content-Type", "application/json")
                  .POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8))
                  .build(),
              HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      if (response.statusCode() / 100 != 2) {
        log.warn("LLM ответила {}: {}", response.statusCode(), abbreviate(response.body()));
        return Optional.empty();
      }
      String content =
          json.readTree(response.body()).path("choices").path(0).path("message").path("content").asText("");
      return Optional.of(json.readTree(content));
    } catch (IOException e) {
      log.warn("LLM недоступна или вернула не JSON: {}", e.toString());
      return Optional.empty();
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return Optional.empty();
    }
  }

  private static String abbreviate(String text) {
    return text.length() > 300 ? text.substring(0, 300) + "…" : text;
  }
}
