package ru.opodoydet.web;

import java.io.IOException;
import java.sql.SQLException;
import java.time.Instant;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import ru.opodoydet.application.Agents;
import ru.opodoydet.application.AreaAssessmentService;
import ru.opodoydet.config.AppSettings;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

@RestController
public final class CatalogController {
  private final Store store;
  private final Agents agents;
  private final AreaAssessmentService assessments;
  private final AppSettings settings;

  public CatalogController(
      Store store, Agents agents, AreaAssessmentService assessments, AppSettings settings) {
    this.store = store;
    this.agents = agents;
    this.assessments = assessments;
    this.settings = settings;
  }

  @GetMapping("/api/health")
  public ObjectNode health() throws SQLException {
    return Json.obj(
        "ok",
        true,
        "hotels",
        store.hotels().size(),
        "mode",
        agents.mode(),
        "accountsEnabled",
        settings.enabled("ACCOUNT_MODE", true),
        "runtime",
        "Java " + Runtime.version().feature(),
        "database",
        "SQLite 3",
        "region",
        store.region);
  }

  @GetMapping("/api/catalog")
  public ObjectNode catalog() throws SQLException {
    return store.dataset().put("mode", agents.mode());
  }

  @GetMapping("/api/hotels/{id}")
  public ObjectNode hotel(@PathVariable String id) throws SQLException {
    JsonNode hotel = requireHotel(id);
    return Json.obj(
        "hotel", hotel,
        "facts",
            store.matchingFacts().stream().filter(f -> Json.str(f, "hotelId").equals(id)).toList(),
        "questions",
            store.questions().stream().filter(q -> Json.str(q, "hotelId").equals(id)).toList());
  }

  @GetMapping("/api/areas/{id}")
  public ObjectNode area(@PathVariable String id) throws SQLException, IOException {
    return Json.obj("assessment", assessments.assessment(requireHotel(id), Instant.now()));
  }

  private JsonNode requireHotel(String id) throws SQLException {
    JsonNode hotel = store.hotel(id);
    if (hotel == null) throw new ApiProblem(404, "Отель не найден");
    return hotel;
  }
}
