package ru.opodoydet.domain;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import ru.opodoydet.shared.Json;

/** A positive condition must hold throughout the stay; one overlapping failure is relevant. */
public final class EvidencePeriod {
  private EvidencePeriod() {}

  public static boolean applies(JsonNode fact, JsonNode trip, Integer threshold) {
    String from = Json.str(fact, "validFrom"), to = Json.str(fact, "validTo");
    if ((fact.hasNonNull("validFrom") && !date(from)) || (fact.hasNonNull("validTo") && !date(to))
        || (!from.isEmpty() && !to.isEmpty() && from.compareTo(to) > 0)) return false;
    JsonNode value = fact.path("value");
    boolean negative = threshold == null
        ? value.isBoolean() && !value.asBoolean()
        : value.isNumber() && Double.isFinite(value.asDouble()) && value.asDouble() > threshold;
    String first = Json.str(trip, "checkIn"), last = Json.str(trip, "checkOut");
    // Inclusive checkout matters for access needed when leaving the accommodation.
    return negative
        ? (from.isEmpty() || from.compareTo(last) <= 0) && (to.isEmpty() || to.compareTo(first) >= 0)
        : (from.isEmpty() || from.compareTo(first) <= 0) && (to.isEmpty() || to.compareTo(last) >= 0);
  }

  private static boolean date(String value) {
    try { return value.matches("\\d{4}-\\d{2}-\\d{2}") && LocalDate.parse(value).toString().equals(value); }
    catch (DateTimeParseException invalid) { return false; }
  }
}
