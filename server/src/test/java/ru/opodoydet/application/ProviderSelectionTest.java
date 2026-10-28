package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class ProviderSelectionTest {
  static final Map<String, String> BOTH = Map.of("AI_PROVIDER", "local",
      "ADVISOR_LOCAL_MODEL", "test-local", "ADVISOR_LOCAL_BASE_URL", "http://127.0.0.1:11434/v1",
      "DEEPSEEK_API_KEY", "synthetic-key", "DEEPSEEK_MODEL", "test-deepseek", "LLM_API_KEY", "legacy-secret");

  @Test void bothProvidersAreAvailableWithoutExposingCredentials() {
    var providers = new ProviderSelection(BOTH);
    assertTrue(providers.available("local"));
    assertTrue(providers.available("deepseek"));
    assertFalse(providers.publicConfig().toString().contains("synthetic-key"));
    assertFalse(providers.advisorConfig().toString().contains("legacy-secret"));
    assertEquals("test-local", providers.advisorConfig().path("modelNames").path("local").asText());
    assertEquals("test-deepseek", providers.advisorConfig().path("modelNames").path("deepseek").asText());
    for (String mode : List.of("rules", "local")) {
      assertFalse(providers.environmentFor(mode).containsKey("DEEPSEEK_API_KEY"));
      assertFalse(providers.environmentFor(mode).containsKey("LLM_API_KEY"));
    }
  }

  @Test void rulesDisableAllModelsAndInvalidSelectionsNeverChangeCurrentScope() {
    var env = new java.util.HashMap<>(BOTH);
    env.put("AI_PROVIDER", "rules");
    var providers = new ProviderSelection(env);
    for (String id : List.of("local", "deepseek", "other", "", "local,deepseek")) {
      assertThrows(IllegalArgumentException.class, () -> providers.select(id));
      assertEquals("rules", providers.currentProvider());
    }
    assertEquals(ru.opodoydet.shared.Json.array(List.of("rules")), providers.advisorConfig().path("modes"));
  }

  @Test void missingKeyAndRemoteLocalAddressAreUnavailableWithoutPreventingRules() {
    var providers = new ProviderSelection(Map.of("ADVISOR_LOCAL_MODEL", "test",
        "ADVISOR_LOCAL_BASE_URL", "https://example.org"));
    assertFalse(providers.available("local"));
    assertFalse(providers.available("deepseek"));
    assertTrue(providers.available("rules"));
    assertThrows(IllegalArgumentException.class, () -> providers.select("deepseek"));
  }

  @Test void simultaneousRequestsAndNestedFailuresRestoreTheirOwnProvider() throws Exception {
    var providers = new ProviderSelection(BOTH);
    var barrier = new CyclicBarrier(2);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var tasks = List.of("local", "deepseek").stream().map(mode -> executor.submit(() -> {
        for (int i = 0; i < 20; i++) {
          try (var scope = providers.select(mode)) {
            barrier.await(3, TimeUnit.SECONDS);
            assertEquals(mode, providers.currentProvider());
            assertEquals(mode, providers.environment().get("AI_PROVIDER"));
            try (var inner = providers.select("rules")) {
              assertEquals("rules", providers.currentProvider());
            }
            assertEquals(mode, providers.currentProvider());
          }
          assertEquals("local", providers.currentProvider());
        }
        return true;
      })).toList();
      for (var task : tasks) assertTrue(task.get(10, TimeUnit.SECONDS));
    }
    assertEquals("local", providers.currentProvider());
  }

  @Test void missingOverridePreservesLegacyConfiguration() {
    Map<String, String> legacy = Map.of("LLM_MODEL", "legacy", "LLM_API_KEY", "old-key");
    var providers = new ProviderSelection(legacy);
    assertEquals(legacy, providers.environment());
    try (var scope = providers.select("rules")) {
      assertFalse(Agents.Config.from(providers.environment()).enabled());
    }
    assertEquals(legacy, providers.environment());
  }
}
