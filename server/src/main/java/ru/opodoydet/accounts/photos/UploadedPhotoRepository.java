package ru.opodoydet.accounts.photos;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.time.Instant;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.persistence.AccountDatabase;

/** Ownership and publication references are checked against the same account database. */
public final class UploadedPhotoRepository {
  private final AccountDatabase db;

  public UploadedPhotoRepository(AccountDatabase db) {
    this.db = db;
  }

  public static boolean isUploadUrl(String url) {
    return url.matches(
        "/uploads/listings/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png)");
  }

  public void insert(String url, String owner, String mime, int width, int height, long size)
      throws SQLException {
    db.execute(
        "INSERT INTO account_uploaded_photos(url,owner_id,mime,width,height,byte_size,created_at)"
            + " VALUES(?,?,?,?,?,?,?)",
        url,
        owner,
        mime,
        width,
        height,
        size,
        Instant.now().toString());
  }

  public ObjectNode find(String url) throws SQLException {
    return db.one(
        "SELECT url,owner_id AS ownerId,mime,width,height,byte_size AS byteSize FROM"
            + " account_uploaded_photos WHERE url=?",
        url);
  }

  public boolean published(String url) throws SQLException {
    return db.one(
            "SELECT l.id FROM account_listings l WHERE l.status='published' AND EXISTS (SELECT 1"
                + " FROM jsonb_array_elements_text(l.photos::jsonb) p WHERE p = ?) LIMIT 1",
            url)
        != null;
  }

  public void requireOwnership(String owner, JsonNode photos) throws SQLException {
    for (JsonNode photo : photos) {
      String url = photo.asText();
      if (isUploadUrl(url)
          && db.one(
                  "SELECT url FROM account_uploaded_photos WHERE url=? AND owner_id=?", url, owner)
              == null)
        throw new AccountProblem(400, "Можно использовать только фотографии, загруженные вами.");
    }
  }
}
