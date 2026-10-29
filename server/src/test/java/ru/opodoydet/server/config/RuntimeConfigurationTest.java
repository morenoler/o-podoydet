package ru.opodoydet.server.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.core.env.MapPropertySource;
import org.springframework.mock.env.MockEnvironment;

class RuntimeConfigurationTest {
  @Test void domainAndSpringUseTheSamePropertyPrecedenceAndResolvePlaceholders() {
    MockEnvironment spring = new MockEnvironment();
    spring.getPropertySources().addLast(new MapPropertySource("defaults", Map.of(
        "LAB_MODE", "true", "DATA_PATH", "old", "AREA_DATA_PATH", "${DATA_PATH}/area.json")));
    spring.getPropertySources().addFirst(new MapPropertySource("commandLine", Map.of(
        "LAB_MODE", "false", "DATA_PATH", "test-data")));
    var env = new DomainConfig().runtimeEnv(spring);
    assertThat(env.labMode()).isFalse();
    assertThat(env.get("AREA_DATA_PATH", "")).isEqualTo("test-data/area.json");
    assertThat(env.get("DATA_PATH", "")).isEqualTo(spring.getProperty("DATA_PATH"));
  }

  @Test void contractClockIsExplicitAndDoesNotChangeTheNormalRuntimeClock() {
    var config = new RuntimeConfig();
    Instant instant = Instant.parse("2026-10-26T12:00:00Z");
    assertThat(config.contractClock(instant.toString()).instant()).isEqualTo(instant);
    Instant before = Instant.now();
    assertThat(config.clock().instant()).isAfterOrEqualTo(before).isBeforeOrEqualTo(Instant.now());
    assertThatThrownBy(() -> config.contractClock("invalid")).isInstanceOf(DateTimeParseException.class);
  }
}
