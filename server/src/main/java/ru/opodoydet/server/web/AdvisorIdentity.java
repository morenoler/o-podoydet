package ru.opodoydet.server.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import ru.opodoydet.accounts.auth.AuthService;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;
import ru.opodoydet.shared.Json;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.SQLException;
import java.util.Base64;
import java.util.HexFormat;


/** A browser capability for anonymous history; authenticated history belongs to the account. */
@Component
public final class AdvisorIdentity {
  static final String COOKIE = "op_advisor_visitor";
  private static final SecureRandom RANDOM = new SecureRandom();

  private final AuthService auth;
  private final boolean accounts, secure;

  public AdvisorIdentity(AuthService auth, RuntimeEnv env) {
    this.auth = auth;
    this.accounts = env.accountsEnabled();
    this.secure = "true".equals(env.get("SESSION_COOKIE_SECURE", "false"));
  }

  public String resolve(HttpServletRequest request, HttpServletResponse response) throws SQLException {
    var user = accounts ? auth.current(request) : null;
    if (user != null) return "account:" + Json.str(user, "id");
    String token = cookie(request);
    if (token == null) {
      byte[] bytes = new byte[32];
      RANDOM.nextBytes(bytes);
      token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
      response.addHeader("Set-Cookie", COOKIE + "=" + token
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

  private static String cookie(HttpServletRequest request) {
    String found = null;
    for (String header : java.util.Collections.list(request.getHeaders("Cookie"))) {
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
