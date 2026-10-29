package ru.opodoydet.server.config;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
public class RuntimeConfig {

  /** Время только через Clock: в тестах подставляем фиксированное, и ответы не «плывут». */
  @Bean
  @Profile("!contract")
  Clock clock() {
    return Clock.systemUTC();
  }

  /** Only the isolated contract runner activates this profile; normal runs use real time. */
  @Bean
  @Profile("contract")
  Clock contractClock(@Value("${contract.instant}") String instant) {
    return Clock.fixed(Instant.parse(instant), ZoneOffset.UTC);
  }
}
