package ru.opodoydet.accounts.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import java.sql.SQLException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.Inputs;
import ru.opodoydet.accounts.persistence.AccountDatabase;
import ru.opodoydet.shared.Json;

public final class AuthService {
  private static final String COOKIE = "op_account_session";
  private final UserRepository users;
  private final SessionRepository sessions;
  private final boolean secureCookie;
  private final String dummyHash = Passwords.hash("unused-account-placeholder");
  private final Map<String, Attempt> attempts = new HashMap<>();

  private record Attempt(Instant since, int count) {}

  public AuthService(AccountDatabase db, boolean secureCookie) {
    users = new UserRepository(db);
    sessions = new SessionRepository(db);
    this.secureCookie = secureCookie;
  }

  public ObjectNode current(HttpExchange exchange) throws SQLException {
    String token = token(exchange);
    if (token == null) return null;
    String id = sessions.user(token);
    return id == null ? null : users.find(id);
  }

  public ObjectNode require(HttpExchange exchange, String role) throws SQLException {
    ObjectNode user = current(exchange);
    if (user == null) throw new AccountProblem(401, "Войдите в личный кабинет, чтобы продолжить.");
    if (role != null && !Json.str(user, "role").equals(role))
      throw new AccountProblem(
          403,
          role.equals("host")
              ? "Это действие доступно только отельеру."
              : "Это действие доступно только путешественнику.");
    return user;
  }

  public ObjectNode register(HttpExchange exchange, JsonNode input) throws SQLException {
    rateLimit(exchange);
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
    establish(exchange, id);
    return users.find(id);
  }

  public ObjectNode login(HttpExchange exchange, JsonNode input) throws SQLException {
    rateLimit(exchange);
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
    establish(exchange, id);
    return users.find(id);
  }

  public void logout(HttpExchange exchange) throws SQLException {
    String token = token(exchange);
    if (token != null) sessions.remove(token);
    exchange
        .getResponseHeaders()
        .add(
            "Set-Cookie",
            COOKIE
                + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
                + (secureCookie ? "; Secure" : ""));
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

  private void establish(HttpExchange exchange, String id) throws SQLException {
    String old = token(exchange);
    if (old != null) sessions.remove(old);
    String token = Passwords.token();
    sessions.save(token, id, Instant.now().plus(30, ChronoUnit.DAYS));
    exchange
        .getResponseHeaders()
        .add(
            "Set-Cookie",
            COOKIE
                + "="
                + token
                + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"
                + (secureCookie ? "; Secure" : ""));
  }

  private static String token(HttpExchange exchange) {
    List<String> headers = exchange.getRequestHeaders().get("Cookie");
    if (headers == null) return null;
    for (String header : headers)
      for (String cookie : header.split(";")) {
        String[] pair = cookie.trim().split("=", 2);
        if (pair.length != 2 || !pair[0].equals(COOKIE)) continue;
        String value = pair[1];
        if (value.startsWith("\"") && value.endsWith("\"") && value.length() >= 2)
          value = value.substring(1, value.length() - 1);
        if (value.matches("[A-Za-z0-9_-]{43}")) return value;
      }
    return null;
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

  private synchronized void rateLimit(HttpExchange exchange) {
    Instant now = Instant.now();
    attempts.entrySet().removeIf(entry -> entry.getValue().since().plusSeconds(300).isBefore(now));
    String key = exchange.getRemoteAddress().getAddress().getHostAddress();
    Attempt previous = attempts.getOrDefault(key, new Attempt(now, 0));
    if (previous.count() >= 30)
      throw new AccountProblem(429, "Слишком много попыток. Повторите вход через 5 минут.");
    attempts.put(key, new Attempt(previous.since(), previous.count() + 1));
  }
}
