package ru.opodoydet.accounts.search;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.util.Set;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.Inputs;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.shared.Json;

/** Owner-only source material, deliberately separate from the public listing repository. */
public final class SearchProfileRepository {
  private final AccountDatabase db;

  public SearchProfileRepository(AccountDatabase db) {
    this.db = db;
  }

  public ObjectNode find(String listing) throws SQLException {
    ObjectNode profile =
        db.one(
            "SELECT notes FROM" + " account_listing_search_profiles WHERE listing_id=?", listing);
    if (profile == null) return empty();
    return profile;
  }

  public void save(String listing, ObjectNode profile) throws SQLException {
    db.execute(
        "INSERT INTO account_listing_search_profiles(listing_id,notes)"
            + " VALUES(?,?) ON CONFLICT(listing_id) DO UPDATE SET notes=excluded.notes",
        listing,
        Json.str(profile, "notes"));
  }

  public static ObjectNode empty() {
    return Json.obj("notes", "");
  }

  public static ObjectNode validate(JsonNode input) {
    if (!input.isObject() || !input.has("notes"))
      throw new AccountProblem(400, "Закрытая анкета должна содержать поле заметок.");
    input
        .fieldNames()
        .forEachRemaining(
            key -> {
              if (!Set.of("notes", "floor", "windowDirections").contains(key))
                throw new AccountProblem(400, "Неизвестное поле закрытой анкеты.");
            });
    String notes = Inputs.text(input, "notes", "Сведения для подбора", 0, 6000);
    return Json.obj("notes", notes);
  }
}
