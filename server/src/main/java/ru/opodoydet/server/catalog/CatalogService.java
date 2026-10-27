package ru.opodoydet.server.catalog;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.opodoydet.server.knowledge.Evidence;
import ru.opodoydet.server.knowledge.KnowledgeQueries;

/** Собирает ответы каталога в старом формате поверх нового хранилища. */
@Service
@Transactional(readOnly = true)
public class CatalogService {

  private final DatasetRepository datasets;
  private final HotelRepository hotels;
  private final KnowledgeQueries knowledge;
  private final ObjectMapper json;
  private final Clock clock;
  private final org.springframework.jdbc.core.simple.JdbcClient jdbc;

  CatalogService(
      DatasetRepository datasets,
      HotelRepository hotels,
      KnowledgeQueries knowledge,
      ObjectMapper json,
      Clock clock, org.springframework.jdbc.core.simple.JdbcClient jdbc) {
    this.datasets = datasets;
    this.hotels = hotels;
    this.knowledge = knowledge;
    this.json = json;
    this.clock = clock;
    this.jdbc = jdbc;
  }

  /** Демо-прототип работает с одним регионом. */
  public Optional<Dataset> dataset() {
    return jdbc.sql("SELECT region FROM catalog_runtime WHERE singleton")
        .query(String.class).optional().flatMap(datasets::findById);
  }

  public java.util.Set<String> hotelIds() {
    return dataset()
        .map(d -> hotels.findByRegionAndActiveTrueOrderByOrd(d.getRegion()))
        .orElse(List.of())
        .stream()
        .map(Hotel::getId)
        .collect(java.util.stream.Collectors.toUnmodifiableSet());
  }

  public long hotelCount() {
    return dataset().map(d -> hotels.countByRegionAndActiveTrue(d.getRegion())).orElse(0L);
  }

  /** Отели в старом формате (видимые категории номеров) — для перенесённого подбора. */
  public List<JsonNode> legacyHotels() {
    Optional<Dataset> dataset = dataset();
    if (dataset.isEmpty()) return List.of();
    Instant now = clock.instant();
    return hotels.findByRegionAndActiveTrueOrderByOrd(dataset.get().getRegion()).stream()
        .map(h -> (JsonNode) hotelNode(h, now, dataset.get().isDemoPolicy()))
        .toList();
  }

  /** Один отель в старом формате; {@code allRooms} — без фильтра подтверждённых категорий. */
  public Optional<ObjectNode> legacyHotel(String id, boolean allRooms) {
    Optional<Dataset> dataset = dataset();
    if (dataset.isEmpty()) return Optional.empty();
    Instant now = clock.instant();
    return hotels
        .findByIdAndActiveTrue(id)
        .filter(h -> h.getRegion().equals(dataset.get().getRegion()))
        .map(
            h -> {
              if (!allRooms) return hotelNode(h, now, dataset.get().isDemoPolicy());
              ObjectNode node = (ObjectNode) read(h.getBody());
              node.set("rooms", json.valueToTree(h.getRooms().stream().map(r -> read(r.getBody())).toList()));
              return node;
            });
  }

  /** {@code GET /api/catalog} без поля mode (его добавляет контроллер). */
  public ObjectNode catalog() {
    Dataset dataset = dataset().orElseThrow(() -> new IllegalStateException("Набор данных не загружен"));
    Instant now = clock.instant();
    ObjectNode result = (ObjectNode) read(dataset.getBody());
    ArrayNode list = result.putArray("hotels");
    for (Hotel hotel : hotels.findByRegionAndActiveTrueOrderByOrd(dataset.getRegion()))
      list.add(hotelNode(hotel, now, dataset.isDemoPolicy()));
    result.put("evidencePolicy", dataset.getEvidencePolicy());
    return result;
  }

  /** Карточка отеля и допустимые факты в старом формате; вопросы добавляет контроллер. */
  public Optional<ObjectNode> hotel(String id) {
    Optional<Dataset> dataset = dataset();
    if (dataset.isEmpty()) return Optional.empty();
    boolean demo = dataset.get().isDemoPolicy();
    Instant now = clock.instant();
    return hotels
        .findByIdAndActiveTrue(id)
        .filter(h -> h.getRegion().equals(dataset.get().getRegion()))
        .map(
            hotel -> {
              ObjectNode result = json.createObjectNode();
              result.set("hotel", hotelNode(hotel, now, demo));
              ArrayNode facts = result.putArray("facts");
              for (Evidence e : knowledge.legacyFacts(id, now, demo)) facts.add(read(e.getRaw()));
              return result;
            });
  }

  private ObjectNode hotelNode(Hotel hotel, Instant now, boolean demo) {
    ObjectNode node = (ObjectNode) read(hotel.getBody());
    List<JsonNode> rooms = hotel.getRooms().stream().map(r -> read(r.getBody())).toList();
    // Keep collection history visible even when current room evidence has expired.
    node.put("hasCollectedRoomCategories", rooms.stream().anyMatch(room ->
        room.path("evidenceStatus").asText().equals("verified")
            && room.path("scope").asText().equals("room_category")));
    node.set(
        "rooms",
        json.valueToTree(RoomPolicy.visible(hotel.getId(), rooms, now, demo, json)));
    return node;
  }

  private JsonNode read(String text) {
    try {
      return json.readTree(text);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
