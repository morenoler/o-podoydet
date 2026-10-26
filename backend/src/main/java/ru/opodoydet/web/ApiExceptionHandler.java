package ru.opodoydet.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.NoHandlerFoundException;
import ru.opodoydet.accounts.AccountProblem;
import ru.opodoydet.shared.Json;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;

@RestControllerAdvice
public class ApiExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

  @ExceptionHandler(ApiProblem.class)
  ResponseEntity<JsonNode> api(ApiProblem problem) {
    return error(problem.status(), problem.getMessage());
  }

  @ExceptionHandler(AccountProblem.class)
  ResponseEntity<JsonNode> account(AccountProblem problem) {
    return error(problem.status, problem.getMessage());
  }

  @ExceptionHandler(IllegalArgumentException.class)
  ResponseEntity<JsonNode> invalid(IllegalArgumentException problem) {
    return error(400, problem.getMessage() == null ? "Некорректный запрос" : problem.getMessage());
  }

  @ExceptionHandler({HttpMessageNotReadableException.class, JacksonException.class})
  ResponseEntity<JsonNode> json(Exception problem) {
    return error(400, "Некорректный JSON");
  }

  @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
  ResponseEntity<JsonNode> media(Exception problem) {
    return error(415, "Неподдерживаемый формат запроса.");
  }

  @ExceptionHandler({HttpRequestMethodNotSupportedException.class, NoHandlerFoundException.class})
  ResponseEntity<JsonNode> missing(Exception problem) {
    return error(404, "Метод не найден");
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<JsonNode> unexpected(Exception problem) {
    log.error("Request failed: {}", problem.getClass().getSimpleName());
    return error(500, "Не удалось выполнить действие. Повторите запрос.");
  }

  private static ResponseEntity<JsonNode> error(int status, String message) {
    return ResponseEntity.status(status)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Json.obj("error", message));
  }
}
