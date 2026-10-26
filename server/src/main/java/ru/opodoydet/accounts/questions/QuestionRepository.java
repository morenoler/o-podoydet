package ru.opodoydet.accounts.questions;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.util.List;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.shared.Json;

public final class QuestionRepository {
  private final AccountDatabase db;
  private static final String SELECT =
      "SELECT q.id,q.listing_id AS listingId,l.title AS listingTitle,q.user_id AS userId,u.name AS"
          + " guestName,q.text,q.answer,q.created_at AS createdAt,q.answered_at AS answeredAt,CASE"
          + " WHEN q.answer IS NULL THEN 'open' ELSE 'answered' END AS status FROM"
          + " account_questions q JOIN account_listings l ON l.id=q.listing_id JOIN account_users u"
          + " ON u.id=q.user_id ";

  public QuestionRepository(AccountDatabase db) {
    this.db = db;
  }

  public ObjectNode find(String id) throws SQLException {
    return db.one(SELECT + "WHERE q.id=?", id);
  }

  public List<ObjectNode> user(String id) throws SQLException {
    return db.rows(SELECT + "WHERE q.user_id=? ORDER BY q.created_at DESC", id);
  }

  public List<ObjectNode> host(String id) throws SQLException {
    return db.rows(SELECT + "WHERE l.host_id=? ORDER BY q.created_at DESC", id);
  }

  public List<ObjectNode> published(String id) throws SQLException {
    return db
        .rows(
            SELECT + "WHERE q.listing_id=? AND q.answer IS NOT NULL ORDER BY q.created_at DESC", id)
        .stream()
        .map(
            row -> {
              row.put("userId", "");
              row.put("guestName", Json.str(row, "guestName").split("\\s+")[0]);
              return row;
            })
        .toList();
  }

  public void insert(String id, String listing, String user, String text, String now)
      throws SQLException {
    db.execute(
        "INSERT INTO account_questions(id,listing_id,user_id,text,created_at) VALUES(?,?,?,?,?)",
        id,
        listing,
        user,
        text,
        now);
  }

  public void answer(String id, String answer, String now) throws SQLException {
    db.execute("UPDATE account_questions SET answer=?,answered_at=? WHERE id=?", answer, now, id);
  }
}
