package ru.opodoydet.server.knowledge;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.util.Locale;
import ru.opodoydet.shared.Json;

/** Conservative independence: copies from one publisher do not become extra witnesses. */
final class SourceIdentity {
  private SourceIdentity() {}

  static String of(Evidence evidence) {
    JsonNode raw;
    try { raw = Json.read(evidence.getRaw()); }
    catch (RuntimeException malformed) { raw = Json.obj(); }
    if (raw == null) raw = Json.obj();
    // Collectors can declare the original source even when sourceUrl points to an aggregator.
    String originalId = raw.path("provenance").path("originalSourceId").asText("");
    if (!originalId.isBlank()) return "origin:" + originalId.strip();
    String originalUrl = raw.path("provenance").path("originalSourceUrl").asText("");
    String publisher = publisher(originalUrl.isBlank() ? evidence.getSourceUrl() : originalUrl);
    if (publisher != null) return "publisher:" + publisher;
    // Multiple dialogues with the same owner, or unattributed agent runs, are not independent.
    return "unattributed:" + evidence.getHotelId() + ":" + evidence.getMethod();
  }

  private static String publisher(String url) {
    if (url == null || url.isBlank()) return null;
    try {
      String host = URI.create(url).getHost();
      if (host == null) return null;
      host = host.toLowerCase(Locale.ROOT).replaceFirst("^www\\.", "");
      if (host.equals("openstreetmap.org") || host.endsWith(".openstreetmap.org")
          || host.equals("overpass-api.de") || host.endsWith(".overpass-api.de")
          || host.equals("overpass.kumi.systems")) return "openstreetmap.org";
      return host;
    } catch (IllegalArgumentException invalid) { return null; }
  }
}
