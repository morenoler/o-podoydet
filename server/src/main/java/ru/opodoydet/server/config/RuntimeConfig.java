package ru.opodoydet.server.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
public class RuntimeConfig {

  /** Время только через Clock: в тестах подставляем фиксированное, и ответы не «плывут». */
  @Bean
  Clock clock() {
    return Clock.systemUTC();
  }
}
