package ru.opodoydet.config;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.core.env.MapPropertySource;
import org.springframework.mock.env.MockEnvironment;

class AppSettingsTest {
  @Test
  void resolvesDeploymentValuesAndDefaultsWithoutChangingPathOrBooleanMeaning() {
    var environment =
        new MockEnvironment()
            .withProperty("DIST_PATH", "build output/frontend")
            .withProperty("ACCOUNT_MODE", "FALSE")
            .withProperty("LAB_MODE", "TrUe")
            .withProperty("LLM_MODEL", " ");
    var settings = new AppSettings(environment);

    assertEquals(Path.of("build output/frontend"), settings.path("DIST_PATH", "dist"));
    assertEquals(Path.of(".local/uploads"), settings.path("UPLOADS_PATH", ".local/uploads"));
    assertFalse(settings.enabled("ACCOUNT_MODE", true));
    assertTrue(settings.enabled("LAB_MODE", false));
    assertTrue(settings.enabled("MISSING_ENABLED_FLAG", true));
    assertFalse(settings.enabled("MISSING_DISABLED_FLAG", false));
    assertEquals("8080", settings.get("PORT", "8080"));
    assertEquals(" ", settings.get("LLM_MODEL", "fallback-model"));
  }

  @Test
  void exportedWorkerConfigurationUsesTheSameCliThenEnvironmentThenDotenvPriority() {
    var environment = new MockEnvironment();
    var sources = environment.getPropertySources();
    sources.addFirst(
        new MapPropertySource(
            "syntheticCommandLine", Map.of("PORT", "9000", "ADVISOR_LOCAL_MODEL", "cli-model")));
    sources.addAfter(
        "syntheticCommandLine",
        new MapPropertySource(
            "syntheticEnvironment",
            Map.of("PORT", "8088", "DB_PATH", ".local/environment.sqlite3")));
    sources.addLast(
        new MapPropertySource(
            "syntheticDotenv",
            Map.of(
                "PORT",
                "8081",
                "DB_PATH",
                ".local/dotenv.sqlite3",
                "ADVISOR_LOCAL_MODEL",
                "dotenv-model",
                "UPLOADS_PATH",
                ".local/custom-uploads")));
    var settings = new AppSettings(environment);

    assertEquals("9000", settings.get("PORT", "8080"));
    assertEquals(
        Map.of(
            "PORT", "9000",
            "DB_PATH", ".local/environment.sqlite3",
            "ADVISOR_LOCAL_MODEL", "cli-model",
            "UPLOADS_PATH", ".local/custom-uploads"),
        settings.values());
    sources.remove("syntheticCommandLine");
    assertEquals("8088", settings.values().get("PORT"));
    assertEquals("dotenv-model", settings.values().get("ADVISOR_LOCAL_MODEL"));
  }

  @Test
  void disabledDotenvDoesNotReadLocalFilesAndWorkerMapExcludesSpringAndMixedCaseProperties() {
    var environment =
        new MockEnvironment()
            .withProperty("app.dotenv.enabled", "false")
            .withProperty("spring.application.name", "not-worker-config")
            .withProperty("logging.level.root", "not-worker-config")
            .withProperty("Mixed_CASE", "not-worker-config")
            .withProperty("1INVALID", "not-worker-config")
            .withProperty("ADVISOR_PYTHON", "test-python")
            .withProperty("SESSION_COOKIE_SECURE", "true");

    // The disabled branch must return before inspecting the repository's real .env.
    new DotenvEnvironmentPostProcessor().postProcessEnvironment(environment, null);

    assertFalse(environment.getPropertySources().contains("localDotenv"));
    assertEquals(
        Map.of("ADVISOR_PYTHON", "test-python", "SESSION_COOKIE_SECURE", "true"),
        new AppSettings(environment).values());
  }
}
