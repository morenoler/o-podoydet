package ru.opodoydet.shared;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;

public final class Json {
  public static final ObjectMapper MAPPER = new ObjectMapper();

  private Json() {}

  public static ObjectNode obj(Object... pairs) {
    ObjectNode result = MAPPER.createObjectNode();
    for (int i = 0; i < pairs.length; i += 2)
      result.set((String) pairs[i], MAPPER.valueToTree(pairs[i + 1]));
    return result;
  }

  public static ArrayNode array(Iterable<? extends Object> items) {
    return MAPPER.valueToTree(items);
  }

  public static List<JsonNode> list(JsonNode node) {
    List<JsonNode> result = new ArrayList<>();
    if (node != null && node.isArray()) node.forEach(result::add);
    return result;
  }

  public static JsonNode read(String text) {
    try {
      return MAPPER.readTree(text);
    } catch (JsonProcessingException e) {
      throw new IllegalArgumentException("Некорректный JSON", e);
    }
  }

  public static String write(Object value) {
    try {
      return MAPPER.writeValueAsString(value);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Не удалось сформировать JSON", e);
    }
  }

  public static String str(JsonNode node, String key) {
    return node.path(key).asText("");
  }
}
