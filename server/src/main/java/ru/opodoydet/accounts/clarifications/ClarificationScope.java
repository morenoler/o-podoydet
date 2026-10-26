package ru.opodoydet.accounts.clarifications;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.sql.SQLException;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.shared.Json;

/** The listing is a scoped offer, not a verified physical hotel room. */
public final class ClarificationScope {
  private ClarificationScope() {}

  public static String fingerprint(JsonNode listing) {
    return hash(Json.write(Json.obj(
        "city", listing.path("city"), "address", listing.path("address"),
        "roomType", listing.path("roomType"), "capacity", listing.path("capacity"),
        "floor", listing.path("floor"), "windowDirections", listing.path("windowDirections"))));
  }

  public static String fingerprint(JsonNode listing, AccountDatabase db) throws SQLException {
    JsonNode version = db.one("SELECT generation FROM account_listing_scopes WHERE listing_id=?", Json.str(listing, "id"));
    return hash(fingerprint(listing) + ":" + (version == null ? 0 : version.path("generation").asInt()));
  }

  static String hash(String value) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
          .digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }
}
