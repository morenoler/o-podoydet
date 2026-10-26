package ru.opodoydet.server.catalog;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import ru.opodoydet.application.Agents;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;
import ru.opodoydet.server.web.JsonResponses;
import ru.opodoydet.shared.Json;

/** Каталог в формате старого API: здоровье сервиса, каталог, карточка отеля. */
@RestController
public class CatalogController {

  private final CatalogService catalog;
  private final Agents agents;
  private final Store store;
  private final JdbcClient jdbc;
  private final boolean accountsEnabled;

  CatalogController(
      CatalogService catalog, Agents agents, Store store, JdbcClient jdbc, RuntimeEnv env) {
    this.catalog = catalog;
    this.agents = agents;
    this.store = store;
    this.jdbc = jdbc;
    this.accountsEnabled = env.accountsEnabled();
  }

  @GetMapping("/api/health")
  public ResponseEntity<String> health() {
    String version =
        jdbc.sql("SHOW server_version").query(String.class).single().split("[ .]")[0];
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("ok", true);
    body.put("hotels", catalog.hotelCount());
    body.put("mode", agents.mode());
    body.put("accountsEnabled", accountsEnabled);
    body.put("runtime", "Java " + Runtime.version().feature());
    body.put("database", "PostgreSQL " + version);
    body.put("region", catalog.dataset().map(Dataset::getRegion).orElse(""));
    return JsonResponses.send(200, body);
  }

  @GetMapping("/api/catalog")
  public ResponseEntity<String> catalog() {
    return JsonResponses.send(200, catalog.catalog().put("mode", agents.mode()));
  }

  @GetMapping("/api/hotels/{id}")
  public ResponseEntity<String> hotel(@PathVariable String id) {
    return catalog
        .hotel(id)
        .map(
            body -> {
              List<JsonNode> questions =
                  store.questions().stream()
                      .filter(q -> Json.str(q, "hotelId").equals(id))
                      .toList();
              ObjectNode result = body;
              result.set("questions", Json.array(questions));
              return JsonResponses.send(200, result);
            })
        .orElseGet(() -> JsonResponses.notFound("Отель не найден"));
  }

  /** {@code /api/hotels/} и вложенные пути GET — как в старом API, «отель не найден». */
  @GetMapping({"/api/hotels/", "/api/hotels/*/**"})
  public ResponseEntity<String> unknownHotel() {
    return JsonResponses.notFound("Отель не найден");
  }
}
