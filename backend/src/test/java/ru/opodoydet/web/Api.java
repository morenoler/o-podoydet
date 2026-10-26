package ru.opodoydet.web;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.springframework.boot.Banner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import ru.opodoydet.Main;
import ru.opodoydet.application.Agents;
import ru.opodoydet.application.AreaAssessmentService;
import ru.opodoydet.persistence.Store;
import tools.jackson.databind.JsonNode;

/** Test fixture only: run existing HTTP contract tests against the real Boot application. */
public final class Api implements AutoCloseable {
  private final Store store;
  private final Agents agents;
  private final Map<String, Object> properties = new HashMap<>();
  private ConfigurableApplicationContext context;

  public Api(Store store, Agents agents, Path dist, Path area, String frontendOrigin, int port)
      throws IOException {
    this(
        store, agents, dist, area, area.resolveSibling("noise-context.json"), frontendOrigin, port);
  }

  public Api(
      Store store, Agents agents, Path dist, Path area, Path noise, String frontendOrigin, int port)
      throws IOException {
    this(
        store,
        agents,
        dist,
        area,
        noise,
        noise.resolveSibling("traffic-ktdb-2024.json"),
        frontendOrigin,
        port);
  }

  public Api(
      Store store,
      Agents agents,
      Path dist,
      Path area,
      Path noise,
      Path traffic,
      String frontendOrigin,
      int port)
      throws IOException {
    this(store, agents, dist, area, noise, traffic, frontendOrigin, port, Map.of());
  }

  public Api(
      Store store,
      Agents agents,
      Path dist,
      Path area,
      Path noise,
      Path traffic,
      String frontendOrigin,
      int port,
      Map<String, String> environment)
      throws IOException {
    this.store = store;
    this.agents = agents;
    properties.putAll(environment);
    properties.put("server.address", "127.0.0.1");
    properties.put("server.port", port);
    properties.put("app.dotenv.enabled", false);
    properties.put("logging.level.root", "ERROR");
    properties.put("spring.main.banner-mode", "off");
    properties.put("DIST_PATH", dist.toAbsolutePath().toString());
    properties.put("AREA_DATA_PATH", area.toAbsolutePath().toString());
    properties.put("NOISE_DATA_PATH", noise.toAbsolutePath().toString());
    properties.put("TRAFFIC_DATA_PATH", traffic.toAbsolutePath().toString());
    properties.put("FRONTEND_ORIGIN", frontendOrigin);
    properties.putIfAbsent("ACCOUNT_MODE", "true");
    properties.putIfAbsent("LAB_MODE", "false");
    properties.putIfAbsent("ADVISOR_LOCAL_MODEL", "");
  }

  public synchronized void start() {
    if (context != null) return;
    SpringApplication application = new SpringApplication(Main.class);
    application.setBannerMode(Banner.Mode.OFF);
    application.setLogStartupInfo(false);
    application.setRegisterShutdownHook(false);
    application.setDefaultProperties(properties);
    application.addInitializers(
        next -> {
          next.getEnvironment()
              .getPropertySources()
              .addFirst(new MapPropertySource("httpContractTest", properties));
          next.getBeanFactory().registerSingleton("store", store);
          next.getBeanFactory().registerSingleton("agents", agents);
        });
    context = application.run();
  }

  public ConfigurableApplicationContext context() {
    start();
    return context;
  }

  public int port() {
    return ((WebServerApplicationContext) context()).getWebServer().getPort();
  }

  public JsonNode assessment(JsonNode hotel, Instant now) throws IOException {
    return context().getBean(AreaAssessmentService.class).assessment(hotel, now);
  }

  @Override
  public synchronized void close() {
    if (context != null) {
      context.close();
      context = null;
    }
  }
}
