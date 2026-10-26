package ru.opodoydet.server.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.time.Clock;
import java.util.HashMap;
import java.util.Map;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.DependsOn;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.EnumerablePropertySource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;
import ru.opodoydet.accounts.auth.AuthService;
import ru.opodoydet.accounts.bookings.BookingService;
import ru.opodoydet.accounts.clarifications.ClarificationService;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.accounts.photos.PhotoService;
import ru.opodoydet.accounts.questions.QuestionService;
import ru.opodoydet.accounts.search.OwnerListingSearchProvider;
import ru.opodoydet.advisor.AdvisorService;
import ru.opodoydet.application.Agents;
import ru.opodoydet.application.Environment;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.application.WindowViewClient;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.server.catalog.CatalogService;
import ru.opodoydet.server.search.SearchOverlay;

/**
 * Сборка доменных модулей, перенесённых из старого бэкенда: кабинеты, подбор, оценка района,
 * помощник. Сами модули — обычные Java-классы без зависимости от Spring; здесь они получают
 * PostgreSQL, транзакции и настройки.
 */
@Configuration
public class DomainConfig {

  /**
   * Файл .env из текущей папки, поверх — переменные окружения и настройки Spring.
   * Нужны модулям, которые читают их сами (помощник, разбор текста, кабинеты).
   */
  @Bean
  RuntimeEnv runtimeEnv(ConfigurableEnvironment spring) throws IOException {
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
    // Spring command-line and test properties take precedence over .env and process variables.
    for (var source : spring.getPropertySources()) {
      if (source instanceof EnumerablePropertySource<?> enumerable)
        for (String key : enumerable.getPropertyNames()) {
          if (!key.matches("[A-Z][A-Z0-9_]*")) continue;
          String value = spring.getProperty(key);
          if (value != null) result.put(key, value);
        }
    }
    return new RuntimeEnv(Map.copyOf(result));
  }

  public record RuntimeEnv(Map<String, String> values) {
    public String get(String key, String fallback) {
      return values.getOrDefault(key, fallback);
    }

    public boolean accountsEnabled() {
      return !"false".equalsIgnoreCase(values.get("ACCOUNT_MODE"));
    }

    public boolean labMode() {
      return "true".equals(values.get("LAB_MODE"));
    }
  }

  // ---- Кабинеты ----

  @Bean
  AccountDatabase accountDatabase(DataSource dataSource, TransactionTemplate tx) {
    return new AccountDatabase(dataSource, tx);
  }

  @Bean
  AuthService authService(AccountDatabase db, RuntimeEnv env) {
    return new AuthService(db, "true".equals(env.get("SESSION_COOKIE_SECURE", "false")));
  }

  @Bean
  ListingService listingService(AccountDatabase db) {
    return new ListingService(db);
  }

  @Bean
  BookingService bookingService(AccountDatabase db, ListingService listings) {
    return new BookingService(db, listings);
  }

  @Bean
  QuestionService accountQuestionService(AccountDatabase db, ListingService listings) {
    return new QuestionService(db, listings);
  }

  @Bean
  ClarificationService clarificationService(AccountDatabase db, ListingService listings) {
    return new ClarificationService(db, listings);
  }

  @Bean
  PhotoService photoService(AccountDatabase db, RuntimeEnv env) {
    return new PhotoService(db, Path.of(env.get("UPLOADS_PATH", ".local/uploads")));
  }

  // ---- Подбор, район, разбор текста ----

  @Bean
  Store store(JdbcClient jdbc, CatalogService catalog, TransactionTemplate tx, Clock clock) {
    return new Store(jdbc, catalog, tx, clock);
  }

  @Bean
  Agents agents(RuntimeEnv env) {
    return new Agents(Agents.Config.from(env.values()));
  }

  @Bean
  Environment areaEnvironment(RuntimeEnv env) {
    return new Environment(
        Path.of(env.get("AREA_DATA_PATH", "data/area-assessments.json")),
        Path.of(env.get("NOISE_DATA_PATH", "data/noise-context.json")),
        Path.of(env.get("TRAFFIC_DATA_PATH", "data/traffic-ktdb-2024.json")));
  }

  @Bean
  SearchService searchService(
      Store store, Agents agents, Environment environment, AccountDatabase db, RuntimeEnv env,
      Clock clock, SearchOverlay overlay) {
    return new SearchService(
        store,
        agents,
        environment,
        clock,
        env.accountsEnabled() ? new OwnerListingSearchProvider(db) : null,
        overlay);
  }

  @Bean(destroyMethod = "close")
  WindowViewClient windowViewClient(RuntimeEnv env) {
    return WindowViewClient.from(env.values());
  }

  // ---- Помощник подбора ----

  @Bean(destroyMethod = "close")
  @DependsOn("flywayInitializer")
  AdvisorService advisorService(Store store, SearchService search, RuntimeEnv env)
      throws SQLException {
    return new AdvisorService(store, search, env.values());
  }
}
