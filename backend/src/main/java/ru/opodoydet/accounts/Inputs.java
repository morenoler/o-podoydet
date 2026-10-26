package ru.opodoydet.accounts;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import tools.jackson.databind.JsonNode;

public final class Inputs {
  private Inputs() {}

  public static String text(JsonNode data, String key, String label, int min, int max) {
    JsonNode node = data.path(key);
    if (!node.isTextual()) throw new AccountProblem(400, "Заполните поле «" + label + "».");
    String value = node.asText().trim();
    if (value.length() < min || value.length() > max)
      throw new AccountProblem(
          400, "Поле «" + label + "»: от " + min + " до " + max + " символов.");
    return value;
  }

  public static String optional(JsonNode data, String key, String label, int max) {
    return data.has(key) ? text(data, key, label, 0, max) : "";
  }

  public static int integer(JsonNode data, String key, String label, int min, int max) {
    JsonNode value = data.path(key);
    if (!value.isIntegralNumber()
        || !value.canConvertToInt()
        || value.asInt() < min
        || value.asInt() > max)
      throw new AccountProblem(
          400, "Поле «" + label + "»: целое число от " + min + " до " + max + ".");
    return value.asInt();
  }

  public static LocalDate date(JsonNode data, String key, String label) {
    String value = text(data, key, label, 10, 10);
    try {
      if (!value.matches("\\d{4}-\\d{2}-\\d{2}"))
        throw new DateTimeParseException("date", value, 0);
      return LocalDate.parse(value);
    } catch (DateTimeParseException e) {
      throw new AccountProblem(400, "Проверьте поле «" + label + "».");
    }
  }
}
