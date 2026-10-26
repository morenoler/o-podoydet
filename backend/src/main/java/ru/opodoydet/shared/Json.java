package ru.opodoydet.shared;

import java.util.ArrayList;
import java.util.List;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

public final class Json {
  public static final JsonMapper MAPPER = JsonMapper.builderWithJackson2Defaults().build();

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
    } catch (JacksonException e) {
      throw new IllegalArgumentException("Некорректный JSON", e);
    }
  }

  public static String write(Object value) {
    try {
      return MAPPER.writeValueAsString(value);
    } catch (JacksonException e) {
      throw new IllegalStateException("Не удалось сформировать JSON", e);
    }
  }

  public static String str(JsonNode node, String key) {
    return node.path(key).asText("");
  }
}
