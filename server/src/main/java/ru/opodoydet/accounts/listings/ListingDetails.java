package ru.opodoydet.accounts.listings;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.Inputs;
import ru.opodoydet.accounts.photos.UploadedPhotoRepository;
import ru.opodoydet.shared.Json;

/** Public details, including compatibility with the former private-profile request shape. */
final class ListingDetails {
  private static final Set<String> DIRECTIONS =
      Set.of(
          "north", "north_east", "east", "south_east", "south", "south_west", "west", "north_west");

  private ListingDetails() {}

  static void apply(ObjectNode listing, JsonNode input, JsonNode existing) {
    JsonNode legacy = input.path("searchProfile");
    JsonNode floor = selected(input, legacy, existing, "floor");
    if (floor == null || floor.isMissingNode()) listing.putNull("floor");
    else {
      if (!floor.isNull()) Inputs.integer(Json.obj("floor", floor), "floor", "Этаж", -3, 200);
      listing.set("floor", floor);
    }
    JsonNode directions = selected(input, legacy, existing, "windowDirections");
    listing.set(
        "windowDirections",
        directions == null || directions.isMissingNode()
            ? Json.array(List.of())
            : directions(directions));
    JsonNode photos =
        input.has("photos")
            ? input.path("photos")
            : existing == null ? null : existing.path("photos");
    listing.set(
        "photos",
        photos == null || photos.isMissingNode() ? Json.array(List.of()) : photos(photos));
  }

  private static JsonNode selected(JsonNode input, JsonNode legacy, JsonNode existing, String key) {
    if (input.has(key)) return input.path(key);
    if (legacy.isObject() && legacy.has(key)) return legacy.path(key);
    return existing == null ? null : existing.path(key);
  }

  private static JsonNode directions(JsonNode input) {
    if (!input.isArray() || input.size() > 8)
      throw new AccountProblem(400, "Выберите стороны света из списка.");
    LinkedHashSet<String> values = new LinkedHashSet<>();
    for (JsonNode value : input)
      if (!value.isTextual() || !DIRECTIONS.contains(value.asText()) || !values.add(value.asText()))
        throw new AccountProblem(
            400, "Стороны света должны быть уникальными значениями из списка.");
    return Json.array(values);
  }

  private static JsonNode photos(JsonNode input) {
    if (!input.isArray() || input.size() > 6)
      throw new AccountProblem(400, "Добавьте не более 6 фотографий.");
    LinkedHashSet<String> values = new LinkedHashSet<>();
    for (JsonNode value : input) {
      if (!value.isTextual() || value.asText().isBlank() || value.asText().length() > 2048)
        throw new AccountProblem(400, "Проверьте ссылку на фотографию.");
      String url = value.asText().trim();
      if (!safePhoto(url) || !values.add(url))
        throw new AccountProblem(
            400, "Используйте уникальные фотографии, HTTPS-ссылки или файлы приложения /images/…");
    }
    return Json.array(values);
  }

  private static boolean safePhoto(String url) {
    if (UploadedPhotoRepository.isUploadUrl(url)) return true;
    if (url.contains("\\") || url.chars().anyMatch(Character::isISOControl)) return false;
    try {
      URI uri = URI.create(url);
      if ("https".equalsIgnoreCase(uri.getScheme()))
        return uri.getHost() != null
            && !uri.getHost().isBlank()
            && uri.getRawUserInfo() == null
            && (uri.getPort() == -1 || (uri.getPort() > 0 && uri.getPort() <= 65535));
      if (uri.getScheme() != null
          || uri.getRawAuthority() != null
          || uri.getRawQuery() != null
          || uri.getRawFragment() != null) return false;
      // Only explicit app assets, with no traversal or encoded alternative path spelling.
      if (!url.matches("/images/[A-Za-z0-9_./-]+") || !uri.normalize().getPath().equals(url))
        return false;
      for (String segment : url.split("/"))
        if (segment.equals(".") || segment.equals("..")) return false;
      return !url.endsWith("/");
    } catch (IllegalArgumentException e) {
      return false;
    }
  }
}
