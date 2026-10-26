package ru.opodoydet.server.search;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.sql.SQLException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.server.web.JsonResponses;
import ru.opodoydet.server.web.PlatformController;

/**
 * {@code POST /api/search} и {@code POST /api/hotels/{id}/evaluate}.
 *
 * <p>{@link SearchService} (перенесён из старого бэкенда) разбирает запрос, оценивает район,
 * вместимость и объявления из кабинетов; {@link SearchOverlay} пересчитывает условия по фактам
 * ядра знаний — с учётом ответов отельеров.
 */
@RestController
public class SearchController {

  private final SearchService search;
  private final SearchOverlay overlay;

  SearchController(SearchService search, SearchOverlay overlay) {
    this.search = search;
    this.overlay = overlay;
  }

  @PostMapping("/api/search")
  public ResponseEntity<String> search(HttpServletRequest request) throws IOException, SQLException {
    JsonNode input = PlatformController.body(request);
    return JsonResponses.send(200, overlay.search(search.search(input), input));
  }

  @PostMapping("/api/hotels/{id}/evaluate")
  public ResponseEntity<String> evaluate(@PathVariable String id, HttpServletRequest request)
      throws IOException, SQLException {
    JsonNode input = PlatformController.body(request);
    ObjectNode match = search.detail(id, input);
    if (match == null) return JsonResponses.notFound("Отель не найден");
    return JsonResponses.send(200, overlay.detail(match, input));
  }
}
