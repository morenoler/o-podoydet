"""Small, strict API validator. No network calls and no coercion of booleans."""
from datetime import date, datetime
import math
import re
from urllib.parse import urlsplit


class ValidationError(ValueError):
    pass


def number(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValidationError(f"{name} must be a finite number")
    if not low <= value <= high:
        raise ValidationError(f"{name} must be between {low} and {high}")
    return value


def obj(value, name, allowed):
    if not isinstance(value, dict):
        raise ValidationError(f"{name} must be an object")
    extra = set(value) - set(allowed)
    if extra:
        raise ValidationError(f"Unknown {name} fields: {', '.join(sorted(extra))}")


def text(value, name, limit=200):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValidationError(f"{name} must be a non-empty string of at most {limit} characters")
    return value


def coordinates(value, name):
    number(value.get("lat"), name + ".lat", -80, 80)
    number(value.get("lon"), name + ".lon", -179.8, 179.8)


def validate_source(source):
    obj(source, "room.source", {"url", "quote", "retrieved_at"})
    url = urlsplit(text(source.get("url"), "room.source.url", 2000))
    if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password:
        raise ValidationError("room.source.url must be a public source reference, not credentials")
    text(source.get("quote"), "room.source.quote", 1500)
    try:
        value = datetime.fromisoformat(text(source.get("retrieved_at"), "retrieved_at", 60).replace("Z", "+00:00"))
        if value.tzinfo is None:
            raise ValueError()
    except ValueError as error:
        raise ValidationError("retrieved_at must be an ISO timestamp with UTC offset") from error


def validate_window(window):
    fields = {"lat", "lon", "bearing_deg", "horizontal_fov_deg", "vertical_fov_deg", "pitch_deg"}
    obj(window, "room.window", fields)
    limits = {"lat": (-80, 80), "lon": (-179.8, 179.8), "bearing_deg": (0, 359.999999),
              "horizontal_fov_deg": (1, 180),
              "vertical_fov_deg": (1, 160), "pitch_deg": (-80, 80)}
    for key, val in window.items():
        number(val, "room.window." + key, *limits[key])
    if {"lat", "lon"} & window.keys() and not {"lat", "lon"} <= window.keys():
        raise ValidationError("Window coordinates require both lat and lon")


def validate_request(request):
    obj(request, "request", {"hotel", "room", "floor", "ground_floor_number", "floor_height_m", "eye_height_m", "date", "utc_offset_minutes", "radius_m", "data_mode", "scene_id"})
    hotel = request.get("hotel")
    obj(hotel, "hotel", {"id", "name", "lat", "lon"})
    text(hotel.get("id"), "hotel.id")
    if "name" in hotel:
        text(hotel["name"], "hotel.name")
    coordinates(hotel, "hotel")
    ground = number(request.get("ground_floor_number", 1), "ground_floor_number", 0, 1)
    floor = number(request.get("floor"), "floor", ground, 100)
    if int(floor) != floor or int(ground) != ground:
        raise ValidationError("floor and ground_floor_number must be integers")
    if "floor_height_m" in request:
        number(request["floor_height_m"], "floor_height_m", 2, 6)
    if "eye_height_m" in request:
        number(request["eye_height_m"], "eye_height_m", 0.3, 2.5)
    try:
        day = date.fromisoformat(request.get("date", ""))
        if day.isoformat() != request["date"] or not 1901 <= day.year <= 2099:
            raise ValueError()
    except (ValueError, TypeError, KeyError) as error:
        raise ValidationError("date must be YYYY-MM-DD between 1901 and 2099") from error
    offset = number(request.get("utc_offset_minutes"), "utc_offset_minutes", -720, 840)
    if int(offset) != offset:
        raise ValidationError("utc_offset_minutes must be an integer")
    number(request.get("radius_m", 1200), "radius_m", 200, 2000)
    mode = request.get("data_mode", "cached")
    if not isinstance(mode, str) or mode not in {"cached", "live", "fixture"}:
        raise ValidationError("data_mode must be cached, live or fixture")
    if "scene_id" in request and not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,60}", request["scene_id"] if isinstance(request["scene_id"], str) else ""):
        raise ValidationError("scene_id must be a simple identifier")
    if request.get("data_mode") == "fixture" and not request.get("scene_id"):
        raise ValidationError("fixture mode requires scene_id")
    if "room" in request:
        room = request["room"]
        obj(room, "room", {"id", "window", "source"})
        text(room.get("id"), "room.id")
        if "window" in room:
            validate_window(room["window"])
        if "source" in room:
            validate_source(room["source"])
    return request
