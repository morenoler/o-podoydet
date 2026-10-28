package ru.opodoydet.server.accounts;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.accounts.auth.AuthService;
import ru.opodoydet.accounts.shortlists.ShortlistService;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;
import ru.opodoydet.server.web.JsonResponses;
import ru.opodoydet.shared.Json;

@RestController
public class ShortlistController {
  private final AuthService auth;
  private final ShortlistService shortlists;
  private final boolean enabled;
  public ShortlistController(AuthService auth, ShortlistService shortlists, RuntimeEnv env) {
    this.auth = auth; this.shortlists = shortlists; this.enabled = env.accountsEnabled();
  }

  @RequestMapping({"/api/account/shortlist", "/api/account/shortlist/share", "/api/account/shortlist/revoke", "/api/shortlists/{token}"})
  public ResponseEntity<String> handle(HttpServletRequest request) throws IOException, SQLException {
    try {
      if (!enabled) throw new AccountProblem(404, "Метод не найден.");
      String path = request.getRequestURI();
      if (path.startsWith("/api/shortlists/") && request.getMethod().equals("GET"))
        return JsonResponses.send(200, shortlists.shared(path.substring("/api/shortlists/".length())));
      String owner = Json.str(auth.require(request, null), "id");
      if (path.equals("/api/account/shortlist") && request.getMethod().equals("GET"))
        return JsonResponses.send(200, shortlists.get(owner));
      if (!request.getMethod().equals("POST")) throw new AccountProblem(405, "Метод не поддерживается.");
      String contentType = request.getContentType();
      if (contentType == null || !contentType.split(";", 2)[0].trim().equalsIgnoreCase("application/json"))
        throw new AccountProblem(415, "Используйте формат application/json.");
      byte[] bytes = request.getInputStream().readNBytes(262145);
      if (bytes.length > 262144) throw new AccountProblem(413, "Подборка слишком большая.");
      var body = Json.read(new String(bytes, StandardCharsets.UTF_8));
      if (body == null || !body.isObject()) throw new AccountProblem(400, "Ожидается JSON-объект.");
      return JsonResponses.send(200, switch (path) {
        case "/api/account/shortlist" -> shortlists.save(owner, body);
        case "/api/account/shortlist/share" -> shortlists.share(owner, body);
        case "/api/account/shortlist/revoke" -> shortlists.revoke(owner);
        default -> throw new AccountProblem(404, "Метод не найден.");
      });
    } catch (AccountProblem problem) {
      return JsonResponses.send(problem.status, Json.obj("error", problem.getMessage()));
    }
  }
}
