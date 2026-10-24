"""Bounded, conservative 2.5D visibility over local polygon prisms.

All geodetic coordinates use [latitude, longitude]. Heights are metres AGL;
elevations are metres above the same sea-level datum. Polygon holes are voids.
Clear means clear only inside this supplied model, not photographic evidence.
Earth curvature uses a sphere and no atmospheric refraction. Terrain is a
nearest-sample discretization, never a claim of field verification.
"""
from __future__ import annotations

import math
from collections import defaultdict

EARTH_RADIUS_M = 6371008.8
ALGORITHM_VERSION = "window_view_los_1.0.0"
MAX_RANGE_M = 50000
MAX_PROFILE_STEPS = 2048
EPS = 1e-7


def _number(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _coordinate(lat, lon):
    if not _number(lat) or not _number(lon) or abs(lat) > 89.9 or abs(lon) > 180:
        raise ValueError("local geometry requires latitude within +/-89.9 and valid longitude")


def project(lat, lon, origin_lat, origin_lon):
    _coordinate(lat, lon)
    _coordinate(origin_lat, origin_lon)
    longitude_delta = (lon - origin_lon + 180) % 360 - 180
    return (EARTH_RADIUS_M * math.radians(longitude_delta) * math.cos(math.radians(origin_lat)),
            EARTH_RADIUS_M * math.radians(lat - origin_lat))


def unproject(x, y, origin_lat, origin_lon):
    _coordinate(origin_lat, origin_lon)
    if not _number(x) or not _number(y):
        raise ValueError("non-finite projected coordinates")
    return (origin_lat + math.degrees(y / EARTH_RADIUS_M),
            (origin_lon + math.degrees(x / (EARTH_RADIUS_M * math.cos(math.radians(origin_lat)))) + 180) % 360 - 180)


def bearing(lat1, lon1, lat2, lon2):
    _coordinate(lat1, lon1)
    _coordinate(lat2, lon2)
    a, b = math.radians(lat1), math.radians(lat2)
    dl = math.radians((lon2 - lon1 + 180) % 360 - 180)
    return math.degrees(math.atan2(math.sin(dl) * math.cos(b),
                                  math.cos(a) * math.sin(b) - math.sin(a) * math.cos(b) * math.cos(dl))) % 360


def _on_segment(p, a, b):
    cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])
    scale = max(1, abs(b[0] - a[0]), abs(b[1] - a[1]))
    return abs(cross) < 1e-10 * scale and min(a[0], b[0]) - 1e-10 <= p[0] <= max(a[0], b[0]) + 1e-10 and min(a[1], b[1]) - 1e-10 <= p[1] <= max(a[1], b[1]) + 1e-10


def _in_ring(p, ring):
    inside = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if _on_segment(p, a, b):
            return True
        if (a[1] > p[1]) != (b[1] > p[1]):
            x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if p[0] < x:
                inside = not inside
    return inside


def point_in_polygon(point, polygon):
    """Outer boundary belongs to polygon; hole boundary belongs to the void."""
    return _in_ring(point, polygon["outer"]) and not any(_in_ring(point, ring) for ring in polygon.get("holes", []))


def _cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def _intervals(vector, polygon):
    """Parameter intervals of segment (0,0)->vector inside a polygon."""
    cuts = [0.0, 1.0]
    length_squared = vector[0] ** 2 + vector[1] ** 2
    for ring in [polygon["outer"], *polygon.get("holes", [])]:
        for a, b in zip(ring, ring[1:] + ring[:1]):
            edge = (b[0] - a[0], b[1] - a[1])
            denominator = _cross(vector, edge)
            if abs(denominator) < 1e-10:
                if abs(_cross(a, vector)) < 1e-8:
                    for p in (a, b):
                        t = (p[0] * vector[0] + p[1] * vector[1]) / length_squared
                        if 0 <= t <= 1:
                            cuts.append(t)
                continue
            t, u = _cross(a, edge) / denominator, _cross(a, vector) / denominator
            if 0 <= t <= 1 and -EPS <= u <= 1 + EPS:
                cuts.append(t)
    cuts = sorted(set(round(t, 12) for t in cuts))
    intervals = []
    for lo, hi in zip(cuts, cuts[1:]):
        if hi - lo > 1e-10 and point_in_polygon((vector[0] * (lo + hi) / 2, vector[1] * (lo + hi) / 2), polygon):
            intervals.append((lo, hi))
    return intervals


