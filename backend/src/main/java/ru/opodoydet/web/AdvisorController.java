package ru.opodoydet.web;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.sql.SQLException;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.opodoydet.advisor.AdvisorService;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

@RestController
public final class AdvisorController {
  private final AdvisorService advisor;

  public AdvisorController(AdvisorService advisor) {
    this.advisor = advisor;
  }

  @GetMapping("/api/advisor/config")
  public ObjectNode configuration() {
    return advisor.config();
  }

  @GetMapping("/api/advisor/runs")
  public List<JsonNode> runs() throws SQLException {
    return advisor.list();
  }

  @PostMapping("/api/advisor/runs")
  public ResponseEntity<JsonNode> start(HttpServletRequest request)
      throws IOException, SQLException {
    try {
      return ResponseEntity.accepted().body(advisor.start(RequestBodies.json(request)));
    } catch (IllegalStateException error) {
      throw new ApiProblem(409, error.getMessage());
    }
  }

  @GetMapping("/api/advisor/runs/{id}")
  public JsonNode run(@PathVariable String id) throws SQLException {
    return requireRun(advisor.get(id));
  }

  @PostMapping("/api/advisor/runs/{id}/cancel")
  public JsonNode cancel(@PathVariable String id, HttpServletRequest request)
      throws IOException, SQLException {
    RequestBodies.json(request);
    try {
      return requireRun(advisor.cancel(id));
    } catch (IllegalStateException error) {
      throw new ApiProblem(409, error.getMessage());
    }
  }

  private JsonNode requireRun(JsonNode run) {
    if (run == null) throw new ApiProblem(404, "Задание помощника или действие не найдено");
    return run;
  }
}
