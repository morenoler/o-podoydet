package ru.opodoydet.advisor;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Consumer;
import ru.opodoydet.shared.Json;

/** A bounded JSON-lines bridge. Python receives neither a shell nor unrelated API credentials. */
public final class PythonWorker implements AdvisorService.Worker {
  private static final int MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
  private static final int MAX_LINE_BYTES = 256 * 1024;
  private static final List<String> CONFIG_KEYS =
      List.of("AI_PROVIDER", "ADVISOR_LOCAL_MODEL", "ADVISOR_LOCAL_BASE_URL");
  private static final List<String> DEEPSEEK_KEYS = List.of("DEEPSEEK_API_KEY", "DEEPSEEK_MODEL",
      "DEEPSEEK_BASE_URL", "DEEPSEEK_TIMEOUT_SECONDS", "DEEPSEEK_MAX_TOKENS");
  private final Map<String, String> configuration;
  private final Duration timeout;

  public PythonWorker(Map<String, String> configuration) {
    this(configuration, Duration.ofSeconds(420));
  }

  PythonWorker(Map<String, String> configuration, Duration timeout) {
    this.configuration = Map.copyOf(configuration);
    this.timeout = timeout;
  }

  @Override
  public ObjectNode execute(JsonNode context, String mode, Consumer<ObjectNode> progress)
      throws Exception {
    if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
    // Capture/validate the explicit run mode before crossing the asynchronous process boundary.
    new ru.opodoydet.application.ProviderSelection(configuration).environmentFor(mode);
    ProcessBuilder builder =
        new ProcessBuilder(
            configuration.getOrDefault("ADVISOR_PYTHON", "python"), "-u", "-m", "agents.worker");
    builder.directory(java.nio.file.Path.of(configuration.getOrDefault("ADVISOR_ROOT", ".")).toFile());
    Map<String, String> inherited = Map.copyOf(builder.environment());
    builder.environment().clear();
    // Python and Windows need these OS paths. Provider keys are explicitly scoped below.
    inherited.forEach(
        (key, value) -> {
          if (List.of(
                  "PATH",
                  "SYSTEMROOT",
                  "WINDIR",
                  "TEMP",
                  "TMP",
                  "HOME",
                  "USERPROFILE",
                  "LOCALAPPDATA",
                  "APPDATA",
                  "LANG",
                  "LC_ALL",
                  "PATHEXT")
              .contains(key.toUpperCase())) builder.environment().put(key, value);
        });
    for (String key : CONFIG_KEYS)
      if (configuration.containsKey(key)) builder.environment().put(key, configuration.get(key));
    builder.environment().put("AI_PROVIDER", mode);
    if (mode.equals("deepseek"))
      for (String key : DEEPSEEK_KEYS)
        if (configuration.containsKey(key)) builder.environment().put(key, configuration.get(key));
    builder.environment().put("PYTHONIOENCODING", "utf-8");
    builder.environment().put("PYTHONUTF8", "1");
    builder.redirectError(ProcessBuilder.Redirect.DISCARD);
    Process process = builder.start();
    FutureTask<ObjectNode> result =
        new FutureTask<>(
            () -> {
              try (var input = process.getOutputStream()) {
                input.write(
                    (Json.write(Json.obj("context", context, "mode", mode)) + "\n")
                        .getBytes(StandardCharsets.UTF_8));
              }
              ObjectNode output = read(process.getInputStream(), progress);
              if (process.waitFor() != 0) throw new IOException("Python worker failed");
              return output;
            });
    Thread reader = Thread.ofVirtual().name("advisor-python-reader").start(result);
    try {
      return result.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
    } catch (ExecutionException error) {
      if (error.getCause() instanceof Exception cause) throw cause;
      throw new IOException("Python worker failed");
    } catch (TimeoutException error) {
      throw new IOException("Advisor deadline exceeded");
    } finally {
      process.descendants().forEach(ProcessHandle::destroyForcibly);
      process.destroyForcibly();
      result.cancel(true);
      reader.interrupt();
    }
  }

  private static ObjectNode read(InputStream input, Consumer<ObjectNode> progress)
      throws IOException {
    int total = 0;
    ByteArrayOutputStream line = new ByteArrayOutputStream();
    ObjectNode result = null;
    int value;
    while ((value = input.read()) != -1) {
      if (++total > MAX_OUTPUT_BYTES) throw new IOException("Worker output limit exceeded");
      if (value != '\n') {
        if (line.size() >= MAX_LINE_BYTES) throw new IOException("Worker line limit exceeded");
        line.write(value);
        continue;
      }
      String text = line.toString(StandardCharsets.UTF_8).trim();
      line.reset();
      if (text.isEmpty()) continue;
      JsonNode message = Json.read(text);
      if (!message.isObject()) throw new IOException("Invalid worker envelope");
      if (Json.str(message, "type").equals("error")) throw new IOException("Python worker failed");
      if (result != null || !message.path("data").isObject())
        throw new IOException("Invalid worker result");
      switch (Json.str(message, "type")) {
        case "progress" -> progress.accept((ObjectNode) message.path("data"));
        case "result" -> result = (ObjectNode) message.path("data");
        default -> throw new IOException("Unknown worker event");
      }
    }
    if (line.size() != 0 || result == null) throw new IOException("Incomplete worker result");
    return result;
  }
}
