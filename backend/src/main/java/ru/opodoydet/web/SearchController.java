package ru.opodoydet.web;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.sql.SQLException;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.opodoydet.application.SearchService;
import ru.opodoydet.config.AppSettings;
import tools.jackson.databind.node.ObjectNode;

@RestController
public final class SearchController {
  private final SearchService search;
  private final AppSettings settings;

  public SearchController(SearchService search, AppSettings settings) {
    this.search = search;
    this.settings = settings;
  }

  @PostMapping("/api/search")
  public ObjectNode search(HttpServletRequest request) throws IOException, SQLException {
    return search.search(RequestBodies.json(request));
  }

  @PostMapping("/api/search/conversation")
  public ObjectNode conversation(HttpServletRequest request) throws IOException, SQLException {
    return search.refine(RequestBodies.json(request));
  }

  @PostMapping("/api/hotels/{id}/evaluate")
  public ObjectNode evaluate(@PathVariable String id, HttpServletRequest request)
      throws IOException, SQLException {
    ObjectNode result = search.detail(id, RequestBodies.json(request));
    if (result == null) throw new ApiProblem(404, "Отель не найден");
    return result;
  }

  @PostMapping("/api/lab/search")
  public ObjectNode laboratory(HttpServletRequest request) throws IOException, SQLException {
    if (!settings.enabled("LAB_MODE", false)) throw new ApiProblem(404, "Метод не найден");
    return search.searchLab(RequestBodies.json(request));
  }
}
