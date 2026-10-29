package ru.opodoydet.server.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockHttpServletRequest;
import ru.opodoydet.application.Environment;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;
import ru.opodoydet.shared.Json;

class PlatformClockTest {
  @TempDir Path temporary;

  @Test
  void areaEndpointUsesTheSameClockAsSearchAndKnowledge() throws Exception {
    Instant now = Instant.parse("2050-05-20T10:00:00Z");
    Path area = temporary.resolve("area.json");
    var coordinates = List.of(129.16, 35.16);
    Files.writeString(area, Json.write(Json.obj("region", "Clock fixture", "assessments", List.of(
        Json.obj("hotelId", "clock-hotel", "coordinates", coordinates, "assessedAt", now.toString(),
            "airQuality", Json.obj("status", "reported", "time", now.toString(),
                "fetchedAt", now.toString()))))));
    Store store = mock(Store.class);
    when(store.region()).thenReturn("Clock fixture");
    when(store.hotel("clock-hotel"))
        .thenReturn(Json.obj("id", "clock-hotel", "coordinates", coordinates));
    RuntimeEnv env = new RuntimeEnv(Map.of("AREA_DATA_PATH", area.toString()));
    var environment = new Environment(area, temporary.resolve("noise.json"));
    var controller = new PlatformController(store, null, environment, null, null, null, null, null, null,
        env, Clock.fixed(now, ZoneOffset.UTC));
    var request = new MockHttpServletRequest("GET", "/api/areas/clock-hotel");
    assertThat(Json.read(controller.area(request).getBody())
        .path("assessment").path("airQuality").path("status").asText()).isEqualTo("reported");

    var later = new PlatformController(store, null, environment, null, null, null, null, null, null,
        env, Clock.fixed(now.plusSeconds(6 * 3600 + 1), ZoneOffset.UTC));
    assertThat(Json.read(later.area(request).getBody())
        .path("assessment").path("airQuality").path("status").asText()).isEqualTo("stale");
  }
}
