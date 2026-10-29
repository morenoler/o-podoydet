package ru.opodoydet.server.search;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;
import ru.opodoydet.domain.Validation;
import ru.opodoydet.shared.Json;

/** Public search input. Domain validation also guards the non-HTTP entry points. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SearchRequest(
    @NotBlank @Size(max = 100) String region,
    @NotNull @Pattern(regexp = "\\d{4}-\\d{2}-\\d{2}") String checkIn,
    @NotNull @Pattern(regexp = "\\d{4}-\\d{2}-\\d{2}") String checkOut,
    @Min(1) @Max(6) int adults,
    @Min(0) @Max(4) int children,
    @NotNull @Size(max = 3) List<@Pattern(regexp = "sea|family|quiet") String> scenarios,
    @NotNull @Valid List<Preference> preferences,
    @NotNull @Size(max = 1500) String text,
    @Pattern(regexp = "explore|verified") String admissionMode,
    JsonNode preferenceOverrides,
    JsonNode hotelFilters,
    JsonNode locationWishes,
    JsonNode pendingLocationQuery) {

  public record Preference(@NotBlank String feature, @NotNull Boolean required) {}

  @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
  public static SearchRequest from(JsonNode input) {
    if (input == null || !input.isObject()) throw new IllegalArgumentException("Ожидается JSON-объект");
    // Preserve strict JSON types: Jackson must not coerce "2" or 2.5 into a guest count.
    Validation.trip(input, input.path("region").asText(""));
    return new SearchRequest(input.path("region").textValue(), input.path("checkIn").textValue(),
        input.path("checkOut").textValue(), input.path("adults").intValue(), input.path("children").intValue(),
        Json.list(input.path("scenarios")).stream().map(JsonNode::textValue).toList(),
        Json.list(input.path("preferences")).stream()
            .map(p -> new Preference(p.path("feature").textValue(), p.path("required").booleanValue())).toList(),
        input.path("text").textValue(), input.has("admissionMode") ? input.path("admissionMode").textValue() : null,
        input.get("preferenceOverrides"), input.get("hotelFilters"), input.get("locationWishes"),
        input.get("pendingLocationQuery"));
  }

  public ObjectNode toJson() { return Json.MAPPER.valueToTree(this); }
}
