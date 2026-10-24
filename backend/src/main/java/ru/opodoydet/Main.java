package ru.opodoydet;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

public final class Main {
  private Main() {}

  public static void main(String[] arguments) throws Exception {
    Map<String, String> env = configuration();
    Path data = Path.of(env.getOrDefault("DATA_PATH", "data/verified-hotels.json"));
    JsonNode dataset = Json.MAPPER.readTree(data.toFile());
    if (!Json.str(dataset, "region").equals("Пусан"))
      throw new IllegalArgumentException(
          "Ожидается набор данных Пусана. Выполните npm run data:prepare после загрузки данных"
              + " региона.");
    String database = env.getOrDefault("DB_PATH", ".local/busan.sqlite3");
    if (Path.of(database)
        .toAbsolutePath()
        .normalize()
        .equals(Path.of(".local/app.sqlite").toAbsolutePath().normalize()))
      throw new IllegalArgumentException(
          "Используйте новую SQLite 3 базу Пусана, например .local/busan.sqlite3. Старая база"
              + " Адлера не мигрируется автоматически.");
    Store store = new Store(database, dataset);
    Api api =
        new Api(
            store,
            new Agents(Agents.Config.from(env)),
            Path.of(env.getOrDefault("DIST_PATH", "dist")),
            Path.of(env.getOrDefault("AREA_DATA_PATH", "data/area-assessments.json")),
            Path.of(env.getOrDefault("NOISE_DATA_PATH", "data/noise-context.json")),
            Path.of(env.getOrDefault("TRAFFIC_DATA_PATH", "data/traffic-ktdb-2024.json")),
            env.getOrDefault("FRONTEND_ORIGIN", ""),
            Integer.parseInt(env.getOrDefault("PORT", "8080")));
    Runtime.getRuntime()
        .addShutdownHook(
            new Thread(
                () -> {
                  api.close();
                  try {
                    store.close();
                  } catch (Exception ignored) {
                  }
                }));
    api.start();
    System.out.println("О!Подойдёт · Java 21 / SQLite 3 · http://127.0.0.1:" + api.port());
  }

  private static Map<String, String> configuration() throws Exception {
    Map<String, String> result = new HashMap<>();
    Path file = Path.of(".env");
    if (Files.isRegularFile(file))
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
        result.put(entry.substring(0, equals).trim(), value);
      }
    result.putAll(System.getenv());
    return result;
  }
}
