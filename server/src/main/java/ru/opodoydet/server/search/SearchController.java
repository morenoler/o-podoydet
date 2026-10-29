package ru.opodoydet.server.search;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.io.IOException;
import java.sql.SQLException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.server.web.AdvisorIdentity;
import ru.opodoydet.server.web.JsonResponses;
import ru.opodoydet.server.web.PlatformController;

/**
 * {@code POST /api/search} и {@code POST /api/hotels/{id}/evaluate}.
 *
 * <p>{@link SearchService} (перенесён из старого бэкенда) разбирает запрос, оценивает район,
 * вместимость и объявления из кабинетов; {@link SearchOverlay} передаёт сохранённые факты
 * ядра знаний в общий расчёт критериев — с учётом ответов отельеров.
 */
@RestController
public class SearchController {

  private final SearchService search;
  private final AdvisorIdentity identity;

  SearchController(SearchService search, AdvisorIdentity identity) {
    this.search = search;
    this.identity = identity;
  }

  @PostMapping("/api/search")
  public ResponseEntity<JsonNode> search(@Valid @RequestBody SearchRequest input,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize,
      @RequestParam(defaultValue = "true") boolean includeExcluded,
      HttpServletRequest request, HttpServletResponse response)
      throws IOException, SQLException {
    // Validate projection controls before performing expensive search work.
    SearchPage.apply(ru.opodoydet.shared.Json.obj(), page, pageSize, includeExcluded);
    return JsonResponses.json(200, SearchPage.apply(
        search.search(input.toJson(), identity.resolve(request, response)), page, pageSize, includeExcluded));
  }

  @PostMapping("/api/hotels/{id}/evaluate")
  public ResponseEntity<JsonNode> evaluate(@PathVariable String id, @Valid @RequestBody SearchRequest input)
      throws IOException, SQLException {
    ObjectNode match = search.detail(id, input.toJson());
    if (match == null) return JsonResponses.json(404, ru.opodoydet.shared.Json.obj("error", "Отель не найден"));
    return JsonResponses.json(200, match);
  }

  @GetMapping("/api/hotels/{id}/places")
  public ResponseEntity<String> places(@PathVariable String id) {
    ObjectNode surroundings = search.surroundings(id);
    return surroundings == null ? JsonResponses.notFound("Отель не найден") : JsonResponses.send(200, surroundings);
  }
}
