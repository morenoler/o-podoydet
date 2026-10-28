package ru.opodoydet.server.support;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.server.OPodoydetApplication;
import ru.opodoydet.server.catalog.SeedImporter;

/** Real PostgreSQL fixtures. Every resource owns a fresh schema and never uses application data. */
public final class TestDatabases {
  private TestDatabases() {}

  record Settings(String url, String user, String password) {}

  static final class Shared {
    static final Settings SETTINGS = connect();
    private static Settings connect() {
      String supplied = System.getenv("TEST_DATABASE_URL");
      if (supplied != null && !supplied.isBlank()) {
        if (!supplied.startsWith("jdbc:postgresql://"))
          throw new IllegalArgumentException("TEST_DATABASE_URL must use real PostgreSQL");
        return new Settings(supplied,
            System.getenv().getOrDefault("TEST_DATABASE_USER", "test"),
            System.getenv().getOrDefault("TEST_DATABASE_PASSWORD", "test"));
      }
      PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");
      postgres.start(); // Failure is a test failure, never a silent skip or SQLite substitution.
      // Testcontainers/Ryuk owns JVM cleanup; an extra hook could stop PostgreSQL before
      // cached Spring test contexts close their pools and drop their isolated schemas.
      return new Settings(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
    }
  }

  public static Database create(JsonNode seed) throws IOException, SQLException {
    return new Database(seed, Map.of(), false);
  }

  public static Database create(JsonNode seed, Map<String, String> settings)
      throws IOException, SQLException {
    return new Database(seed, settings, false);
  }

  public static Database start(JsonNode seed, Map<String, String> settings)
      throws IOException, SQLException {
    return new Database(seed, settings, true);
  }

  /** Explicit synthetic bytes only: no environment or caller path can select a user database. */
  public static Database startWithLegacyFixture(
      JsonNode seed, Map<String, String> settings, byte[] sqliteFixture)
      throws IOException, SQLException {
    return new Database(seed, settings, true, java.util.Objects.requireNonNull(sqliteFixture));
  }

  public static final class Database implements AutoCloseable {
    private final Settings settings = Shared.SETTINGS;
    private final String schema = "test_" + UUID.randomUUID().toString().replace("-", "");
    private final Path directory;
    private final Map<String, String> properties = new LinkedHashMap<>();
    private final boolean web;
    private ConfigurableApplicationContext context;
    private boolean closed;

    private Database(JsonNode seed, Map<String, String> overrides, boolean web)
        throws IOException, SQLException {
      this(seed, overrides, web, null);
    }

    private Database(JsonNode seed, Map<String, String> overrides, boolean web, byte[] sqliteFixture)
        throws IOException, SQLException {
      this.web = web;
      directory = Files.createTempDirectory("opodoydet-pg-test-");
      try (Connection connection = admin()) {
        connection.createStatement().execute("CREATE SCHEMA " + schema);
      }
      properties.putAll(overrides);
      properties.put("DATABASE_URL", schemaUrl());
      properties.put("DATABASE_USER", settings.user());
      properties.put("DATABASE_PASSWORD", settings.password());
      properties.put("DB_SCHEMA", schema);
      properties.put("spring.datasource.url", schemaUrl());
      properties.put("spring.datasource.username", settings.user());
      properties.put("spring.datasource.password", settings.password());
      properties.put("spring.flyway.schemas", schema);
      properties.put("spring.flyway.default-schema", schema);
      properties.put("spring.jpa.properties.hibernate.default_schema", schema);
      properties.put("spring.datasource.hikari.maximum-pool-size", "4");
      properties.put("spring.datasource.hikari.minimum-idle", "0");
      properties.put("spring.main.banner-mode", "off");
      properties.put("logging.level.root", "WARN");
      properties.put("server.port", "0");
      properties.put("PORT", "0");
      properties.put("catalog.import-on-startup", "false");
      properties.put("knowledge.resolve-interval", "PT24H");
      properties.put("LEGACY_DB_PATH", "");
      properties.putIfAbsent("ACCOUNT_MODE", "false");
      properties.putIfAbsent("LAB_MODE", "false");
      properties.putIfAbsent("UPLOADS_PATH", directory.resolve("uploads").toString());
      properties.putIfAbsent("DIST_PATH", directory.toString());
      properties.putIfAbsent("AREA_DATA_PATH", directory.resolve("areas.json").toString());
      properties.putIfAbsent("NOISE_DATA_PATH", directory.resolve("noise.json").toString());
      properties.putIfAbsent("TRAFFIC_DATA_PATH", directory.resolve("traffic.json").toString());
      properties.putIfAbsent("SESSION_COOKIE_SECURE", "false");
      properties.putIfAbsent("FRONTEND_ORIGIN", "");
      properties.putIfAbsent("LLM_API_KEY", "");
      properties.putIfAbsent("AI_PROVIDER", "");
      properties.putIfAbsent("DEEPSEEK_API_KEY", "");
      // Local Ollama needs no key; disable it too unless a test explicitly supplies a model.
      properties.putIfAbsent("LLM_MODEL", "");
      properties.putIfAbsent("ADVISOR_LOCAL_MODEL", "");
      try {
        if (sqliteFixture != null) {
          Path source = directory.resolve("legacy-fixture.sqlite3");
          Files.write(source, sqliteFixture);
          properties.put("LEGACY_DB_PATH", source.toString());
        }
        open();
        importSeed(seed);
      } catch (IOException | RuntimeException failure) {
        close();
        throw failure;
      }
    }

    private String schemaUrl() {
      String url = settings.url().replaceAll("([?&])currentSchema=[^&]*&?", "$1").replaceAll("[?&]$", "");
      return url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema;
    }

    private Connection admin() throws SQLException {
      return DriverManager.getConnection(settings.url(), settings.user(), settings.password());
    }

    private void open() {
      SpringApplication app = new SpringApplication(OPodoydetApplication.class);
      app.setWebApplicationType(web ? WebApplicationType.SERVLET : WebApplicationType.NONE);
      app.setRegisterShutdownHook(false);
      // Command-line properties also override the test resource datasource and local developer env.
      context = app.run(properties.entrySet().stream()
          .map(e -> "--" + e.getKey() + "=" + e.getValue()).toArray(String[]::new));
    }

    public Store store() { return context.getBean(Store.class); }
    public AccountDatabase accounts() { return context.getBean(AccountDatabase.class); }
    public JdbcClient jdbc() { return context.getBean(JdbcClient.class); }
    public DataSource dataSource() { return context.getBean(DataSource.class); }
    public TransactionTemplate tx() { return context.getBean(TransactionTemplate.class); }
    public ConfigurableApplicationContext context() { return context; }
    public String schema() { return schema; }
    public Map<String, String> env() { return Map.copyOf(properties); }
    public Path directory() { return directory; }
    public int port() {
      if (!web) throw new IllegalStateException("Use TestDatabases.start for HTTP tests");
      return ((ServletWebServerApplicationContext) context).getWebServer().getPort();
    }
    public void importSeed(JsonNode seed) {
      context.getBean(SeedImporter.class).importSeed(seed);
      context.getBean(ru.opodoydet.server.knowledge.FactResolver.class).resolveAll();
    }
    public void restart() {
      if (closed) throw new IllegalStateException("Database is closed");
      context.close();
      open();
    }
    @Override public void close() throws SQLException {
      if (closed) return;
      closed = true;
      if (context != null) context.close();
      try (Connection connection = admin()) {
        // schema is generated internally and cannot name an application's schema.
        connection.createStatement().execute("DROP SCHEMA " + schema + " CASCADE");
      }
    }
  }
}
