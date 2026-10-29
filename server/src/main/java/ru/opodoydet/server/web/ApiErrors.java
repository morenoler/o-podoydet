package ru.opodoydet.server.web;

import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Ошибки в том же формате, что и в старом API: фронт показывает {@code data.error}. */
@RestControllerAdvice
public class ApiErrors {

  private static final Logger log = LoggerFactory.getLogger(ApiErrors.class);

  @ExceptionHandler(IllegalArgumentException.class)
  ResponseEntity<Map<String, String>> badRequest(IllegalArgumentException error) {
    String message = error.getMessage() == null ? "Некорректный запрос" : error.getMessage();
    return ResponseEntity.badRequest().body(Map.of("error", message));
  }

  @ExceptionHandler(NotFoundException.class)
  ResponseEntity<Map<String, String>> notFound(NotFoundException error) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", error.getMessage()));
  }

  @ExceptionHandler({org.springframework.http.converter.HttpMessageNotReadableException.class,
      org.springframework.web.bind.MethodArgumentNotValidException.class})
  ResponseEntity<Map<String, String>> invalidBody(Exception error) {
    // Jackson wraps validation from the DTO creator. Preserve the established client messages.
    for (Throwable cause = error.getCause(); cause != null; cause = cause.getCause())
      if (cause instanceof IllegalArgumentException invalid) return badRequest(invalid);
    String message = error instanceof org.springframework.http.converter.HttpMessageNotReadableException
        ? "Некорректный JSON" : "Некорректные данные запроса";
    return ResponseEntity.badRequest().body(Map.of("error", message));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<Map<String, String>> failure(Exception error) {
    // Ошибки самого Spring MVC (не тот метод, не тот Content-Type и т. п.) сохраняют свой статус.
    if (error instanceof org.springframework.web.ErrorResponse framework)
      return ResponseEntity.status(framework.getStatusCode())
          .body(
              Map.of(
                  "error",
                  framework.getStatusCode().value() == 404
                      ? "Такого адреса нет. Список адресов API: http://127.0.0.1:8080/"
                      : "Некорректный запрос"));
    log.error("Запрос не выполнен", error);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(Map.of("error", "Не удалось выполнить действие. Повторите запрос."));
  }
}
