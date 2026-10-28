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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import ru.opodoydet.application.ProviderSettings;
import ru.opodoydet.application.ProviderSelection;
import ru.opodoydet.application.StructuredModel;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;
import ru.opodoydet.shared.Json;

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
  private final StructuredModel selected;
  private final boolean rulesOnly;
  private final ProviderSelection providers;

  @Autowired
  public LlmClient(ProviderSelection providers, ObjectMapper json) {
    this("", "", "", json, null, providers);
  }

  public LlmClient(RuntimeEnv env, ObjectMapper json) {
    this(env.get("LLM_BASE_URL", "https://api.openai.com/v1"), env.get("LLM_API_KEY", ""),
        env.get("LLM_MODEL", ""), json, ProviderSettings.from(env.values()));
  }

  public LlmClient(
      String baseUrl,
      String apiKey,
      String model,
      ObjectMapper json) {
    this(baseUrl, apiKey, model, json, null);
  }

  private LlmClient(String baseUrl, String apiKey, String model, ObjectMapper json, ProviderSettings provider) {
    this(baseUrl, apiKey, model, json, provider, null);
  }

  private LlmClient(String baseUrl, String apiKey, String model, ObjectMapper json,
      ProviderSettings provider, ProviderSelection providers) {
    this.providers = providers;
    this.baseUrl = baseUrl.replaceAll("/+$", "");
    this.apiKey = apiKey;
    boolean explicitModel = provider != null && java.util.Set.of("local", "deepseek").contains(provider.provider());
    this.model = explicitModel ? provider.model() : model;
    this.selected = explicitModel ? provider.structured() : null;
    this.rulesOnly = provider != null && (provider.provider().equals("rules") || (explicitModel && selected == null));
    this.json = json;
    this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
  }

  public boolean enabled() {
    if (providers != null) return currentClient().enabled();
    return !rulesOnly && (selected != null || (!apiKey.isBlank() && !model.isBlank()));
  }

  public String model() {
    if (providers != null) return currentClient().model();
    return model;
  }

  /** Один запрос с ответом в JSON. Пустой результат — сеть, лимиты или невалидный JSON. */
  public Optional<JsonNode> completeJson(String system, String user) {
    return completeJson(system, user, Json.obj("type", "object"));
  }

  public Optional<JsonNode> completeJson(String system, String user, JsonNode schema) {
    if (providers != null) return currentClient().completeJson(system, user, schema);
    if (!enabled()) return Optional.empty();
    if (selected != null) {
      try {
        return Optional.of(selected.complete(system, Json.obj("text", user), schema));
      } catch (IOException | IllegalArgumentException unavailable) {
        log.warn("Модель недоступна или ответ не прошёл проверку; использован разбор по правилам.");
        return Optional.empty();
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
        return Optional.empty();
      }
    }
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
        log.warn("LLM ответила HTTP {}", response.statusCode());
        return Optional.empty();
      }
      String content =
          json.readTree(response.body()).path("choices").path(0).path("message").path("content").asText("");
      return Optional.of(json.readTree(content));
    } catch (IOException e) {
      log.warn("LLM недоступна или вернула не JSON.");
      return Optional.empty();
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return Optional.empty();
    }
  }

  private LlmClient currentClient() {
    return new LlmClient(new RuntimeEnv(providers.environment()), json);
  }

}
