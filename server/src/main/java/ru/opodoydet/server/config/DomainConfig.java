package ru.opodoydet.server.config;

import java.io.IOException;
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
import ru.opodoydet.accounts.shortlists.ShortlistService;
import ru.opodoydet.accounts.search.OwnerListingSearchProvider;
import ru.opodoydet.advisor.AdvisorService;
import ru.opodoydet.application.Agents;
import ru.opodoydet.application.Environment;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.application.ProviderSelection;
import ru.opodoydet.application.WindowViewClient;
import ru.opodoydet.application.places.PlaceSearch;
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

  /** Domain adapters use the same resolved Spring environment as datasource and web settings.
   * The Node launcher loads .env once; direct java/containers use normal Spring configuration.
   */
  @Bean
  RuntimeEnv runtimeEnv(ConfigurableEnvironment spring) {
    Map<String, String> result = new HashMap<>();
    // Resolve through Spring to preserve command-line, test and environment precedence.
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
  BookingService bookingService(AccountDatabase db, ListingService listings, Clock clock) {
    return new BookingService(db, listings, clock);
  }

  @Bean
  QuestionService accountQuestionService(AccountDatabase db, ListingService listings) {
    return new QuestionService(db, listings);
  }

  @Bean
  ShortlistService shortlistService(AccountDatabase db, Clock clock) {
    return new ShortlistService(db, clock);
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
  ProviderSelection providerSelection(RuntimeEnv env) {
    return new ProviderSelection(env.values());
  }

  @Bean
  Agents agents(ProviderSelection providers) {
    return new Agents(() -> Agents.Config.from(providers.environment()));
  }

  @Bean
  Environment areaEnvironment(RuntimeEnv env) {
    return new Environment(
        Path.of(env.get("AREA_DATA_PATH", "data/area-assessments.json")),
        Path.of(env.get("NOISE_DATA_PATH", "data/noise-context.json")),
        Path.of(env.get("TRAFFIC_DATA_PATH", "data/traffic-ktdb-2024.json")));
  }

  @Bean
  PlaceSearch placeSearch(RuntimeEnv env, ProviderSelection providers) {
    return new PlaceSearch(Path.of(env.get("PLACES_DATA_PATH", "data/places/busan-places.json")), providers);
  }

  @Bean
  SearchService searchService(
      Store store, Agents agents, Environment environment, AccountDatabase db, RuntimeEnv env,
      Clock clock, SearchOverlay overlay, PlaceSearch places) {
    return new SearchService(
        store,
        agents,
        environment,
        clock,
        env.accountsEnabled() ? new OwnerListingSearchProvider(db) : null,
        overlay,
        places);
  }

  @Bean(destroyMethod = "close")
  WindowViewClient windowViewClient(RuntimeEnv env) {
    return WindowViewClient.from(env.values());
  }

  // ---- Помощник подбора ----

  @Bean(destroyMethod = "close")
  @DependsOn("flywayInitializer")
  AdvisorService advisorService(Store store, SearchService search, RuntimeEnv env, ProviderSelection providers)
      throws SQLException {
    return new AdvisorService(store, search, providers, new ru.opodoydet.advisor.PythonWorker(env.values()));
  }
}
