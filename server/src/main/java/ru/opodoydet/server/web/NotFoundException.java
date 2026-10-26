package ru.opodoydet.server.web;

/** 404 с понятным сообщением в формате {@code {"error": "..."}}. */
public class NotFoundException extends RuntimeException {
  public NotFoundException(String message) {
    super(message);
  }
}
