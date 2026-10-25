package ru.opodoydet.accounts.clarifications;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.util.*;
import ru.opodoydet.accounts.persistence.AccountDatabase;

/** Private dialogues are deliberately unrelated to public account_questions. */
public final class ClarificationRepository {
  private final AccountDatabase db;
  private static final String QUESTIONS = "SELECT q.*,l.title AS listingTitle,l.host_id AS hostId FROM account_clarifications q JOIN account_listings l ON l.id=q.listing_id ";
  private static final String ANSWERS = "SELECT a.*,q.listing_id,q.feature,q.version AS current_version FROM account_clarification_answers a JOIN account_clarifications q ON q.id=a.clarification_id ";

  public ClarificationRepository(AccountDatabase db) { this.db = db; }
  public ObjectNode find(String id) throws SQLException { return db.one(QUESTIONS + "WHERE q.id=?", id); }
  public List<ObjectNode> user(String user) throws SQLException {
    return db.rows(QUESTIONS + "WHERE q.user_id=? ORDER BY q.created_at DESC,q.id", user);
  }
  public List<ObjectNode> host(String host) throws SQLException {
    return db.rows(QUESTIONS + "WHERE l.host_id=? ORDER BY q.created_at DESC,q.id", host);
  }
  public ObjectNode askReplay(String user, String key) throws SQLException {
    return db.one(QUESTIONS + "WHERE q.user_id=? AND q.request_key=?", user, key);
  }
  public ObjectNode answerReplay(String host, String key) throws SQLException {
    return db.one(ANSWERS + "WHERE a.host_id=? AND a.request_key=?", host, key);
  }
  public ObjectNode answer(String id) throws SQLException { return db.one(ANSWERS + "WHERE a.id=?", id); }
  public List<ObjectNode> history(String question) throws SQLException {
    return db.rows(ANSWERS + "WHERE a.clarification_id=? ORDER BY a.version", question);
  }
  /** Only histories for already authorized questions; chunks respect SQLite parameter limits. */
  public Map<String, List<ObjectNode>> histories(Collection<String> questions) throws SQLException {
    List<String> ids = List.copyOf(new LinkedHashSet<>(questions));
    Map<String, List<ObjectNode>> result = new HashMap<>();
    for (int start = 0; start < ids.size(); start += 400) {
      List<String> chunk = ids.subList(start, Math.min(start + 400, ids.size()));
      String placeholders = String.join(",", Collections.nCopies(chunk.size(), "?"));
      for (ObjectNode row : db.rows(ANSWERS + "WHERE a.clarification_id IN (" + placeholders
          + ") ORDER BY a.clarification_id,a.version", chunk.toArray())) {
        String question = row.path("clarification_id").asText();
        result.computeIfAbsent(question, ignored -> new ArrayList<>()).add(row);
      }
    }
    return result;
  }
  public List<ObjectNode> statements(String listing) throws SQLException {
    return db.rows(ANSWERS + "WHERE q.listing_id=? AND a.version=q.version ORDER BY a.recorded_at,a.id", listing);
  }
}