class _Terrain:
    def __init__(self, terrain, observer):
        self.data = terrain or {}
        self.flat = self.data.get("flat_elevation_m")
        if not _number(self.flat):
            self.flat = None
        resolution = self.data.get("resolution_m", 90)
        self.resolution = float(resolution) if _number(resolution) and resolution > 0 else 90.0
        self.cell = max(1.0, self.resolution)
        self.grid = defaultdict(list)
        self.invalid = False
        samples = self.data.get("samples", [])
        if len(samples) > 100000:
            raise ValueError("too many terrain samples")
        for sample in samples:
            try:
                x, y = project(sample["lat"], sample["lon"], observer["lat"], observer["lon"])
                h = sample["elevation_m"]
                if not _number(h):
                    raise ValueError("invalid elevation")
                self.grid[(math.floor(x / self.cell), math.floor(y / self.cell))].append((x, y, h))
            except (ValueError, TypeError, KeyError):
                self.invalid = True
        self.present = self.flat is not None or bool(self.grid)

    def elevation(self, x, y):
        if self.flat is not None:
            return self.flat
        cx, cy = math.floor(x / self.cell), math.floor(y / self.cell)
        nearest, best = None, (self.resolution * 0.8) ** 2
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for sx, sy, elevation in self.grid.get((cx + dx, cy + dy), []):
                    distance_squared = (x - sx) ** 2 + (y - sy) ** 2
                    if distance_squared <= best:
                        nearest, best = elevation, distance_squared
        return nearest


def _observer(observer):
    _coordinate(observer["lat"], observer["lon"])
    for key, default, low, high in (("height_agl_m", None, 0, 1000), ("bearing_deg", None, -3600, 3600),
                                   ("horizontal_fov_deg", 90, EPS, 360), ("vertical_fov_deg", 90, EPS, 180),
                                   ("pitch_deg", 0, -90, 90)):
        value = observer.get(key, default)
        if not _number(value) or not low <= value <= high:
            raise ValueError(f"invalid observer {key}")
    ground = observer.get("ground_elevation_m")
    if ground is not None and not _number(ground):
        raise ValueError("invalid observer ground elevation")


def _fov(observer, azimuth, altitude=None):
    delta = abs((azimuth - observer["bearing_deg"] + 180) % 360 - 180)
    if delta > observer.get("horizontal_fov_deg", 90) / 2 + 1e-9:
        return False
    return altitude is None or abs(altitude - observer.get("pitch_deg", 0)) <= observer.get("vertical_fov_deg", 90) / 2 + 1e-9


def _result(status, distance, azimuth, altitude, blockers=None, uncertainties=None):
    return {"status": status, "visible_in_model": True if status == "clear_in_model" else False if status in ("blocked", "outside_fov") else None,
            "distance_m": round(distance, 3), "bearing_deg": round(azimuth, 6),
            "elevation_angle_deg": round(altitude, 6) if altitude is not None else None,
            "blockers": blockers or [], "uncertainties": sorted(set(uncertainties or [])),
            "algorithm_version": ALGORITHM_VERSION}


