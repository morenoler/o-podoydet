package ru.opodoydet.accounts.photos;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.sql.SQLException;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.shared.Json;

/** Files live outside frontend builds. Removal from a listing never destroys a pending edit. */
public final class PhotoService {
  public static final int MAX_BYTES = 8 * 1024 * 1024;
  private final UploadedPhotoRepository repository;
  private final Path root;
  private final Semaphore processors = new Semaphore(2);

  public PhotoService(AccountDatabase db, Path root) {
    repository = new UploadedPhotoRepository(db);
    this.root = root.toAbsolutePath().normalize();
  }

  public JsonNode upload(HttpServletRequest ex, String owner) throws IOException, SQLException {
    String contentType = ex.getHeader("Content-Type");
    String mime =
        contentType == null ? "" : contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
    if (!Set.of("image/jpeg", "image/png").contains(mime))
      throw new AccountProblem(415, "Загрузите фотографию в формате JPEG или PNG.");
    String length = ex.getHeader("Content-Length");
    boolean declaredTooLarge = false;
    if (length != null) {
      try {
        declaredTooLarge = Long.parseLong(length) > MAX_BYTES;
      } catch (NumberFormatException e) {
        throw new AccountProblem(400, "Некорректный размер файла.");
      }
    }
    if (!processors.tryAcquire())
      throw new AccountProblem(
          429, "Фотографии обрабатываются. Повторите загрузку через несколько секунд.");
    try {
      // Consume a bounded prefix before replying so fixed-length clients receive the 413.
      byte[] source = ex.getInputStream().readNBytes(MAX_BYTES + 1);
      if (declaredTooLarge || source.length > MAX_BYTES) throw tooLarge();
      var image = ImageSanitizer.sanitize(source, mime);
      String filename = UUID.randomUUID() + "." + image.extension();
      String url = "/uploads/listings/" + filename;
      Files.createDirectories(root);
      Path directory = root.resolve("listings");
      Files.createDirectories(directory);
      // Refuse a redirected listings directory, even when the configured root itself is a mount.
      if (!directory.toRealPath().getParent().equals(root.toRealPath()))
        throw new IOException("Upload directory escapes configured root");
      Path file = directory.resolve(filename);
      Files.write(file, image.bytes(), StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
      try {
        repository.insert(
            url, owner, image.mime(), image.width(), image.height(), image.bytes().length);
      } catch (SQLException | RuntimeException e) {
        Files.deleteIfExists(file);
        throw e;
      }
      return Json.obj("url", url);
    } finally {
      processors.release();
    }
  }

  public void serve(HttpServletRequest ex, HttpServletResponse res, JsonNode user)
      throws IOException, SQLException {
    String raw = ex.getRequestURI();
    String url;
    try {
      url = java.net.URI.create(raw).getPath();
    } catch (IllegalArgumentException invalid) {
      throw notFound();
    }
    if (!Set.of("GET", "HEAD").contains(ex.getMethod())
        || !url.equals(raw)
        || !UploadedPhotoRepository.isUploadUrl(url)) throw notFound();
    var photo = repository.find(url);
    if (photo == null
        || !((user != null && Json.str(user, "id").equals(Json.str(photo, "ownerId")))
            || repository.published(url))) throw notFound();
    Path file = root.resolve(url.substring("/uploads/".length())).normalize();
    if (!file.startsWith(root)
        || !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)
        || !file.toRealPath().getParent().equals(root.toRealPath().resolve("listings")))
      throw notFound();
    res.setStatus(200);
    res.setHeader("Content-Type", Json.str(photo, "mime"));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Content-Disposition", "inline; filename=\"" + file.getFileName() + "\"");
    res.setContentLengthLong(Files.size(file));
    if (!ex.getMethod().equals("HEAD")) Files.copy(file, res.getOutputStream());
  }

  private static AccountProblem tooLarge() {
    return new AccountProblem(413, "Размер фотографии не должен превышать 8 МиБ.");
  }

  private static AccountProblem notFound() {
    return new AccountProblem(404, "Фотография не найдена.");
  }
}
