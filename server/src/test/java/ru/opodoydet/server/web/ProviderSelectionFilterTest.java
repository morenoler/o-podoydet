package ru.opodoydet.server.web;

import static org.junit.jupiter.api.Assertions.*;

import jakarta.servlet.ServletException;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import ru.opodoydet.application.ProviderSelection;

class ProviderSelectionFilterTest {
  private static ProviderSelection providers() {
    return new ProviderSelection(Map.of("AI_PROVIDER", "local", "ADVISOR_LOCAL_MODEL", "test-local",
        "DEEPSEEK_API_KEY", "synthetic-key"));
  }

  private static MockHttpServletRequest request(String path, String choice) {
    var request = new MockHttpServletRequest("POST", path);
    request.setServletPath(path);
    request.addHeader("X-AI-Provider", choice);
    return request;
  }

  @Test void contextIsClearedEvenWhenAControllerFails() throws Exception {
    var providers = providers();
    var filter = new ProviderSelectionFilter(providers);
    assertThrows(ServletException.class, () -> filter.doFilter(request("/api/search", "deepseek"),
        new MockHttpServletResponse(), (req, res) -> {
          assertEquals("deepseek", providers.currentProvider());
          throw new ServletException("synthetic failure");
        }));
    assertEquals("local", providers.currentProvider());
    assertEquals("local", providers.environment().get("AI_PROVIDER"));
  }

  @Test void invalidAndRepeatedHeadersFailBeforeTheController() throws Exception {
    var providers = providers();
    var filter = new ProviderSelectionFilter(providers);
    for (String value : new String[] {"", "invalid", "local,deepseek"}) {
      var response = new MockHttpServletResponse();
      var called = new AtomicBoolean();
      filter.doFilter(request("/api/search", value), response, (req, res) -> called.set(true));
      assertEquals(400, response.getStatus());
      assertFalse(called.get());
      assertFalse(response.getContentAsString().contains("synthetic-key"));
    }
    var duplicate = request("/api/search", "local");
    duplicate.addHeader("X-AI-Provider", "deepseek");
    var response = new MockHttpServletResponse();
    filter.doFilter(duplicate, response, (req, res) -> fail("Controller must not run"));
    assertEquals(400, response.getStatus());
  }

  @Test void configurationRemainsReadableWithAStaleSelection() throws Exception {
    var providers = new ProviderSelection(Map.of("AI_PROVIDER", "rules"));
    var filter = new ProviderSelectionFilter(providers);
    var called = new AtomicBoolean();
    filter.doFilter(request("/api/ai/config", "deepseek"), new MockHttpServletResponse(),
        (req, res) -> called.set(true));
    assertTrue(called.get());
    assertEquals("rules", providers.currentProvider());
  }
}
