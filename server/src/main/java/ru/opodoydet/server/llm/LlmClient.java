package ru.opodoydet.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import ru.opodoydet.application.LegacyJsonModel;
import ru.opodoydet.application.ProviderSelection;
import ru.opodoydet.application.ProviderSettings;
import ru.opodoydet.application.StructuredModel;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;
import ru.opodoydet.shared.Json;

/** Host extraction adapter; provider transports implement the same StructuredModel interface. */
@Component
public class LlmClient {
  private static final Logger log = LoggerFactory.getLogger(LlmClient.class);
  private record Selected(String model, StructuredModel transport) {}
  private final Supplier<Map<String, String>> environment;
  private final ConcurrentMap<Map<String, String>, Selected> clients = new ConcurrentHashMap<>();

  @Autowired
  public LlmClient(ProviderSelection providers, ObjectMapper json) {
    environment = providers::environment;
  }

  public LlmClient(RuntimeEnv env, ObjectMapper json) {
    environment = env::values;
  }

  /** Legacy constructor retained for callers testing the Chat Completions contract. */
  public LlmClient(String baseUrl, String apiKey, String model, ObjectMapper json) {
    Map<String, String> values = Map.of("LLM_BASE_URL", baseUrl, "LLM_API_KEY", apiKey, "LLM_MODEL", model);
    environment = () -> values;
  }

  private Selected selected() {
    return clients.computeIfAbsent(environment.get(), env -> {
      ProviderSettings settings = ProviderSettings.from(env);
      if (settings.provider().equals("rules")) return new Selected("", null);
      if (!settings.provider().equals("legacy")) return new Selected(settings.model(), settings.structured());
      String model = env.getOrDefault("LLM_MODEL", "");
      String key = env.getOrDefault("LLM_API_KEY", "");
      return new Selected(model, model.isBlank() || key.isBlank() ? null : new LegacyJsonModel(
          env.getOrDefault("LLM_BASE_URL", "https://api.openai.com/v1"), key, model,
          LegacyJsonModel.Protocol.CHAT_COMPLETIONS));
    });
  }

  public boolean enabled() { return selected().transport() != null; }
  public String model() { return selected().model(); }

  public Optional<JsonNode> completeJson(String system, String user) {
    return completeJson(system, user, Json.obj("type", "object"));
  }

  public Optional<JsonNode> completeJson(String system, String user, JsonNode schema) {
    StructuredModel transport = selected().transport();
    if (transport == null) return Optional.empty();
    try {
      JsonNode input = transport instanceof LegacyJsonModel
          ? com.fasterxml.jackson.databind.node.TextNode.valueOf(user) : Json.obj("text", user);
      return Optional.of(transport.complete(system, input, schema));
    } catch (IOException | IllegalArgumentException unavailable) {
      log.warn("Модель недоступна или ответ не прошёл проверку; использован разбор по правилам.");
      return Optional.empty();
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      return Optional.empty();
    }
  }
}
