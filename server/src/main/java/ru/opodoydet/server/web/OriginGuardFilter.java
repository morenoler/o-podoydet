package ru.opodoydet.server.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;

/**
 * Та же защита от CSRF, что и в старом Api.originAllowed: изменяющий запрос принимается без
 * Origin, с Origin этого же хоста или с явно разрешённого фронтенда (FRONTEND_ORIGIN).
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class OriginGuardFilter extends OncePerRequestFilter {

  private final String frontendOrigin;

  @org.springframework.beans.factory.annotation.Autowired
  public OriginGuardFilter(RuntimeEnv env) {
    this(env.get("FRONTEND_ORIGIN", ""));
  }

  OriginGuardFilter(String frontendOrigin) {
    this.frontendOrigin = frontendOrigin;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    // The container decodes servletPath before Spring resolves the route. Checking
    // the raw URI would let /%61pi/... bypass the same-origin check.
    String path = request.getServletPath();
    return !(path.equals("/api") || path.startsWith("/api/"))
        || "GET".equals(request.getMethod());
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    if (allowed(request.getHeader("Origin"), request.getHeader("Host"))) {
      chain.doFilter(request, response);
      return;
    }
    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    response.setCharacterEncoding(StandardCharsets.UTF_8.name());
    response
        .getWriter()
        .write("{\"error\":\"Запрос должен быть отправлен из этого приложения.\"}");
  }

  boolean allowed(String origin, String host) {
    if (origin == null) return true;
    try {
      URI parsed = URI.create(origin);
      String scheme = parsed.getScheme();
      return ("http".equals(scheme) || "https".equals(scheme))
          && parsed.getRawUserInfo() == null
          && (parsed.getAuthority().equals(host)
              || (!frontendOrigin.isBlank() && origin.equals(frontendOrigin)));
    } catch (RuntimeException invalid) {
      return false;
    }
  }
}
