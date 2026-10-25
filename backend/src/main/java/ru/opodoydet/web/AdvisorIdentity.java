package ru.opodoydet.web;

import com.sun.net.httpserver.HttpExchange;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.SQLException;
import java.util.Base64;
import java.util.HexFormat;
import ru.opodoydet.accounts.web.AccountApi;

/** A browser capability for anonymous history; authenticated history belongs to the account. */
final class AdvisorIdentity {
  static final String COOKIE = "op_advisor_visitor";
  private static final SecureRandom RANDOM = new SecureRandom();

  private AdvisorIdentity() {}

  static String resolve(HttpExchange exchange, AccountApi accounts, boolean secure)
      throws SQLException {
    String user = accounts == null ? null : accounts.currentUserId(exchange);
    if (user != null) return "account:" + user;
    String token = cookie(exchange);
    if (token == null) {
      byte[] bytes = new byte[32];
      RANDOM.nextBytes(bytes);
      token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
      exchange.getResponseHeaders().add("Set-Cookie", COOKIE + "=" + token
          + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000" + (secure ? "; Secure" : ""));
    }
    try {
      // The bearer token is never stored, returned in JSON or sent to the model.
      return "visitor:" + HexFormat.of().formatHex(
          MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.US_ASCII)));
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA-256 is unavailable", impossible);
    }
  }

  private static String cookie(HttpExchange exchange) {
    String found = null;
    for (String header : exchange.getRequestHeaders().getOrDefault("Cookie", java.util.List.of())) {
      for (String part : header.split(";")) {
        String[] pair = part.trim().split("=", 2);
        if (pair.length != 2 || !pair[0].equals(COOKIE)) continue;
        String value = pair[1];
        if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\""))
          value = value.substring(1, value.length() - 1);
        if (found != null || !value.matches("[A-Za-z0-9_-]{43}")) return null;
        found = value;
      }
    }
    return found;
  }
}
