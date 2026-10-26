"""Generate the committed, dependency-free OpenAPI document."""
import json
from pathlib import Path


def main():
    number = lambda low, high: {"type": "number", "minimum": low, "maximum": high}
    string = lambda n=200: {"type": "string", "minLength": 1, "maxLength": n}
    obj = lambda fields, required=(): {"type": "object", "additionalProperties": False, "properties": fields, "required": list(required)}
    coord = {"lat": number(-80, 80), "lon": number(-179.8, 179.8)}
    window = obj({**coord, "bearing_deg": number(0, 359.999999), "horizontal_fov_deg": number(1, 180),
                  "vertical_fov_deg": number(1, 160), "pitch_deg": number(-80, 80)})
    source = obj({"url": {**string(2000), "format": "uri"}, "quote": string(1500),
                  "retrieved_at": {**string(60), "format": "date-time"}}, ["url", "quote", "retrieved_at"])
    request = obj({"hotel": obj({"id": string(), "name": string(), **coord}, ["id", "lat", "lon"]),
                   "floor": {"type": "integer", "minimum": 0, "maximum": 100, "description": "Required user floor. Default ground floor is 1; floor 0 requires ground_floor_number=0."},
                   "ground_floor_number": {"type": "integer", "enum": [0, 1], "default": 1},
                   "floor_height_m": number(2, 6), "eye_height_m": number(0.3, 2.5),
                   "room": obj({"id": string(), "window": window, "source": source}, ["id"]),
                   "date": {"type": "string", "format": "date", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", "description": "1901-01-01 through 2099-12-31; civil date at supplied UTC offset."},
                   "utc_offset_minutes": {"type": "integer", "minimum": -720, "maximum": 840},
                   "radius_m": {**number(200, 2000), "default": 1200},
                   "data_mode": {"type": "string", "enum": ["cached", "live", "fixture"], "default": "cached"},
                   "scene_id": {"type": "string", "pattern": "^[a-z0-9][a-z0-9_-]{0,60}$"}},
                  ["hotel", "floor", "date", "utc_offset_minutes"])
    result = {"type": "object", "required": ["status", "visible_in_model", "uncertainties"], "properties": {
        "status": {"enum": ["clear_in_model", "blocked", "outside_fov", "unknown"]},
        "visible_in_model": {"type": ["boolean", "null"]}, "uncertainties": {"type": "array", "items": {"type": "string"}},
        "distance_m": {"type": ["number", "null"]}, "bearing_deg": {"type": ["number", "null"]},
        "elevation_angle_deg": {"type": ["number", "null"]}, "blockers": {"type": "array", "items": {"type": "object"}}}}
    response = {"type": "object", "required": ["schema_version", "hotel", "room_resolution", "assessments", "sources", "limitations", "actual_visibility_confirmed"],
                "properties": {"schema_version": {"const": "1.0"}, "actual_visibility_confirmed": {"const": False},
                 "is_demo": {"type": "boolean"}, "hotel": {"type": "object"},
                 "room_resolution": {"type": "object", "properties": {"scope": {"enum": ["room_window", "hotel_floor_scenarios"]}, "floor": {"type": "object"}, "conflicts": {"type": "array", "items": {"type": "string"}}}},
                 "assessments": {"type": "array", "items": {"type": "object", "properties": {"observer": {"type": "object"}, "targets": {"type": "array", "items": {"$ref": "#/components/schemas/Visibility"}}, "categories": {"type": "object"}, "sun": {"type": "object"}}}},
                 "published_claims": {"type": "array", "items": {"type": "object"}}, "sources": {"type": "array", "items": {"type": "object"}}, "coverage": {"type": "object"}, "limitations": {"type": "array", "items": {"type": "string"}}}}
    responses = {"200": {"description": "Conditional geometric estimates with evidence and unknowns", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/EstimateResponse"}}}}}
    for code, description in {"403": "Network disabled", "413": "Body exceeds 32 KiB or has invalid length", "415": "JSON required", "422": "Invalid input", "429": "Another estimate is running", "502": "Upstream/source error", "503": "Offline cache missing", "500": "Internal error"}.items():
        responses[code] = {"description": description, "content": {"application/json": {"schema": {"type": "object", "properties": {"error": {"type": "string"}, "detail": {"type": "string"}}}}}}
    document = {"openapi": "3.1.0", "info": {"title": "О!Подойдёт Window View API", "version": "0.1.0", "description": "Open-data 2.5D view estimates. Floor is supplied by the caller. Actual room visibility is never asserted."},
                "servers": [{"url": "http://127.0.0.1:8011"}], "paths": {
                    "/health": {"get": {"responses": {"200": {"description": "Service health"}}}},
                    "/v1/scenes": {"get": {"responses": {"200": {"description": "Packaged real/synthetic scene identifiers"}}}},
                    "/v1/regions": {"get": {"responses": {"200": {"description": "Pilot regions, OSM hotel identities and request defaults; floor and date must be supplied"}}}},
                    "/v1/views/estimate": {"post": {"operationId": "estimateWindowView", "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/EstimateRequest"}}}}, "responses": responses}}},
                "components": {"schemas": {"EstimateRequest": request, "EstimateResponse": response, "Visibility": result}}}
    (Path(__file__).parent / "openapi.json").write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
