package ru.opodoydet.server.host;

import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import ru.opodoydet.server.catalog.CatalogService;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;

/** Experimental catalog dialogue is a sandbox, never an unauthenticated real-hotel editor. */
@Component
public final class DemoHostGuard {
  private final CatalogService catalog;
  private final RuntimeEnv env;

  DemoHostGuard(CatalogService catalog, RuntimeEnv env) {
    this.catalog = catalog;
    this.env = env;
  }

  public void requireEnabled() {
    if (!env.labMode() || catalog.dataset().filter(d -> d.isDemoPolicy()).isEmpty())
      throw forbidden();
  }

  public Set<String> allowedHotels() {
    requireEnabled();
    return catalog.legacyHotels().stream()
        .filter(h -> h.path("id").asText().startsWith("demo-") && h.path("demo").asBoolean(false))
        .map(h -> h.path("id").asText()).collect(Collectors.toUnmodifiableSet());
  }

  public void requireHotel(String hotel) {
    requireEnabled();
    if (hotel != null && !allowedHotels().contains(hotel)) throw forbidden();
  }

  public boolean syntheticHotel(String hotel) {
    return hotel != null && hotel.startsWith("demo-")
        && catalog.legacyHotel(hotel, true).filter(h -> h.path("demo").asBoolean(false)).isPresent();
  }

  private static ResponseStatusException forbidden() {
    return new ResponseStatusException(HttpStatus.FORBIDDEN,
        "Экспериментальный диалог доступен только в лаборатории с вымышленными объектами.");
  }
}
