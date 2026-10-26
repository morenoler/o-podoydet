package ru.opodoydet.web;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.opodoydet.config.AppSettings;

/** Serve the existing Vite build and client-side routes from the embedded server. */
@RestController
public class FrontendController {
  private final Path dist;

  public FrontendController(AppSettings settings) {
    dist = settings.path("DIST_PATH", "dist").toAbsolutePath().normalize();
  }

  @RequestMapping("/api/**")
  public void missingApi() {
    throw new ApiProblem(404, "Метод не найден");
  }

  @RequestMapping({"/", "/**"})
  public ResponseEntity<Resource> file(HttpServletRequest request) throws IOException {
    String requested = request.getServletPath();
    if (requested.startsWith("/api") || requested.startsWith("/uploads/"))
      throw new ApiProblem(404, "Файл не найден");
    if (!request.getMethod().equals("GET") && !request.getMethod().equals("HEAD"))
      throw new ApiProblem(405, "Метод не поддерживается");
    Path path = dist.resolve(requested.replaceFirst("^/+", "")).normalize();
    if (!path.startsWith(dist)) throw new ApiProblem(404, "Файл не найден");
    if (!Files.isRegularFile(path) && !path.getFileName().toString().contains("."))
      path = dist.resolve("index.html");
    if (!Files.isRegularFile(path) || !path.toRealPath().startsWith(dist.toRealPath()))
      throw new ApiProblem(
          404, "Интерфейс не собран. Выполните npm run build либо запустите Vite.");
    String name = path.getFileName().toString();
    String extension = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1) : "";
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
          case "woff" -> "font/woff";
          default -> "application/octet-stream";
        };
    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType(mime))
        .contentLength(Files.size(path))
        .header("Cache-Control", extension.equals("html") ? "no-cache" : "public, max-age=3600")
        .body(new FileSystemResource(path));
  }
}
