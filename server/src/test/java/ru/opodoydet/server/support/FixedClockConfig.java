package ru.opodoydet.server.support;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * Фиксированное «сейчас» для тестов: через пару дней после сбора демо-данных (24.10.2026).
 * Иначе тесты начали бы падать сами собой, когда у фактов истечёт срок.
 */
@TestConfiguration
public class FixedClockConfig {

  public static final Instant NOW = Instant.parse("2026-10-26T12:00:00Z");

  @Bean
  @Primary
  Clock fixedClock() {
    return Clock.fixed(NOW, ZoneOffset.UTC);
  }
}
