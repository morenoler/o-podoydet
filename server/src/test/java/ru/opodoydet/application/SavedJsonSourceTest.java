package ru.opodoydet.application;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.shared.Json;

class SavedJsonSourceTest {
  @TempDir Path directory;

  @Test void unchangedRevisionIsReusedAndReplacementIsLoaded() throws Exception {
    Path file = directory.resolve("source.json");
    Files.writeString(file, "{\"value\":1}");
    SavedJsonSource source = new SavedJsonSource(file);
    var first = source.read();
    assertSame(first, source.read());
    Files.writeString(file, "{\"value\":200}");
    assertEquals(200, source.read().path("value").asInt());
    assertNull(source.diagnostic());
  }

  @Test void missingMalformedAndRecoveredFilesNeverReturnOldEvidence() throws Exception {
    Path file = directory.resolve("source.json");
    SavedJsonSource source = new SavedJsonSource(file);
    assertTrue(source.read().isEmpty());
    assertNotNull(source.diagnostic());
    Files.writeString(file, "{\"verified\":true}");
    assertTrue(source.read().path("verified").asBoolean());
    assertNull(source.diagnostic());
    Files.writeString(file, "invalid JSON");
    assertTrue(source.read().isEmpty());
    assertNotNull(source.diagnostic());
    assertTrue(source.read().isEmpty());
    Files.delete(file);
    assertTrue(source.read().isEmpty());
    Files.writeString(file, "{\"verified\":false}");
    assertFalse(source.read().path("verified").asBoolean(true));
    assertNull(source.diagnostic());
  }

  @Test void apiFreshnessAnnotationsCannotMutateSavedAssessment() throws Exception {
    Path file = directory.resolve("source.json");
    var hotel = Json.obj("id", "h", "coordinates", List.of(129.1, 35.1));
    Files.writeString(file, Json.write(Json.obj("region", "Пусан", "assessments", List.of(
        Json.obj("hotelId", "h", "coordinates", List.of(129.1, 35.1), "airQuality", Json.obj("status", "available"))))));
    Environment environment = new Environment(file, directory.resolve("noise.json"));
    var first = environment.areaAssessment(hotel, "Пусан");
    ((ObjectNode) first.path("airQuality")).put("status", "stale");
    assertEquals("available", environment.areaAssessment(hotel, "Пусан").path("airQuality").path("status").asText());
    assertNull(environment.areaAssessment(hotel, "Сочи"));
    assertNull(environment.areaAssessment(Json.obj("id", "h", "coordinates", List.of(129.2, 35.1)), "Пусан"));
  }
}