def _trace(observer, vector, distance, azimuth, altitude, origin_elevation, buildings, terrain):
    profile = _Terrain(terrain, observer)
    uncertainties, blockers = [], []
    if profile.invalid:
        uncertainties.append("invalid_terrain_samples")
    if not profile.present:
        uncertainties.append("terrain_profile_missing")
    if profile.flat is not None:
        uncertainties.append("explicit_flat_terrain_model")
    # Height relative to local ground datum includes Earth curvature.
    slope = math.tan(math.radians(altitude))
    def sight_height(s):
        return origin_elevation + slope * s + s * s / (2 * EARTH_RADIUS_M)
    def span(lo, hi):
        values = [sight_height(lo), sight_height(hi)]
        vertex = -slope * EARTH_RADIUS_M
        if lo < vertex < hi:
            values.append(sight_height(vertex))
        return min(values), max(values)
    excluded = set(observer.get("exclude_building_ids", []))
    if len(buildings) > 10000:
        raise ValueError("too many buildings")
    total_vertices = 0
    for building in buildings:
        building_id = building.get("id", "unknown_building")
        if building_id in excluded:
            continue
        intervals = []
        if not building.get("polygons"):
            uncertainties.append("missing_building_geometry:" + building_id)
        for polygon in building.get("polygons", []):
            try:
                rings = [polygon["outer"], *polygon.get("holes", [])]
                total_vertices += sum(len(r) for r in rings)
                if total_vertices > 200000:
                    raise ValueError("too many polygon vertices")
                if any(len(ring) < 4 or ring[0] != ring[-1] for ring in rings):
                    uncertainties.append("incomplete_building_geometry:" + building_id)
                    continue
                converted = [[project(p[0], p[1], observer["lat"], observer["lon"]) for p in ring] for ring in rings]
                intervals.extend(_intervals(vector, {"outer": converted[0], "holes": converted[1:]}))
            except (KeyError, TypeError, IndexError):
                uncertainties.append("invalid_building_geometry:" + building_id)
        if not intervals:
            continue
        ground = building.get("ground_elevation_m")
        if not _number(ground):
            # Do not transfer observer elevation or sea level onto another building.
            # Sample at the obstruction; centroid terrain can be outside coverage.
            t = (intervals[0][0] + intervals[0][1]) / 2
            ground = profile.elevation(vector[0] * t, vector[1] * t)
        # A known ground elevation is solid earth, not an open space below
        # a floating prism. This remains decisive even when roof height is unknown.
        ground_blocks = False
        if ground is not None:
            for start, end in intervals:
                lo, hi = max(start * distance, 1e-4), min(end * distance, distance - 1e-4)
                if hi > lo and span(lo, hi)[0] < ground - EPS:
                    blockers.append({"id": building_id, "reason": "ground_under_building_intersection", "distance_m": round(lo, 3)})
                    ground_blocks = True
                    break
        if ground_blocks:
            continue
        height = building.get("height_m")
        height_range = building.get("height_range_m")
        if isinstance(height_range, (list, tuple)) and len(height_range) == 2 and all(_number(v) for v in height_range) and 0 <= height_range[0] <= height_range[1]:
            # A nominal number must never erase an explicitly uncertain range.
            low, high = height_range
            uncertainties.append("estimated_building_height:" + building_id)
        elif height_range is not None:
            low = high = None
            uncertainties.append("invalid_building_height_range:" + building_id)
        elif _number(height) and height >= 0:
            low = high = float(height)
        else:
            low = high = None
        bottom = building.get("min_height_m", 0)
        if not _number(bottom) or bottom < 0:
            bottom = 0
            uncertainties.append("building_base_unknown:" + building_id)
        if ground is None or low is None:
            uncertainties.append(("building_ground_unknown:" if ground is None else "building_height_unknown:") + building_id)
            continue
        for start, end in intervals:
            # The endpoint itself is the requested point; touching its surface
            # is not an intervening obstruction. A far-side wall still blocks.
            lo, hi = max(start * distance, 1e-4), min(end * distance, distance - 1e-4)
            if hi <= lo:
                continue
            ray_low, ray_high = span(lo, hi)
            if ray_high < ground + bottom - EPS or ray_low > ground + high + EPS:
                continue
            if ray_low < ground + low - EPS and ray_high > ground + bottom + EPS:
                blockers.append({"id": building_id, "reason": "building_prism_intersection", "distance_m": round(lo, 3),
                                 "height_basis": building.get("height_basis", "unknown"), "height_range_m": [low, high]})
                break
            uncertainties.append("height_interval_or_grazing_intersection:" + building_id)
    if profile.flat is not None:
        # An explicitly flat synthetic surface admits an exact quadratic
        # minimum. It does not require thousands of redundant samples.
        lo, hi = 1e-4, distance - 1e-4
        if hi > lo and span(lo, hi)[0] < profile.flat - EPS:
            vertex = min(hi, max(lo, -slope * EARTH_RADIUS_M))
            blockers.append({"id": "terrain", "reason": "terrain_intersection", "distance_m": round(vertex, 3)})
    elif profile.present:
        requested_steps = max(2, math.ceil(distance / max(1, min(25, profile.resolution / 2))))
        steps = min(MAX_PROFILE_STEPS, requested_steps)
        if steps != requested_steps:
            uncertainties.append("terrain_profile_work_limit")
        gap = False
        for i in range(1, steps):
            fraction = i / steps
            terrain_height = profile.elevation(vector[0] * fraction, vector[1] * fraction)
            if terrain_height is None:
                gap = True
            elif terrain_height > sight_height(distance * fraction) + EPS:
                blockers.append({"id": "terrain", "reason": "terrain_intersection", "distance_m": round(distance * fraction, 3)})
                break
        if gap:
            uncertainties.append("terrain_profile_gap")
    hard_unknown = any(not reason.startswith(("explicit_flat_terrain_model", "estimated_building_height:")) for reason in uncertainties)
    status = "blocked" if blockers else "unknown" if hard_unknown else "clear_in_model"
    result = _result(status, distance, azimuth, altitude, blockers, uncertainties)
    result["model_limits"] = ["sampled_target_only", "unmapped_buildings_and_vegetation_unchecked", "nearest_sample_terrain_not_field_verified", "atmospheric_refraction_ignored"]
    return result


