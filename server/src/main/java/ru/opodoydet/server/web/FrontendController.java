package ru.opodoydet.server.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.opodoydet.server.config.DomainConfig.RuntimeEnv;
import ru.opodoydet.shared.Json;

/**
 * Раздача собранного фронтенда ({@code dist/}) для {@code npm start}: файлы как есть, остальные
 * пути без расширения — {@code index.html} (маршруты React). Перенос старого Api.staticFile.
 * Если фронтенд не собран, корень показывает список адресов API.
 */
@RestController
public class FrontendController {

  private final Path dist;

  FrontendController(RuntimeEnv env) {
    this.dist = Path.of(env.get("DIST_PATH", "dist")).toAbsolutePath().normalize();
  }

  @RequestMapping("/**")
  public ResponseEntity<String> serve(HttpServletRequest request, HttpServletResponse response)
      throws IOException {
    if (!List.of("GET", "HEAD").contains(request.getMethod()))
      return JsonResponses.send(405, Json.obj("error", "Метод не поддерживается"));
    String requested = request.getRequestURI();
    Path path = dist.resolve(requested.replaceFirst("^/+", "")).normalize();
    if (!path.startsWith(dist)) return JsonResponses.notFound("Файл не найден");
    if (!Files.isRegularFile(path) && !path.getFileName().toString().contains("."))
      path = dist.resolve("index.html");
    if (!Files.isRegularFile(path) || !path.toRealPath().startsWith(dist.toRealPath())) {
      if (requested.equals("/")) return JsonResponses.send(200, index());
      return JsonResponses.notFound("Интерфейс не собран. Выполните npm run build либо запустите Vite.");
    }
    String name = path.getFileName().toString(),
        extension = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1) : "";
    String mime =
        switch (extension) {
          case "html" -> "text/html; charset=utf-8";
          case "js" -> "text/javascript; charset=utf-8";
          case "css" -> "text/css; charset=utf-8";
          case "json" -> "application/json; charset=utf-8";
          case "svg" -> "image/svg+xml";
          case "png" -> "image/png";
          case "jpg", "jpeg" -> "image/jpeg";
          case "woff2" -> "font/woff2";
          default -> "application/octet-stream";
        };
    response.setStatus(200);
    response.setHeader("Content-Type", mime);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", extension.equals("html") ? "no-cache" : "public, max-age=3600");
    response.setContentLengthLong(Files.size(path));
    if (!request.getMethod().equals("HEAD")) Files.copy(path, response.getOutputStream());
    return null;
  }

  private static Map<String, Object> index() {
    Map<String, Object> links = new LinkedHashMap<>();
    links.put("about", "Это API «О!Подойдёт». Сайт в режиме разработки: http://127.0.0.1:3000");
    links.put("health", "/api/health");
    links.put("characteristics", "/api/v2/characteristics");
    links.put("knowledgeExample", "/api/v2/hotels/way-843161717/knowledge");
    links.put("openQuestions", "/api/v2/questions?status=open");
    return links;
  }
}
