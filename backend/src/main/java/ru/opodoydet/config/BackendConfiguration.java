package ru.opodoydet.config;

import java.io.IOException;
import java.nio.file.Path;
import java.sql.SQLException;
import java.time.Clock;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import ru.opodoydet.advisor.AdvisorService;
import ru.opodoydet.application.Agents;
import ru.opodoydet.application.Environment;
import ru.opodoydet.application.SearchExtension;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;

@Configuration(proxyBeanMethods = false)
public class BackendConfiguration {
  @Bean(destroyMethod = "close")
  @ConditionalOnMissingBean
  Store store(AppSettings settings) throws IOException, SQLException {
    var dataset =
        Json.MAPPER.readTree(settings.path("DATA_PATH", "data/verified-hotels.json").toFile());
    if (!Json.str(dataset, "region").equals("Пусан"))
      throw new IllegalArgumentException(
          "Ожидается набор данных Пусана. Выполните npm run data:prepare.");
    String database = settings.get("DB_PATH", ".local/busan.sqlite3");
    if (Path.of(database)
        .toAbsolutePath()
        .normalize()
        .equals(Path.of(".local/app.sqlite").toAbsolutePath().normalize()))
      throw new IllegalArgumentException(
          "Используйте новую SQLite 3 базу Пусана. Старая база Адлера не мигрируется"
              + " автоматически.");
    return new Store(database, dataset);
  }

  @Bean
  @ConditionalOnMissingBean
  Agents agents(AppSettings settings) {
    return new Agents(Agents.Config.from(settings.values()));
  }

  @Bean
  Environment searchEnvironment(AppSettings settings) {
    return new Environment(
        settings.path("AREA_DATA_PATH", "data/area-assessments.json"),
        settings.path("NOISE_DATA_PATH", "data/noise-context.json"),
        settings.path("TRAFFIC_DATA_PATH", "data/traffic-ktdb-2024.json"));
  }

  @Bean
  SearchService searchService(
      Store store,
      Agents agents,
      Environment environment,
      ObjectProvider<SearchExtension> extension) {
    return new SearchService(
        store, agents, environment, Clock.systemUTC(), extension.getIfAvailable());
  }

  @Bean(destroyMethod = "close")
  AdvisorService advisorService(Store store, SearchService search, AppSettings settings)
      throws SQLException {
    return new AdvisorService(store, search, settings.values());
  }
}