def assess_target(observer, target, buildings, terrain=None):
    _observer(observer)
    _coordinate(target["lat"], target["lon"])
    vector = project(target["lat"], target["lon"], observer["lat"], observer["lon"])
    distance = math.hypot(*vector)
    azimuth = bearing(observer["lat"], observer["lon"], target["lat"], target["lon"])
    # Coincident points have no meaningful bearing; reject before FOV.
    if distance < 0.1:
        return _result("unknown", distance, azimuth, None, uncertainties=["target_distance_outside_model_range"])
    if not _fov(observer, azimuth):
        return _result("outside_fov", distance, azimuth, None)
    if distance > MAX_RANGE_M:
        return _result("unknown", distance, azimuth, None, uncertainties=["target_distance_outside_model_range"])
    profile = _Terrain(terrain, observer)
    ground = observer.get("ground_elevation_m")
    if ground is None:
        ground = profile.elevation(0, 0)
    elevation = target.get("elevation_m")
    if not _number(elevation):
        if target.get("kind") == "sea":
            elevation = 0.0
        else:
            elevation = profile.elevation(*vector)
            if elevation is not None:
                # Unknown target height must not become a made-up roof: the
                # explicit ground-level point is the only supported fallback.
                height = target.get("height_m")
                if _number(height) and height >= 0:
                    elevation += height
    if ground is None or elevation is None:
        return _result("unknown", distance, azimuth, None, uncertainties=["observer_vertical_datum_unknown" if ground is None else "target_vertical_datum_unknown"])
    origin = ground + observer["height_agl_m"]
    altitude = math.degrees(math.atan2(elevation - origin - distance * distance / (2 * EARTH_RADIUS_M), distance))
    if not _fov(observer, azimuth, altitude):
        return _result("outside_fov", distance, azimuth, altitude)
    result = _trace(observer, vector, distance, azimuth, altitude, origin, buildings, terrain)
    if not _number(target.get("elevation_m")) and target.get("kind") != "sea":
        result["uncertainties"] = sorted(set(result["uncertainties"] + ["target_elevation_from_terrain_and_optional_height"]))
    return result


def assess_sun(observer, azimuth_deg, elevation_deg, buildings, terrain=None):
    _observer(observer)
    if not _number(azimuth_deg) or not _number(elevation_deg) or not -90 <= elevation_deg <= 90:
        raise ValueError("invalid solar direction")
    azimuth_deg %= 360
    radius = (terrain or {}).get("coverage_radius_m", (terrain or {}).get("radius_m", 5000))
    if not _number(radius) or not 1 <= radius <= MAX_RANGE_M:
        raise ValueError("invalid solar model radius")
    if not _fov(observer, azimuth_deg, elevation_deg):
        return _result("outside_fov", radius, azimuth_deg, elevation_deg)
    profile = _Terrain(terrain, observer)
    ground = observer.get("ground_elevation_m")
    if ground is None:
        ground = profile.elevation(0, 0)
    if ground is None:
        return _result("unknown", radius, azimuth_deg, elevation_deg, uncertainties=["observer_vertical_datum_unknown"])
    if abs(elevation_deg) > 89.999:
        # Vertical rays need no horizontal building trace; the model lacks
        # overhang/roof geometry directly above a window.
        return _result("unknown", radius, azimuth_deg, elevation_deg, uncertainties=["vertical_ray_not_supported"])
    angle = math.radians(azimuth_deg)
    vector = (radius * math.sin(angle), radius * math.cos(angle))
    result = _trace(observer, vector, radius, azimuth_deg, elevation_deg, ground + observer["height_agl_m"], buildings, terrain)
    result["model_limits"].append("solar_horizon_beyond_radius_unchecked")
    result["model_radius_m"] = radius
    result["distance_m"] = None  # Sun is directional, not a target at model radius.
    return result
