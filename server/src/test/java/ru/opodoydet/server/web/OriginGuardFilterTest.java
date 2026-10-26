package ru.opodoydet.server.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Те же правила, что в старом Api.originAllowed. */
class OriginGuardFilterTest {

  final OriginGuardFilter guard = new OriginGuardFilter("http://localhost:3000");

  @Test
  void allowsMissingSameHostAndConfiguredFrontend() {
    assertThat(guard.allowed(null, "127.0.0.1:8080")).isTrue();
    assertThat(guard.allowed("http://127.0.0.1:8080", "127.0.0.1:8080")).isTrue();
    assertThat(guard.allowed("http://localhost:3000", "127.0.0.1:8080")).isTrue();
  }

  @Test
  void rejectsForeignBrokenAndUserInfoOrigins() {
    assertThat(guard.allowed("https://evil.example", "127.0.0.1:8080")).isFalse();
    assertThat(guard.allowed("file:///etc/passwd", "127.0.0.1:8080")).isFalse();
    assertThat(guard.allowed("http://user@127.0.0.1:8080", "127.0.0.1:8080")).isFalse();
    assertThat(guard.allowed("not a uri", "127.0.0.1:8080")).isFalse();
  }
}
