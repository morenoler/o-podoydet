package ru.opodoydet.server.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Помечает ответы API и загруженные фото заголовком {@code X-Served-By: spring}. Во время переноса так было видно,
 * какие маршруты уже обслуживает Spring; контрактный скрипт по-прежнему его считает.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ServedByFilter extends OncePerRequestFilter {

  public static final String SERVED_BY = "X-Served-By";

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    String uri = request.getRequestURI();
    return !uri.startsWith("/api") && !uri.startsWith("/uploads/");
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    response.setHeader(SERVED_BY, "spring");
    chain.doFilter(request, response);
  }
}
