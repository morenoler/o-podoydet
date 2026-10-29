package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;

/** Provider transport only; domain validation remains in the caller. */
@FunctionalInterface
public interface StructuredModel {
  JsonNode complete(String instructions, JsonNode input, JsonNode schema)
      throws IOException, InterruptedException;

  default JsonNode completeNamed(String name, String instructions, JsonNode input, JsonNode schema)
      throws IOException, InterruptedException {
    return complete(instructions, input, schema);
  }
}
