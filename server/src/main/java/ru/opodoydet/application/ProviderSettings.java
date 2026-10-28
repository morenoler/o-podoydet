package ru.opodoydet.application;

import java.net.URI;
import java.util.Map;
import java.util.Set;

/** One explicit selector for all Java and Python model paths. Never log secrets. */
public record ProviderSettings(String provider, String key, String model, String baseUrl,
                               int timeoutSeconds, int maxTokens) {
  public ProviderSettings {
    if (!Set.of("legacy", "rules", "local", "deepseek").contains(provider))
      throw new IllegalArgumentException("AI_PROVIDER: допустимы rules, local, deepseek или пустое значение.");
    if (provider.equals("deepseek")) {
      if (key == null || key.isEmpty() || key.length() > 4096 || !key.matches("[!-~]+"))
        throw new IllegalArgumentException("Задайте корректный DEEPSEEK_API_KEY на сервере.");
      if (model == null || !model.matches("[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}"))
        throw new IllegalArgumentException("Некорректное имя DEEPSEEK_MODEL.");
      if (timeoutSeconds < 1 || timeoutSeconds > 180 || maxTokens < 1 || maxTokens > 4096)
        throw new IllegalArgumentException("Некорректные лимиты DEEPSEEK_TIMEOUT_SECONDS / DEEPSEEK_MAX_TOKENS.");
      validateEndpoint(baseUrl);
    }
  }

  public static ProviderSettings from(Map<String, String> env) {
    String provider = env.getOrDefault("AI_PROVIDER", "").strip();
    if (provider.isEmpty()) provider = "legacy";
    if (provider.equals("deepseek")) {
      try {
        return new ProviderSettings(provider, env.getOrDefault("DEEPSEEK_API_KEY", "").strip(),
            env.getOrDefault("DEEPSEEK_MODEL", "deepseek-flash").strip(),
            env.getOrDefault("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip().replaceAll("/+$", ""),
            Integer.parseInt(env.getOrDefault("DEEPSEEK_TIMEOUT_SECONDS", "60")),
            Integer.parseInt(env.getOrDefault("DEEPSEEK_MAX_TOKENS", "1200")));
      } catch (NumberFormatException invalid) {
        throw new IllegalArgumentException("Лимиты DEEPSEEK_* должны быть целыми числами.");
      }
    }
    return new ProviderSettings(provider, "", env.getOrDefault("ADVISOR_LOCAL_MODEL", "").strip(),
        env.getOrDefault("ADVISOR_LOCAL_BASE_URL", "http://127.0.0.1:11434/v1"), 15, 1200);
  }

  private static void validateEndpoint(String base) {
    try {
      URI uri = URI.create(base);
      boolean official = "https".equals(uri.getScheme()) && "api.deepseek.com".equals(uri.getHost())
          && (uri.getPort() == -1 || uri.getPort() == 443);
      boolean fixture = "http".equals(uri.getScheme())
          && Set.of("127.0.0.1", "[::1]", "::1").contains(uri.getHost());
      if ((!official && !fixture) || uri.getUserInfo() != null || uri.getQuery() != null
          || uri.getFragment() != null || !Set.of("", "/v1").contains(uri.getPath()))
        throw new IllegalArgumentException();
    } catch (RuntimeException invalid) {
      throw new IllegalArgumentException("DEEPSEEK_BASE_URL: нужен официальный HTTPS API или loopback HTTP для тестов.");
    }
  }

  public StructuredModel structured() {
    if (provider.equals("deepseek")) return new DeepSeekJsonModel(this);
    if (provider.equals("rules") || model.isBlank()) return null;
    return new LocalJsonModel(baseUrl, model);
  }

  @Override public String toString() { return "ProviderSettings[provider=" + provider + ", model=" + model + "]"; }
}
