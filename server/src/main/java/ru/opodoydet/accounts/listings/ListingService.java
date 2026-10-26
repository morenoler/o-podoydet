package ru.opodoydet.accounts.listings;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.clarifications.ClarificationScope;
import ru.opodoydet.accounts.Inputs;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.accounts.photos.UploadedPhotoRepository;
import ru.opodoydet.accounts.search.SearchProfileRepository;
import ru.opodoydet.shared.Json;

public final class ListingService {
  private final ListingRepository repository;
  private final AccountDatabase db;
  private final SearchProfileRepository profiles;
  private final UploadedPhotoRepository photos;

  public ListingService(AccountDatabase db) {
    this.db = db;
    repository = new ListingRepository(db);
    profiles = new SearchProfileRepository(db);
    photos = new UploadedPhotoRepository(db);
  }

  public List<ObjectNode> published() throws SQLException {
    return repository.published();
  }

  public List<ObjectNode> owned(String host) throws SQLException {
    return db.transaction(
        () -> {
          List<ObjectNode> listings = repository.owned(host);
          for (ObjectNode listing : listings)
            listing.set("searchProfile", profiles.find(Json.str(listing, "id")));
          return listings;
        });
  }

  public ObjectNode published(String id) throws SQLException {
    ObjectNode listing = repository.find(id);
    if (listing == null || !Json.str(listing, "status").equals("published"))
      throw new AccountProblem(404, "Объявление не найдено или снято с публикации.");
    return listing;
  }

  public ObjectNode owned(String id, String host) throws SQLException {
    ObjectNode listing = repository.find(id);
    if (listing == null || !Json.str(listing, "hostId").equals(host))
      throw new AccountProblem(404, "Ваше объявление не найдено.");
    listing.set("searchProfile", profiles.find(id));
    return listing;
  }

  public ObjectNode create(String host, JsonNode input) throws SQLException {
    ObjectNode listing = validate(input);
    ObjectNode profile =
        input.has("searchProfile")
            ? SearchProfileRepository.validate(input.path("searchProfile"))
            : SearchProfileRepository.empty();
    ListingDetails.apply(listing, input, null);
    String now = Instant.now().toString();
    listing
        .put("id", UUID.randomUUID().toString())
        .put("hostId", host)
        .put("createdAt", now)
        .put("updatedAt", now);
    return db.transaction(
        () -> {
          photos.requireOwnership(host, listing.path("photos"));
          repository.insert(listing);
          profiles.save(Json.str(listing, "id"), profile);
          return owned(Json.str(listing, "id"), host);
        });
  }

  public ObjectNode update(String host, String id, JsonNode input) throws SQLException {
    ObjectNode listing = validate(input).put("updatedAt", Instant.now().toString());
    ObjectNode profile =
        input.has("searchProfile")
            ? SearchProfileRepository.validate(input.path("searchProfile"))
            : null;
    return db.transaction(
        () -> {
          db.lockListing(id);
          ObjectNode existing = owned(id, host);
          ListingDetails.apply(listing, input, existing);
          photos.requireOwnership(host, listing.path("photos"));
          if (!ClarificationScope.fingerprint(existing).equals(ClarificationScope.fingerprint(listing)))
            db.execute("INSERT INTO account_listing_scopes(listing_id,generation) VALUES(?,1) ON CONFLICT(listing_id) DO UPDATE SET generation=account_listing_scopes.generation+1", id);
          repository.update(id, listing);
          if (profile != null) profiles.save(id, profile);
          return owned(id, host);
        });
  }

  private static ObjectNode validate(JsonNode input) {
    ObjectNode value =
        Json.obj(
            "title",
            Inputs.text(input, "title", "Название", 3, 160),
            "description",
            Inputs.text(input, "description", "Описание", 20, 5000),
            "city",
            Inputs.text(input, "city", "Город", 2, 100),
            "address",
            Inputs.text(input, "address", "Адрес", 3, 250),
            "roomType",
            Inputs.text(input, "roomType", "Тип размещения", 2, 100),
            "capacity",
            Inputs.integer(input, "capacity", "Количество гостей", 1, 20),
            "pricePerNight",
            Inputs.integer(input, "pricePerNight", "Цена за ночь", 1, 100000000),
            "status",
            Inputs.text(input, "status", "Статус", 1, 20));
    if (!Set.of("draft", "published").contains(Json.str(value, "status")))
      throw new AccountProblem(400, "Выберите черновик или публикацию.");
    JsonNode amenities = input.path("amenities");
    if (!amenities.isArray() || amenities.size() > 12)
      throw new AccountProblem(400, "Укажите не более 12 удобств.");
    Set<String> normalized = new LinkedHashSet<>();
    for (JsonNode amenity : amenities) {
      if (!amenity.isTextual() || amenity.asText().isBlank() || amenity.asText().length() > 80)
        throw new AccountProblem(400, "Название удобства должно содержать от 1 до 80 символов.");
      normalized.add(amenity.asText().trim());
    }
    value.set("amenities", Json.array(normalized));
    return value;
  }
}
