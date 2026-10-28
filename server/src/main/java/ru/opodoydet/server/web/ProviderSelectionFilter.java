package ru.opodoydet.server.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import ru.opodoydet.application.ProviderSelection;
import ru.opodoydet.shared.Json;

/** A browser's choice is scoped to this HTTP request, never another visitor's requests. */
@Component
public final class ProviderSelectionFilter extends OncePerRequestFilter {
  private final ProviderSelection providers;
  public ProviderSelectionFilter(ProviderSelection providers) { this.providers = providers; }

  @Override protected boolean shouldNotFilter(HttpServletRequest request) {
    return !request.getServletPath().startsWith("/api/") || request.getServletPath().equals("/api/ai/config");
  }

  @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
      FilterChain chain) throws ServletException, IOException {
    ProviderSelection.Scope scope;
    try {
      var values = java.util.Collections.list(request.getHeaders("X-AI-Provider"));
      if (values.size() > 1) throw new IllegalArgumentException("Укажите одну модель для запроса.");
      scope = providers.select(values.isEmpty() ? null : values.getFirst());
    } catch (IllegalArgumentException invalid) {
      response.setStatus(400);
      response.setContentType("application/json");
      response.setCharacterEncoding(StandardCharsets.UTF_8.name());
      response.getWriter().write(Json.write(Json.obj("error", invalid.getMessage())));
      return;
    }
    try (scope) { chain.doFilter(request, response); }
  }
}
