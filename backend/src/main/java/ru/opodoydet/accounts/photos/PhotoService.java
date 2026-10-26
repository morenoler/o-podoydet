package ru.opodoydet.accounts.photos;

import java.io.IOException;
import java.io.InputStream;
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
import tools.jackson.databind.JsonNode;

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

  public JsonNode upload(InputStream input, String contentType, String length, String owner)
      throws IOException, SQLException {
    String mime =
        contentType == null ? "" : contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
    if (!Set.of("image/jpeg", "image/png").contains(mime))
      throw new AccountProblem(415, "Загрузите фотографию в формате JPEG или PNG.");
    if (length != null) {
      try {
        if (Long.parseLong(length) > MAX_BYTES) throw tooLarge();
      } catch (NumberFormatException e) {
        throw new AccountProblem(400, "Некорректный размер файла.");
      }
    }
    if (!processors.tryAcquire())
      throw new AccountProblem(
          429, "Фотографии обрабатываются. Повторите загрузку через несколько секунд.");
    try {
      byte[] source = input.readNBytes(MAX_BYTES + 1);
      if (source.length > MAX_BYTES) throw tooLarge();
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

  public record Asset(Path file, String mime, long size) {}

  public Asset resolve(String url, JsonNode user) throws IOException, SQLException {
    if (!UploadedPhotoRepository.isUploadUrl(url)) throw notFound();
    var photo = repository.find(url);
    if (photo == null
        || !((user != null && Json.str(user, "id").equals(Json.str(photo, "ownerId")))
            || repository.published(url))) throw notFound();
    Path file = root.resolve(url.substring("/uploads/".length())).normalize();
    if (!file.startsWith(root)
        || !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)
        || !file.toRealPath().getParent().equals(root.toRealPath().resolve("listings")))
      throw notFound();
    return new Asset(file, Json.str(photo, "mime"), Files.size(file));
  }

  private static AccountProblem tooLarge() {
    return new AccountProblem(413, "Размер фотографии не должен превышать 8 МиБ.");
  }

  private static AccountProblem notFound() {
    return new AccountProblem(404, "Фотография не найдена.");
  }
}
