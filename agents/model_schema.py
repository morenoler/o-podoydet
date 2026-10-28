"""Fail-closed validation of the JSON Schema subset used by agents.engine.

This is deliberately not a general JSON Schema implementation. Unsupported or
malformed schemas fail before an external request instead of silently weakening
the result contract. Validators never include model output in error messages.
"""

from __future__ import annotations


def compile_schema(schema: dict, depth: int = 0):
    """Return a predicate for object/array/string/null and anyOf advisor schemas."""
    if not isinstance(schema, dict) or not schema or depth > 32:
        raise ValueError("Unsupported schema")
    if "anyOf" in schema:
        branches = schema["anyOf"]
        if set(schema) != {"anyOf"} or not isinstance(branches, list) or not branches:
            raise ValueError("Unsupported anyOf")
        validators = [compile_schema(branch, depth + 1) for branch in branches]
        return lambda value: any(validate(value) for validate in validators)
    kind = schema.get("type")
    allowed = {
        "object": {"type", "properties", "required", "additionalProperties"},
        "array": {"type", "items", "minItems", "maxItems"},
        "string": {"type", "enum"},
        "null": {"type"},
    }
    if not isinstance(kind, str) or kind not in allowed or set(schema) - allowed[kind]:
        raise ValueError("Unsupported schema keyword or type")
    if kind == "null":
        return lambda value: value is None
    if kind == "string":
        values = schema.get("enum")
        if "enum" in schema and (not isinstance(values, list) or not values
                                  or any(not isinstance(value, str) for value in values)):
            raise ValueError("Unsupported enum")
        choices = frozenset(values) if values is not None else None
        return lambda value: isinstance(value, str) and (choices is None or value in choices)
    if kind == "array":
        validate = compile_schema(schema.get("items"), depth + 1)
        low, high = schema.get("minItems", 0), schema.get("maxItems")
        if type(low) is not int or low < 0 or (high is not None and (type(high) is not int or high < low)):
            raise ValueError("Invalid array bounds")
        if "maxItems" in schema and high is None:
            raise ValueError("Invalid array bound")
        return lambda value: (isinstance(value, list) and len(value) >= low
                              and (high is None or len(value) <= high) and all(validate(item) for item in value))
    properties = schema.get("properties", {})
    required = schema.get("required", [])
    extra = schema.get("additionalProperties", True)
    if (not isinstance(properties, dict) or any(not isinstance(key, str) for key in properties)
            or not isinstance(required, list) or any(not isinstance(key, str) for key in required)
            or len(set(required)) != len(required) or set(required) - set(properties)
            or type(extra) is not bool):
        raise ValueError("Unsupported object schema")
    validators = {key: compile_schema(value, depth + 1) for key, value in properties.items()}
    mandatory = frozenset(required)
    return lambda value: (isinstance(value, dict) and mandatory <= value.keys()
                          and (extra or not value.keys() - validators.keys())
                          and all(validate(value[key]) for key, validate in validators.items() if key in value))
