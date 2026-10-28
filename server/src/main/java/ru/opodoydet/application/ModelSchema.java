package ru.opodoydet.application;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashSet;
import java.util.Set;
import java.util.function.Predicate;
import ru.opodoydet.shared.Json;

/** Supported JSON Schema subset. Unsupported contracts fail before the request. */
public final class ModelSchema {
  private ModelSchema() {}
  public static Predicate<JsonNode> compile(JsonNode schema) { return compile(schema, 0); }

  private static Predicate<JsonNode> compile(JsonNode s, int depth) {
    if (!s.isObject() || depth > 32) throw invalid();
    if (s.has("anyOf")) {
      if (s.size() != 1 || !s.path("anyOf").isArray() || s.path("anyOf").isEmpty()) throw invalid();
      var branches = Json.list(s.path("anyOf")).stream().map(v -> compile(v, depth + 1)).toList();
      return v -> branches.stream().anyMatch(p -> p.test(v));
    }
    String type = Json.str(s, "type");
    Set<String> allowed = switch (type) {
      case "object" -> Set.of("type", "properties", "required", "additionalProperties");
      case "array" -> Set.of("type", "items", "minItems", "maxItems");
      case "string", "integer", "number", "boolean", "null" -> Set.of("type", "enum");
      default -> throw invalid();
    };
    s.fieldNames().forEachRemaining(k -> { if (!allowed.contains(k)) throw invalid(); });
    Predicate<JsonNode> check;
    if (type.equals("object")) {
      JsonNode properties = s.has("properties") ? s.get("properties") : Json.obj();
      if (!properties.isObject() || (s.has("required") && !s.get("required").isArray())
          || (s.has("additionalProperties") && !s.get("additionalProperties").isBoolean())) throw invalid();
      var fields = new java.util.LinkedHashMap<String, Predicate<JsonNode>>();
      properties.properties().forEach(e -> fields.put(e.getKey(), compile(e.getValue(), depth + 1)));
      var required = new HashSet<String>();
      for (JsonNode key : s.path("required"))
        if (!key.isTextual() || !fields.containsKey(key.asText()) || !required.add(key.asText())) throw invalid();
      boolean extra = s.path("additionalProperties").asBoolean(true);
      check = v -> v.isObject() && required.stream().allMatch(v::has)
          && (extra || v.properties().stream().allMatch(e -> fields.containsKey(e.getKey())))
          && fields.entrySet().stream().allMatch(e -> !v.has(e.getKey()) || e.getValue().test(v.get(e.getKey())));
    } else if (type.equals("array")) {
      Predicate<JsonNode> item = compile(s.path("items"), depth + 1);
      int low = bound(s, "minItems", 0), high = bound(s, "maxItems", Integer.MAX_VALUE);
      if (low > high) throw invalid();
      check = v -> v.isArray() && v.size() >= low && v.size() <= high && Json.list(v).stream().allMatch(item);
    } else {
      check = switch (type) {
        case "string" -> JsonNode::isTextual;
        case "boolean" -> JsonNode::isBoolean;
        case "integer" -> JsonNode::isIntegralNumber;
        case "number" -> v -> v.isNumber() && Double.isFinite(v.asDouble());
        case "null" -> JsonNode::isNull;
        default -> throw invalid();
      };
    }
    if (s.has("enum")) {
      if (!s.get("enum").isArray() || s.get("enum").isEmpty()) throw invalid();
      var values = Json.list(s.get("enum"));
      if (!values.stream().allMatch(check)) throw invalid();
      check = check.and(values::contains);
    }
    return check;
  }

  private static int bound(JsonNode schema, String key, int fallback) {
    if (!schema.has(key)) return fallback;
    JsonNode value = schema.get(key);
    if (!value.isIntegralNumber() || !value.canConvertToInt() || value.asInt() < 0) throw invalid();
    return value.asInt();
  }
  private static IllegalArgumentException invalid() { return new IllegalArgumentException("Unsupported model JSON Schema"); }
}
