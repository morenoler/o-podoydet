package ru.opodoydet.config;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.EnumerablePropertySource;
import org.springframework.stereotype.Component;

/** Existing deployment keys are resolved through Spring's ordered property sources. */
@Component
public final class AppSettings {
  private final ConfigurableEnvironment environment;

  public AppSettings(ConfigurableEnvironment environment) {
    this.environment = environment;
  }

  public String get(String key, String fallback) {
    return environment.getProperty(key, fallback);
  }

  public boolean enabled(String key, boolean fallback) {
    return Boolean.parseBoolean(get(key, Boolean.toString(fallback)));
  }

  public Path path(String key, String fallback) {
    return Path.of(get(key, fallback));
  }

  public Map<String, String> values() {
    Map<String, String> values = new LinkedHashMap<>();
    for (var source : environment.getPropertySources()) {
      if (source instanceof EnumerablePropertySource<?> enumerable)
        for (String key : enumerable.getPropertyNames())
          if (key.matches("[A-Z][A-Z0-9_]*")) values.put(key, environment.getProperty(key, ""));
    }
    return Map.copyOf(values);
  }
}
