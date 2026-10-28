package ru.opodoydet.server.support;

import java.nio.file.Files;
import java.sql.DriverManager;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.support.BeanDefinitionRegistry;
import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;

/** Fresh PostgreSQL schema for each cached Spring test context; real Flyway migrations run. */
public final class IsolatedPostgresInitializer
    implements ApplicationContextInitializer<ConfigurableApplicationContext> {
  @Override public void initialize(ConfigurableApplicationContext context) {
    var settings = TestDatabases.Shared.SETTINGS;
    String schema = "test_" + UUID.randomUUID().toString().replace("-", "");
    try {
      try (var connection = DriverManager.getConnection(settings.url(), settings.user(), settings.password())) {
        connection.createStatement().execute("CREATE SCHEMA " + schema);
      }
      String base = settings.url().replaceAll("([?&])currentSchema=[^&]*&?", "$1").replaceAll("[?&]$", "");
      String url = base + (base.contains("?") ? "&" : "?") + "currentSchema=" + schema;
      Map<String, Object> properties = new LinkedHashMap<>();
      properties.put("spring.datasource.url", url);
      properties.put("spring.datasource.username", settings.user());
      properties.put("spring.datasource.password", settings.password());
      properties.put("spring.flyway.schemas", schema);
      properties.put("spring.flyway.default-schema", schema);
      properties.put("spring.jpa.properties.hibernate.default_schema", schema);
      properties.put("spring.datasource.hikari.maximum-pool-size", "4");
      properties.put("DB_SCHEMA", schema);
      properties.put("catalog.import-on-startup", "false");
      properties.put("ACCOUNT_MODE", "true");
      properties.put("LAB_MODE", "false");
      properties.put("SESSION_COOKIE_SECURE", "false");
      properties.put("FRONTEND_ORIGIN", "");
      properties.put("LEGACY_DB_PATH", "");
      properties.put("LLM_API_KEY", "");
      properties.put("AI_PROVIDER", "");
      properties.put("DEEPSEEK_API_KEY", "");
      properties.put("LLM_MODEL", "");
      properties.put("ADVISOR_LOCAL_MODEL", "");
      properties.put("UPLOADS_PATH", Files.createTempDirectory("opodoydet-pg-uploads-").toString());
      context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("isolatedPostgres", properties));
      RootBeanDefinition cleanup = new RootBeanDefinition(SchemaCleanup.class);
      cleanup.setInstanceSupplier(() -> new SchemaCleanup(settings, schema));
      ((BeanDefinitionRegistry) context.getBeanFactory()).registerBeanDefinition("testSchemaCleanup", cleanup);
    } catch (Exception failure) {
      throw new IllegalStateException("Could not prepare isolated PostgreSQL test schema", failure);
    }
  }

  static final class SchemaCleanup implements DisposableBean {
    private final TestDatabases.Settings settings;
    private final String schema;
    SchemaCleanup(TestDatabases.Settings settings, String schema) {
      this.settings = settings;
      this.schema = schema;
    }
    @Override public void destroy() throws Exception {
      try (var connection = DriverManager.getConnection(settings.url(), settings.user(), settings.password())) {
        connection.createStatement().execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
      }
    }
  }
}
