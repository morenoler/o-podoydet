package ru.opodoydet.accounts;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.zip.CRC32;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.opodoydet.accounts.photos.PhotoService;
import ru.opodoydet.shared.Json;
import ru.opodoydet.server.support.TestDatabases;
import ru.opodoydet.server.support.TestDatabases.Database;

class PhotoApiTest {
  @TempDir Path temp;
  private static final String PASSWORD = "photo-password-123";

  private static ObjectNode seed() {
    return Json.obj("region", "Пусан", "hotels", List.of(), "facts", List.of());
  }

  private Database server() throws Exception {
    return TestDatabases.start(seed(), Map.of("ACCOUNT_MODE", "true", "DIST_PATH", temp.resolve("dist").toString(),
        "UPLOADS_PATH", temp.resolve("uploads").toString()));
  }

  private static HttpClient browser() {
    return HttpClient.newBuilder()
        .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL))
        .build();
  }

  private static String base(Database api) {
    return "http://127.0.0.1:" + api.port();
  }

  private static HttpResponse<byte[]> call(
      Database api, HttpClient client, String path, byte[] body, String mime, String origin)
      throws Exception {
    var request = HttpRequest.newBuilder(URI.create(base(api) + path));
    if (origin != null) request.header("Origin", origin);
    if (body == null) request.GET();
    else request.header("Content-Type", mime).POST(HttpRequest.BodyPublishers.ofByteArray(body));
    return client.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
  }

  private static JsonNode json(HttpResponse<byte[]> response) {
    return Json.read(new String(response.body(), StandardCharsets.UTF_8));
  }

  private static HttpResponse<byte[]> post(Database api, HttpClient client, String path, JsonNode body)
      throws Exception {
    return call(
        api,
        client,
        path,
        Json.write(body).getBytes(StandardCharsets.UTF_8),
        "application/json",
        base(api));
  }

  private static void register(Database api, HttpClient client, String email, String role)
      throws Exception {
    var result =
        post(
            api,
            client,
            "/api/auth/register",
            Json.obj(
                "name", "Тестовый владелец", "email", email, "password", PASSWORD, "role", role));
    assertEquals(201, result.statusCode(), json(result).toString());
  }

  private static byte[] image(String format, int width, int height) throws Exception {
    var image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
    image.setRGB(0, 0, 0x00ffaa);
    var output = new ByteArrayOutputStream();
    assertTrue(ImageIO.write(image, format, output));
    image.flush();
    return output.toByteArray();
  }

  private static byte[] withPngMetadata(byte[] png, String marker) throws Exception {
    byte[] text = ("Comment\0" + marker).getBytes(StandardCharsets.US_ASCII);
    byte[] chunk = new byte[text.length + 12];
    ByteBuffer.wrap(chunk)
        .putInt(text.length)
        .put("tEXt".getBytes(StandardCharsets.US_ASCII))
        .put(text);
    CRC32 crc = new CRC32();
    crc.update(chunk, 4, text.length + 4);
    ByteBuffer.wrap(chunk).putInt(text.length + 8, (int) crc.getValue());
    var output = new ByteArrayOutputStream();
    output.write(png, 0, 33); // Immediately after IHDR, before pixel data.
    output.write(chunk);
    output.write(png, 33, png.length - 33);
    return output.toByteArray();
  }

  private static ObjectNode listing(String status, List<String> photos) {
    return Json.obj(
        "title",
        "Номер с фотографиями",
        "description",
        "Просторный номер с отдельной ванной комнатой.",
        "city",
        "Пусан",
        "address",
        "Хэундэ 10",
        "roomType",
        "Стандарт",
        "capacity",
        3,
        "sleepingPlaces", 3,
        "beds", List.of(Json.obj("type", "single", "count", 3, "placesPerUnit", 1)),
        "pricePerNight",
        90000,
        "amenities",
        List.of("Wi-Fi"),
        "status",
        status,
        "photos",
        photos,
        "floor",
        3,
        "windowDirections",
        List.of("south"),
        "searchProfile",
        Json.obj("notes", "PRIVATE_NOTES_MUST_NOT_LEAK"));
  }

  private static String upload(Database api, HttpClient host, byte[] bytes, String mime)
      throws Exception {
    var result = call(api, host, "/api/host/photos", bytes, mime, base(api));
    assertEquals(201, result.statusCode(), json(result).toString());
    String url = json(result).path("url").asText();
    assertTrue(url.matches("/uploads/listings/[0-9a-f-]{36}\\.(jpg|png)"));
    return url;
  }

  @Test
  void uploadsRejectUnauthorizedSpoofedOversizedAndInvalidImages() throws Exception {
    try (Database api = server()) {
      var host = browser();
      var guest = browser();
      var anon = browser();
      // Accounts are now enabled on the primary server without LAB_MODE or ACCOUNT_MODE.
      assertTrue(
          json(call(api, anon, "/api/health", null, null, null))
              .path("accountsEnabled")
              .asBoolean());
      assertEquals(404, post(api, anon, "/api/lab/search", Json.obj()).statusCode());
      register(api, host, "host@photo.test", "host");
      register(api, guest, "guest@photo.test", "user");
      byte[] png = image("png", 80, 60);
      assertEquals(
          401, call(api, anon, "/api/host/photos", png, "image/png", base(api)).statusCode());
      assertEquals(
          403, call(api, guest, "/api/host/photos", png, "image/png", base(api)).statusCode());
      assertEquals(
          403,
          call(api, host, "/api/host/photos", png, "image/png", "https://foreign.test")
              .statusCode());
      assertEquals(403, call(api, host, "/api/host/photos", png, "image/png", "null").statusCode());
      assertEquals(
          415, call(api, host, "/api/host/photos", png, "text/plain", base(api)).statusCode());
      assertEquals(
          415, call(api, host, "/api/host/photos", png, "image/jpeg", base(api)).statusCode());
      assertEquals(
          415,
          call(api, host, "/api/host/photos", image("gif", 10, 10), "image/png", base(api))
              .statusCode());
      assertEquals(
          400,
          call(api, host, "/api/host/photos", "<svg/>".getBytes(), "image/png", base(api))
              .statusCode());
      assertEquals(
          400,
          call(api, host, "/api/host/photos", new byte[0], "image/png", base(api)).statusCode());
      var oversized = call(
                  api,
                  host,
                  "/api/host/photos",
                  new byte[PhotoService.MAX_BYTES + 1],
                  "image/png",
                  base(api));
      assertEquals(413, oversized.statusCode());
      assertEquals("close", oversized.headers().firstValue("Connection").orElseThrow());
      assertTrue(json(oversized).path("error").asText().contains("8 МиБ"));
      var chunked =
          HttpRequest.newBuilder(URI.create(base(api) + "/api/host/photos"))
              .header("Origin", base(api))
              .header("Content-Type", "image/png")
              .POST(
                  HttpRequest.BodyPublishers.ofInputStream(
                      () -> new ByteArrayInputStream(new byte[PhotoService.MAX_BYTES + 1])))
              .build();
      assertEquals(413, host.send(chunked, HttpResponse.BodyHandlers.ofByteArray()).statusCode());
      assertEquals(
          400,
          call(api, host, "/api/host/photos", image("png", 12001, 1), "image/png", base(api))
              .statusCode());
      // Oversized pixel dimensions are rejected before allocating the decoded image.
      byte[] giant = png.clone();
      ByteBuffer.wrap(giant).putInt(16, 5000).putInt(20, 5000);
      CRC32 crc = new CRC32();
      crc.update(giant, 12, 17);
      ByteBuffer.wrap(giant).putInt(29, (int) crc.getValue());
      assertEquals(
          400, call(api, host, "/api/host/photos", giant, "image/png", base(api)).statusCode());
      assertFalse(Files.exists(temp.resolve("uploads")));
    }
  }

  @Test
  void sanitizedPhotosRespectOwnershipPublicationOrderAndPersistAcrossRestart() throws Exception {
    String first, second, id;
    try (Database api = server()) {
      var host = browser();
      var otherHost = browser();
      var anon = browser();
      register(api, host, "host@photo.test", "host");
      register(api, otherHost, "other@photo.test", "host");
      String sentinel = "EXIF_GPS_PRIVATE_SOURCE_SENTINEL";
      byte[] source = withPngMetadata(image("png", 3000, 30), sentinel);
      byte[] withTrailer = Arrays.copyOf(source, source.length + sentinel.length());
      System.arraycopy(
          sentinel.getBytes(StandardCharsets.US_ASCII),
          0,
          withTrailer,
          source.length,
          sentinel.length());
      first = upload(api, host, withTrailer, "image/png");
      second = upload(api, host, image("jpeg", 100, 80), "image/jpeg");
      assertTrue(second.endsWith(".jpg"));
      var ownerImage = call(api, host, first, null, null, null);
      assertEquals(200, ownerImage.statusCode());
      var decoded = ImageIO.read(new ByteArrayInputStream(ownerImage.body()));
      assertEquals(2400, decoded.getWidth());
      assertEquals(24, decoded.getHeight());
      assertFalse(new String(ownerImage.body(), StandardCharsets.ISO_8859_1).contains(sentinel));
      assertEquals("image/png", ownerImage.headers().firstValue("Content-Type").orElseThrow());
      assertEquals(
          "nosniff", ownerImage.headers().firstValue("X-Content-Type-Options").orElseThrow());
      assertEquals(
          "private, no-store", ownerImage.headers().firstValue("Cache-Control").orElseThrow());
      assertEquals(404, call(api, anon, first, null, null, null).statusCode());
      assertEquals(404, call(api, otherHost, first, null, null, null).statusCode());
      assertEquals(
          404,
          call(api, host, first.replace("/listings/", "/listings/%2e%2e/"), null, null, null)
              .statusCode());
      assertEquals(
          404,
          call(api, host, "/uploads/listings/../../persist.sqlite3", null, null, null)
              .statusCode());
      assertEquals(
          400,
          post(api, otherHost, "/api/host/listings", listing("published", List.of(first)))
              .statusCode());
      assertEquals(
          400,
          post(
                  api,
                  host,
                  "/api/host/listings",
                  listing(
                      "published",
                      List.of("/uploads/listings/00000000-0000-0000-0000-000000000000.jpg")))
              .statusCode());
      var created = post(api, host, "/api/host/listings", listing("draft", List.of(first, second)));
      assertEquals(201, created.statusCode());
      id = json(created).path("id").asText();
      String path = "/api/host/listings/" + id;
      assertEquals(404, call(api, anon, first, null, null, null).statusCode());
      assertEquals(
          200, post(api, host, path, listing("published", List.of(first, second))).statusCode());
      assertEquals(200, call(api, anon, first, null, null, null).statusCode());
      var head =
          anon.send(
              HttpRequest.newBuilder(URI.create(base(api) + first))
                  .method("HEAD", HttpRequest.BodyPublishers.noBody())
                  .build(),
              HttpResponse.BodyHandlers.ofByteArray());
      assertEquals(200, head.statusCode());
      assertEquals(0, head.body().length);
      assertEquals(
          200, post(api, host, path, listing("published", List.of(second, first))).statusCode());
      ObjectNode legacy = listing("published", List.of());
      legacy.remove("photos");
      var retained = json(post(api, host, path, legacy));
      assertEquals(Json.array(List.of(second, first)), retained.path("photos"));
      var publicListing = json(call(api, anon, "/api/listings/" + id, null, null, null));
      assertFalse(publicListing.has("searchProfile"));
      assertFalse(publicListing.toString().contains("PRIVATE_NOTES"));
      assertEquals(Json.array(List.of(second, first)), publicListing.path("photos"));
      assertEquals(200, post(api, host, path, listing("published", List.of(second))).statusCode());
      assertEquals(404, call(api, anon, first, null, null, null).statusCode());
      assertEquals(200, call(api, host, first, null, null, null).statusCode());
      assertEquals(
          200, post(api, host, path, listing("draft", List.of(second, first))).statusCode());
      assertEquals(404, call(api, anon, second, null, null, null).statusCode());
      assertEquals(200, call(api, host, second, null, null, null).statusCode());
      api.restart();
      host = browser();
      anon = browser();
      assertEquals(
          200,
          post(
                  api,
                  host,
                  "/api/auth/login",
                  Json.obj("email", "host@photo.test", "password", PASSWORD))
              .statusCode());
      JsonNode persisted = json(call(api, host, "/api/host/listings/" + id, null, null, null));
      assertEquals(Json.array(List.of(second, first)), persisted.path("photos"));
      assertEquals(
          "PRIVATE_NOTES_MUST_NOT_LEAK", persisted.path("searchProfile").path("notes").asText());
      assertEquals(200, call(api, host, first, null, null, null).statusCode());
      assertEquals(404, call(api, anon, second, null, null, null).statusCode());
      assertEquals(
          200,
          post(api, host, "/api/host/listings/" + id, listing("published", List.of(second, first)))
              .statusCode());
      assertEquals(200, call(api, anon, first, null, null, null).statusCode());
      assertEquals(2, api.accounts().rows("SELECT * FROM account_uploaded_photos").size());
    }
    try (var files = Files.list(temp.resolve("uploads/listings"))) {
      assertEquals(2, files.count());
    }
  }
}
