package ru.opodoydet.accounts.questions;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.Inputs;
import ru.opodoydet.accounts.listings.ListingService;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.shared.Json;

public final class QuestionService {
  private final QuestionRepository repository;
  private final ListingService listings;

  public QuestionService(AccountDatabase db, ListingService listings) {
    repository = new QuestionRepository(db);
    this.listings = listings;
  }

  public List<ObjectNode> user(String user) throws SQLException {
    return repository.user(user);
  }

  public List<ObjectNode> host(String host) throws SQLException {
    return repository.host(host);
  }

  public List<ObjectNode> published(String listing) throws SQLException {
    listings.published(listing);
    return repository.published(listing);
  }

  public ObjectNode ask(String user, String listing, JsonNode input) throws SQLException {
    listings.published(listing);
    String text = Inputs.text(input, "text", "Вопрос", 3, 2000), id = UUID.randomUUID().toString();
    repository.insert(id, listing, user, text, Instant.now().toString());
    return repository.find(id);
  }

  public ObjectNode answer(String host, String id, JsonNode input) throws SQLException {
    ObjectNode question = repository.find(id);
    if (question == null) throw new AccountProblem(404, "Вопрос не найден.");
    listings.owned(Json.str(question, "listingId"), host);
    repository.answer(id, Inputs.text(input, "answer", "Ответ", 2, 3000), Instant.now().toString());
    return repository.find(id);
  }
}
