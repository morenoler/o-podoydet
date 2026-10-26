package ru.opodoydet.accounts.auth;

import java.sql.SQLException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.Inputs;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

public final class AuthService {
  private final UserRepository users;
  private final SessionRepository sessions;
  private final String dummyHash = Passwords.hash("unused-account-placeholder");
  private final Map<String, Attempt> attempts = new HashMap<>();

  private record Attempt(Instant since, int count) {}

  public AuthService(AccountDatabase db) {
    users = new UserRepository(db);
    sessions = new SessionRepository(db);
  }

  public record Session(ObjectNode user, String token) {}

  public ObjectNode current(String token) throws SQLException {
    if (token == null) return null;
    String id = sessions.user(token);
    return id == null ? null : users.find(id);
  }

  public ObjectNode require(String token, String role) throws SQLException {
    ObjectNode user = current(token);
    if (user == null) throw new AccountProblem(401, "Войдите в личный кабинет, чтобы продолжить.");
    if (role != null && !Json.str(user, "role").equals(role))
      throw new AccountProblem(
          403,
          role.equals("host")
              ? "Это действие доступно только отельеру."
              : "Это действие доступно только путешественнику.");
    return user;
  }

  public Session register(JsonNode input, String oldToken, String remoteAddress)
      throws SQLException {
    rateLimit(remoteAddress);
    String name = Inputs.text(input, "name", "Имя", 2, 100),
        email = email(input),
        password = password(input);
    String role = Inputs.text(input, "role", "Тип аккаунта", 1, 10);
    if (!Set.of("user", "host").contains(role))
      throw new AccountProblem(400, "Выберите тип аккаунта: путешественник или отельер.");
    String id = UUID.randomUUID().toString();
    try {
      users.create(id, email, Passwords.hash(password), role, name, Instant.now().toString());
    } catch (SQLException error) {
      if (error.getErrorCode() == 19)
        throw new AccountProblem(409, "Аккаунт с этой почтой уже существует. Войдите в него.");
      throw error;
    }
    return new Session(users.find(id), establish(oldToken, id));
  }

  public Session login(JsonNode input, String oldToken, String remoteAddress) throws SQLException {
    rateLimit(remoteAddress);
    String email = email(input);
    JsonNode secret = input.path("password");
    if (!secret.isTextual() || secret.asText().isEmpty() || secret.asText().length() > 128)
      throw new AccountProblem(400, "Введите пароль: не более 128 символов.");
    String password = secret.asText();
    var credentials = users.credentials(email);
    boolean valid =
        Passwords.verify(
            password, credentials == null ? dummyHash : Json.str(credentials, "passwordHash"));
    if (credentials == null || !valid)
      throw new AccountProblem(401, "Почта или пароль не совпадают. Проверьте данные.");
    String id = Json.str(credentials, "id");
    return new Session(users.find(id), establish(oldToken, id));
  }

  public void logout(String token) throws SQLException {
    if (token != null) sessions.remove(token);
  }

  public ObjectNode profile(ObjectNode user, JsonNode input) throws SQLException {
    String name = Inputs.text(input, "name", "Имя", 2, 100),
        phone = Inputs.optional(input, "phone", "Телефон", 40),
        about = Inputs.optional(input, "about", "О себе", 1000);
    if (!phone.isBlank() && !phone.matches("[+0-9() .-]{5,40}"))
      throw new AccountProblem(400, "Проверьте номер телефона: используйте цифры и знак +.");
    users.profile(Json.str(user, "id"), name, phone, about);
    return users.find(Json.str(user, "id"));
  }

  private String establish(String old, String id) throws SQLException {
    if (old != null) sessions.remove(old);
    String token = Passwords.token();
    sessions.save(token, id, Instant.now().plus(30, ChronoUnit.DAYS));
    return token;
  }

  private static String email(JsonNode input) {
    String email = Inputs.text(input, "email", "Почта", 3, 254).toLowerCase(Locale.ROOT);
    if (!email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))
      throw new AccountProblem(400, "Укажите почту в формате name@example.com.");
    return email;
  }

  private static String password(JsonNode input) {
    // Preserve whitespace in passwords; do not silently alter a user's secret.
    JsonNode value = input.path("password");
    if (!value.isTextual() || value.asText().length() < 10 || value.asText().length() > 128)
      throw new AccountProblem(400, "Пароль должен содержать от 10 до 128 символов.");
    return value.asText();
  }

  private synchronized void rateLimit(String remoteAddress) {
    Instant now = Instant.now();
    attempts.entrySet().removeIf(entry -> entry.getValue().since().plusSeconds(300).isBefore(now));
    Attempt previous = attempts.getOrDefault(remoteAddress, new Attempt(now, 0));
    if (previous.count() >= 30)
      throw new AccountProblem(429, "Слишком много попыток. Повторите вход через 5 минут.");
    attempts.put(remoteAddress, new Attempt(previous.since(), previous.count() + 1));
  }
}
