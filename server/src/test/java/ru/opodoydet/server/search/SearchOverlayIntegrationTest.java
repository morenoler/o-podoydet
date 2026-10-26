package ru.opodoydet.server.search;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import ru.opodoydet.server.catalog.SeedImporter;
import ru.opodoydet.server.knowledge.FactResolver;
import ru.opodoydet.server.knowledge.KnowledgeCommands;
import ru.opodoydet.server.support.FixedClockConfig;

/**
 * Входные данные — настоящие ответы старого API из {@code contract/snapshots}. Проверяем две вещи:
 * без ответов отельеров пересчёт ничего не меняет, а ответ отельера реально меняет выдачу.
 */
@SpringBootTest
@Import(FixedClockConfig.class)
class SearchOverlayIntegrationTest {

  static final Path CONTRACT = Path.of("../contract");
  static final String SHILLA = "way-627150752";
  static final String SHILLA_FAMILY_TWIN = SHILLA + "-real-standard-family-twin";

  @Autowired SeedImporter importer;
  @Autowired FactResolver resolver;
  @Autowired SearchOverlay overlay;
  @Autowired KnowledgeCommands commands;
  @Autowired JdbcClient jdbc;
  @Autowired ObjectMapper json;

  @BeforeEach
  void seedOnly() throws Exception {
    jdbc.sql("UPDATE evidence SET superseded_by = NULL").update();
    jdbc.sql("DELETE FROM evidence WHERE origin <> 'seed'").update();
    jdbc.sql("DELETE FROM host_question").update();
    jdbc.sql("DELETE FROM conflict").update();
    importer.importFile(Path.of("../data/verified-hotels.json"));
    resolver.resolveAll();
  }

  @Test
  void withoutHostAnswersEverySearchSnapshotIsUnchanged() throws Exception {
    int checked = 0;
    for (Case c : cases()) {
      ObjectNode before = c.response().deepCopy();
      JsonNode after =
          c.detail() ? overlay.detail(c.response(), c.trip()) : overlay.search(c.response(), c.trip());
      if (!after.equals(before)) {
        json.writeValue(new File("target/overlay-" + c.name() + ".json"), after);
        json.writeValue(new File("target/legacy-" + c.name() + ".json"), before);
      }
      assertThat(after.equals(before)).as(c.name()).isTrue();
      checked++;
    }
    assertThat(checked).isGreaterThanOrEqualTo(9);
  }

  @Test
  void hostAnswerAboutCourtyardTurnsExcludedHotelIntoResult() throws Exception {
    Case quiet = cases().stream().filter(c -> c.name().equals("search-quiet")).findFirst().orElseThrow();
    assertThat(quiet.response().path("results")).isEmpty(); // «окна во двор» обязательно — 0 отелей

    commands.recordHostStatement(
        new KnowledgeCommands.HostStatement(
            SHILLA, SHILLA_FAMILY_TWIN, "courtyard", BooleanNode.TRUE,
            "Номера Standard Family Twin выходят во внутренний двор", "medium",
            "Ответ отельера", "Имитированный отельер (демо)", true, null));
    resolver.resolveAll();

    JsonNode result = overlay.search(quiet.response(), quiet.trip());

    assertThat(result.path("results")).hasSize(1);
    JsonNode shilla = result.path("results").path(0);
    assertThat(shilla.path("hotel").path("id").asText()).isEqualTo(SHILLA);
    JsonNode best = shilla.path("best");
    assertThat(best.path("room").path("id").asText()).isEqualTo(SHILLA_FAMILY_TWIN);
    assertThat(best.path("status").asText()).isEqualTo("fits");
    JsonNode courtyard = best.path("criteria").path(0);
    assertThat(courtyard.path("status").asText()).isEqualTo("match");
    assertThat(courtyard.path("decisionBasis").asText()).isEqualTo("evidence");
    assertThat(courtyard.path("sources").toString()).contains("host");
    assertThat(courtyard.path("facts").toString()).contains("внутренний двор");
    assertThat(result.path("excluded")).hasSize(95);
    assertThat(result.path("trace").toString()).contains("ответов отельеров");
  }

  @Test
  void hostAnswerCanAlsoExcludeAHotel() throws Exception {
    Case quiet = cases().stream().filter(c -> c.name().equals("search-quiet")).findFirst().orElseThrow();
    for (String room : List.of(SHILLA_FAMILY_TWIN))
      commands.recordHostStatement(
          new KnowledgeCommands.HostStatement(
              SHILLA, room, "courtyard", BooleanNode.FALSE, "Окна выходят на море", "medium",
              "Ответ отельера", "Имитированный отельер (демо)", true, null));
    resolver.resolveAll();

    JsonNode result = overlay.search(quiet.response(), quiet.trip());

    assertThat(result.path("results")).isEmpty();
    JsonNode criterion =
        find(result.path("excluded"), SHILLA).path("rooms").findValues("criteria").stream()
            .flatMap(c -> stream(c).stream())
            .filter(c -> c.path("decisionBasis").asText().equals("evidence"))
            .findFirst()
            .orElseThrow();
    assertThat(criterion.path("status").asText()).isEqualTo("mismatch");
    assertThat(criterion.path("assumed").asBoolean()).isFalse();
  }

  record Case(String name, ObjectNode response, JsonNode trip, boolean detail) {}

  /** Успешные поиски и оценки отеля из контракта вместе с телом запроса. */
  List<Case> cases() throws Exception {
    JsonNode spec = json.readTree(CONTRACT.resolve("requests.json").toFile());
    List<Case> cases = new ArrayList<>();
    for (JsonNode request : spec.path("requests")) {
      String path = request.path("path").asText();
      boolean detail = path.endsWith("/evaluate");
      if (!path.equals("/api/search") && !detail) continue;
      if (request.has("headers")) continue;
      File file = CONTRACT.resolve("snapshots/" + request.path("name").asText() + ".json").toFile();
      JsonNode snapshot = json.readTree(file);
      if (snapshot.path("status").asInt() != 200) continue;
      ObjectNode trip = spec.path("trip").deepCopy();
      trip.setAll((ObjectNode) request.path("trip"));
      ObjectNode body = (ObjectNode) snapshot.path("body").deepCopy();
      restoreExpiry(body);
      cases.add(new Case(request.path("name").asText(), body, trip, detail));
    }
    return cases;
  }

  /**
   * Скрипт контракта заменяет expiresAt на "<volatile>". Возвращаем настоящие значения из
   * исходных записей, чтобы вход был ровно таким, каким его отдаёт старый API.
   */
  private void restoreExpiry(JsonNode node) {
    if (node.isObject()) {
      ObjectNode object = (ObjectNode) node;
      if ("<volatile>".equals(object.path("expiresAt").asText()) && object.has("id"))
        jdbc.sql("SELECT raw::json ->> 'expiresAt' FROM evidence WHERE id = ?")
            .param(object.path("id").asText())
            .query(String.class)
            .optional()
            .ifPresent(value -> object.put("expiresAt", value));
      object.forEach(this::restoreExpiry);
    } else if (node.isArray()) node.forEach(this::restoreExpiry);
  }

  private static JsonNode find(JsonNode matches, String hotelId) {
    return stream(matches).stream()
        .filter(m -> m.path("hotel").path("id").asText().equals(hotelId))
        .findFirst()
        .orElseThrow();
  }

  private static List<JsonNode> stream(JsonNode array) {
    List<JsonNode> list = new ArrayList<>();
    array.forEach(list::add);
    return list;
  }
}
