package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.FileTime;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import ru.opodoydet.shared.Json;

/** A saved source is parsed once per file revision. Failed revisions never reuse old evidence. */
final class SavedJsonSource {
  private static final Logger log = LoggerFactory.getLogger(SavedJsonSource.class);
  private final Path path;
  private Revision revision;
  private JsonNode data = Json.obj();
  private String diagnostic;

  private record Revision(FileTime modified, long size, Object fileKey) {}

  SavedJsonSource(Path path) { this.path = path.toAbsolutePath().normalize(); }

  synchronized JsonNode read() {
    try {
      BasicFileAttributes attributes = Files.readAttributes(path, BasicFileAttributes.class);
      if (!attributes.isRegularFile()) throw new IOException("ожидался обычный файл");
      Revision current = new Revision(attributes.lastModifiedTime(), attributes.size(), attributes.fileKey());
      if (current.equals(revision)) return data;
      revision = current;
      JsonNode parsed;
      try (var input = Files.newInputStream(path)) {
        parsed = Json.MAPPER.reader()
            .with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .readTree(input);
      }
      if (parsed == null || !parsed.isObject()) throw new IOException("ожидался JSON-объект");
      data = parsed;
      diagnostic = null;
    } catch (IOException | SecurityException error) {
      data = Json.obj();
      String message = "Источник " + path.getFileName() + " недоступен или повреждён; связанные условия неизвестны.";
      if (!Objects.equals(diagnostic, message)) log.warn("{} ({})", message, error.toString());
      diagnostic = message;
      // A missing file must be rechecked; a malformed unchanged revision need not be reparsed.
      if (!(error instanceof com.fasterxml.jackson.core.JsonProcessingException)) revision = null;
    }
    return data;
  }

  synchronized String diagnostic() { return diagnostic; }
}
