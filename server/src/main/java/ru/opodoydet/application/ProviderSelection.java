package ru.opodoydet.application;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import ru.opodoydet.shared.Json;

/** Immutable server configuration with a bounded, non-inheritable request override. */
public final class ProviderSelection {
  private static final List<String> IDS = List.of("rules", "local", "deepseek");
  private final Map<String, String> defaults;
  private final Map<String, Map<String, String>> environments = new LinkedHashMap<>();
  private final Map<String, String> unavailable = new LinkedHashMap<>();
  private final ThreadLocal<String> requested = new ThreadLocal<>();
  private final String defaultProvider;

  public ProviderSelection(Map<String, String> env) {
    defaults = Map.copyOf(env);
    // An invalid explicitly selected server default still fails startup, as before.
    ProviderSettings configured = ProviderSettings.from(defaults);
    defaultProvider = IDS.contains(configured.provider()) ? configured.provider() : "rules";
    for (String id : IDS) {
      Map<String, String> candidate = new LinkedHashMap<>(defaults);
      candidate.put("AI_PROVIDER", id);
      // A local or rules operation must not carry a remote provider's credentials.
      if (!id.equals("deepseek")) candidate.keySet().removeIf(key -> key.startsWith("DEEPSEEK_"));
      candidate.remove("LLM_API_KEY");
      environments.put(id, Map.copyOf(candidate));
      if (id.equals("rules")) continue;
      if (configured.provider().equals("rules")) {
        unavailable.put(id, "Модели отключены на сервере: AI_PROVIDER=rules.");
        continue;
      }
      try {
        ProviderSettings settings = ProviderSettings.from(candidate);
        if (settings.structured() == null) throw new IllegalArgumentException();
      } catch (IllegalArgumentException invalid) {
        unavailable.put(id, id.equals("deepseek")
            ? "Настройте DEEPSEEK_API_KEY и параметры DeepSeek на сервере."
            : "Настройте ADVISOR_LOCAL_MODEL и локальный ADVISOR_LOCAL_BASE_URL на сервере.");
      }
    }
  }

  public boolean available(String id) { return IDS.contains(id) && !unavailable.containsKey(id); }

  public Map<String, String> environmentFor(String id) {
    if (!IDS.contains(id)) throw new IllegalArgumentException("Неизвестная модель. Выберите local, deepseek или rules.");
    if (!available(id)) throw new IllegalArgumentException(unavailable.get(id));
    return environments.get(id);
  }

  /** No override preserves the old independent LLM_* / ADVISOR_LOCAL_* configuration. */
  public Map<String, String> environment() {
    String id = requested.get();
    return id == null ? defaults : environmentFor(id);
  }

  public String currentProvider() {
    String id = requested.get();
    return id == null ? defaultProvider : id;
  }

  public Scope select(String id) {
    if (id != null) environmentFor(id); // Validate before touching the current request.
    String previous = requested.get();
    if (id == null) requested.remove(); else requested.set(id);
    return () -> { if (previous == null) requested.remove(); else requested.set(previous); };
  }

  @FunctionalInterface
  public interface Scope extends AutoCloseable { @Override void close(); }

  public ObjectNode publicConfig() {
    return Json.obj("defaultProvider", defaultProvider, "providers", List.of(
        option("local", "Локальная LLM"), option("deepseek", "DeepSeek"), option("rules", "Без модели")));
  }

  private ObjectNode option(String id, String label) {
    ObjectNode option = Json.obj("id", id, "label", label, "available", available(id));
    if (!available(id)) option.put("reason", unavailable.get(id));
    return option;
  }

  public ObjectNode advisorConfig() {
    List<String> modes = IDS.stream().filter(this::available).toList();
    ObjectNode names = Json.obj();
    for (String mode : modes) names.put(mode,
        mode.equals("rules") ? "" : ProviderSettings.from(environmentFor(mode)).model());
    String current = currentProvider();
    if (!modes.contains(current)) current = "rules";
    return Json.obj("modes", modes, "defaultMode", current, "maxModelCalls", 2,
        "model", names.path(current).asText(), "modelNames", names);
  }
}
