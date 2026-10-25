package ru.opodoydet.accounts.persistence;

import java.sql.SQLException;
import java.time.Instant;
import java.util.Set;
import java.util.stream.Collectors;

/** Additive, transactional account-only migrations. They never run on the main catalogue. */
final class AccountMigrations {
  private AccountMigrations() {}

  static void apply(AccountDatabase db) throws SQLException {
    db.transaction(
        () -> {
          if (db.one("SELECT name FROM account_migrations WHERE name='public-listing-details-v2'")
              != null) return null;
          Set<String> columns =
              db.rows("PRAGMA table_info(account_listings)").stream()
                  .map(row -> row.path("name").asText())
                  .collect(Collectors.toSet());
          if (!columns.contains("floor"))
            db.execute(
                "ALTER TABLE account_listings ADD COLUMN floor INTEGER CHECK(floor BETWEEN -3 AND"
                    + " 200)");
          if (!columns.contains("window_directions"))
            db.execute(
                "ALTER TABLE account_listings ADD COLUMN window_directions TEXT NOT NULL DEFAULT"
                    + " '[]'");
          if (!columns.contains("photos"))
            db.execute("ALTER TABLE account_listings ADD COLUMN photos TEXT NOT NULL DEFAULT '[]'");
          // Old private columns remain as a compatibility archive; public columns become
          // authoritative.
          db.execute(
              "UPDATE account_listings SET floor=(SELECT p.floor FROM"
                  + " account_listing_search_profiles p WHERE p.listing_id=account_listings.id),"
                  + " window_directions=COALESCE((SELECT p.window_directions FROM"
                  + " account_listing_search_profiles p WHERE"
                  + " p.listing_id=account_listings.id),'[]') WHERE EXISTS(SELECT 1 FROM"
                  + " account_listing_search_profiles p WHERE p.listing_id=account_listings.id)");
          db.execute(
              "INSERT INTO account_migrations(name,applied_at)"
                  + " VALUES('public-listing-details-v2',?)",
              Instant.now().toString());
          return null;
        });
  }
}
