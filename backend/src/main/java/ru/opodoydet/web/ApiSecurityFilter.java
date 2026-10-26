package ru.opodoydet.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import ru.opodoydet.config.AppSettings;
import ru.opodoydet.shared.Json;

/** Preserve the same-origin write boundary for cookie-authenticated endpoints. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class ApiSecurityFilter extends OncePerRequestFilter {
  private final String frontendOrigin;

  public ApiSecurityFilter(AppSettings settings) {
    frontendOrigin = settings.get("FRONTEND_ORIGIN", "");
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.getServletPath().startsWith("/api")) {
      response.setHeader("Cache-Control", "no-store");
      if (!request.getMethod().equals("GET") && !originAllowed(request)) {
        response.setStatus(403);
        response.setContentType("application/json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response
            .getWriter()
            .write(
                Json.write(Json.obj("error", "Запрос должен быть отправлен из этого приложения.")));
        return;
      }
    }
    chain.doFilter(request, response);
  }

  private boolean originAllowed(HttpServletRequest request) {
    String origin = request.getHeader("Origin");
    if (origin == null) return true;
    try {
      URI parsed = URI.create(origin);
      return ("http".equals(parsed.getScheme()) || "https".equals(parsed.getScheme()))
          && parsed.getRawUserInfo() == null
          && parsed.getRawQuery() == null
          && parsed.getRawFragment() == null
          && (parsed.getRawPath() == null || parsed.getRawPath().isEmpty())
          && (parsed.getAuthority().equals(request.getHeader("Host"))
              || (!frontendOrigin.isBlank() && origin.equals(frontendOrigin)));
    } catch (RuntimeException error) {
      return false;
    }
  }
}
