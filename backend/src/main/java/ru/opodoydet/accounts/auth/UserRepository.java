package ru.opodoydet.accounts.auth;

import java.sql.SQLException;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import tools.jackson.databind.node.ObjectNode;

public final class UserRepository {
  private final AccountDatabase db;
  private static final String SELECT =
      "SELECT id,email,role,name,phone,about,created_at AS createdAt FROM account_users ";

  public UserRepository(AccountDatabase db) {
    this.db = db;
  }

  public ObjectNode find(String id) throws SQLException {
    return db.one(SELECT + "WHERE id=?", id);
  }

  public ObjectNode credentials(String email) throws SQLException {
    return db.one(
        "SELECT id,password_hash AS passwordHash FROM account_users WHERE email=?", email);
  }

  public void create(String id, String email, String hash, String role, String name, String created)
      throws SQLException {
    db.execute(
        "INSERT INTO account_users(id,email,password_hash,role,name,created_at)"
            + " VALUES(?,?,?,?,?,?)",
        id,
        email,
        hash,
        role,
        name,
        created);
  }

  public void profile(String id, String name, String phone, String about) throws SQLException {
    db.execute(
        "UPDATE account_users SET name=?,phone=?,about=? WHERE id=?", name, phone, about, id);
  }
}
