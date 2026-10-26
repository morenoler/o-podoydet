package ru.opodoydet.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/** Keep direct java -jar launches compatible with the existing local .env file. */
public class DotenvEnvironmentPostProcessor implements EnvironmentPostProcessor {
  @Override
  public void postProcessEnvironment(
      ConfigurableEnvironment environment, SpringApplication application) {
    if (!environment.getProperty("app.dotenv.enabled", Boolean.class, true)) return;
    Path file = Path.of(".env");
    if (!Files.isRegularFile(file)) return;
    Map<String, Object> values = new LinkedHashMap<>();
    try {
      for (String line : Files.readAllLines(file)) {
        String entry = line.trim();
        if (entry.isEmpty() || entry.startsWith("#")) continue;
        int equals = entry.indexOf('=');
        if (equals < 1) continue;
        String value = entry.substring(equals + 1).trim();
        if (value.length() > 1
            && ((value.startsWith("\"") && value.endsWith("\""))
                || (value.startsWith("'") && value.endsWith("'"))))
          value = value.substring(1, value.length() - 1);
        values.put(entry.substring(0, equals).trim(), value);
      }
    } catch (IOException error) {
      throw new IllegalStateException("Не удалось прочитать настройки .env", error);
    }
    environment.getPropertySources().addLast(new MapPropertySource("localDotenv", values));
  }
}
