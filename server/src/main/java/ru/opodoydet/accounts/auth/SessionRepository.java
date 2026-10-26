package ru.opodoydet.accounts.auth;

import java.sql.SQLException;
import java.time.Instant;
import ru.opodoydet.accounts.persistence.AccountDatabase;

public final class SessionRepository {
  private final AccountDatabase db;

  public SessionRepository(AccountDatabase db) {
    this.db = db;
  }

  public String user(String token) throws SQLException {
    var result =
        db.one(
            "SELECT user_id FROM account_sessions WHERE token_hash=? AND expires_at>?",
            Passwords.digest(token),
            Instant.now().toString());
    return result == null ? null : result.path("user_id").asText();
  }

  public void save(String token, String id, Instant expires) throws SQLException {
    db.execute("DELETE FROM account_sessions WHERE expires_at<=?", Instant.now().toString());
    db.execute(
        "INSERT INTO account_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
        Passwords.digest(token),
        id,
        expires.toString());
  }

  public void remove(String token) throws SQLException {
    db.execute("DELETE FROM account_sessions WHERE token_hash=?", Passwords.digest(token));
  }
}
