"""Explicit, bounded OpenStreetMap acquisition and conservative normalization.

No room/window facts are inferred here. OSM is incomplete even when the response
is complete. Sea samples use the documented direction of natural=coastline:
https://wiki.openstreetmap.org/wiki/Tag:natural%3Dcoastline
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
MAX_BYTES = 24 * 1024 * 1024
MAX_ELEMENTS = 50000
MAX_VERTICES = 300000
MAX_TARGETS = 120
MAX_SEA_SAMPLES = 48
EARTH_M = 6371008.8
_FETCH_LOCK = threading.Lock()
_LAST_FETCH = 0.0


class SourceError(RuntimeError):
    """An upstream response or cache cannot safely be used."""


class CacheMiss(SourceError):
    """No verified cache exists and network access was not enabled."""


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def parse_measure(value, *, signed=False):
    """Parse explicit metres/feet; reject ambiguous lists, NaN and unknown units."""
    if _number(value):
        result = float(value)
    elif isinstance(value, str):
        raw = value.strip()
        feet_inches = re.fullmatch(r"([+]?[0-9]+(?:\.[0-9]+)?)\s*'\s*([0-9]+(?:\.[0-9]+)?)\s*\"", raw)
        match = re.fullmatch(r"([+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+))\s*(m|meter|meters|metre|metres|ft|feet|foot)?", raw, re.I)
        if feet_inches:
            if float(feet_inches[2]) >= 12:
                return None
            result = float(feet_inches[1]) * 0.3048 + float(feet_inches[2]) * 0.0254
        elif match:
            result = float(match[1]) * (0.3048 if (match[2] or "").lower() in {"ft", "feet", "foot"} else 1)
        else:
            return None
    else:
        return None
    if not math.isfinite(result) or not (-12000 <= result <= 9000 if signed else 0 <= result <= 1000):
        return None
    return result


def _levels(value):
    if isinstance(value, bool):
        return None
    raw = str(value)
    return int(raw) if re.fullmatch(r"\d{1,3}", raw) and 0 <= int(raw) <= 250 else None


def _height(tags):
    measured = parse_measure(tags.get("height"))
    if measured is not None:
        # OSM height includes roof:height. Adding it again would double count.
        return measured, None, "osm_height"
    levels = _levels(tags.get("building:levels"))
    if levels is None or levels == 0:
        return None, None, "unknown"
    roof_height = parse_measure(tags.get("roof:height"))
    roof_levels = _levels(tags.get("roof:levels"))
    if roof_height is not None:
        low_roof = high_roof = roof_height
    elif roof_levels is not None:
        low_roof, high_roof = 2.4 * roof_levels, 4.2 * roof_levels
    elif tags.get("roof:shape") == "flat":
        low_roof, high_roof = 0, 1
    else:
        low_roof, high_roof = 0, 6
    # An explicit modelling assumption, not a measured confidence interval.
    return None, [round(2.4 * levels + low_roof, 3), round(4.2 * levels + high_roof, 3)], "estimated_levels"


def _coord(obj):
    if isinstance(obj, dict) and _number(obj.get("lat")) and _number(obj.get("lon")):
        if -90 <= obj["lat"] <= 90 and -180 <= obj["lon"] <= 180:
            return (float(obj["lat"]), float(obj["lon"]))
    return None


def _xy(point, origin):
    dlon = (point[1] - origin[1] + 180) % 360 - 180
    return (math.radians(dlon) * EARTH_M * math.cos(math.radians(origin[0])),
            math.radians(point[0] - origin[0]) * EARTH_M)


def _ll(x, y, origin):
    return (origin[0] + math.degrees(y / EARTH_M),
            (origin[1] + math.degrees(x / (EARTH_M * math.cos(math.radians(origin[0])))) + 180) % 360 - 180)


def _inside(point, ring):
    y, x = point
    result = False
    for (y1, x1), (y2, x2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            result = not result
    return result


def _valid_ring(points):
    if len(points) < 4 or len(points) > 4000 or points[0] != points[-1] or len(set(points[:-1])) < 3:
        return False
    # Repeated intermediate points imply a pinched/ambiguous outline.
    if len(set(points[:-1])) != len(points) - 1:
        return False
    origin = points[0]
    xy = [_xy(p, origin) for p in points]
    if abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(xy, xy[1:]))) <= 0.01:
        return False
    # Bounding-box sweep avoids testing every distant edge pair. Touching or
    # crossing non-adjacent edges make an outline ambiguous, even if signed
    # area happens not to cancel to zero.
    edges = [(min(a[0], b[0]), max(a[0], b[0]), min(a[1], b[1]), max(a[1], b[1]), i, a, b)
             for i, (a, b) in enumerate(zip(xy, xy[1:]))]
    active = []
    comparisons = 0
    for edge in sorted(edges):
        active = [e for e in active if e[1] >= edge[0]]
        for other in active:
            if abs(edge[4] - other[4]) in {1, len(edges) - 1} or edge[2] > other[3] or other[2] > edge[3]:
                continue
            comparisons += 1
            if comparisons > 100000:
                return False  # complex/hostile outline: unknown, not a timeout
            a, b, c, d = edge[5], edge[6], other[5], other[6]
            def cross(p, q, r):
                return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
            if cross(a, b, c) * cross(a, b, d) <= 0 and cross(c, d, a) * cross(c, d, b) <= 0:
                return False
        active.append(edge)
    return True


def _way_points(element, index):
    if "geometry" in element:
        raw = element["geometry"]
        if not isinstance(raw, list):
            return None
        points = [_coord(p) for p in raw]
        return points if points and all(p is not None for p in points) else None
    refs = element.get("nodes")
    if not isinstance(refs, list):
        return None
    points = [_coord(index.get(("node", ref))) for ref in refs]
    return points if points and all(p is not None for p in points) else None


def _stitch(fragments):
    """Join only equal endpoints; never draw a straight bridge across a gap."""
    pending = [list(p) for p in fragments]
    rings = []
    while pending:
        ring = pending.pop(0)
        while ring[-1] != ring[0]:
            choices = [(i, reverse) for i, p in enumerate(pending)
                       for reverse, endpoint in [(False, p[0]), (True, p[-1])]
                       if endpoint == ring[-1]]
            if len(choices) != 1:
                return None
            i, reverse = choices[0]
            part = pending.pop(i)
            if reverse:
                part.reverse()
            ring.extend(part[1:])
        if not _valid_ring(ring):
            return None
        rings.append(ring)
    return rings


def _rings_intersect(first, second):
    """Reject ambiguous touching/crossing ring boundaries with bounded work."""
    comparisons = 0
    for a, b in zip(first, first[1:]):
        for c, d in zip(second, second[1:]):
            if max(a[0], b[0]) < min(c[0], d[0]) or max(c[0], d[0]) < min(a[0], b[0]) or max(a[1], b[1]) < min(c[1], d[1]) or max(c[1], d[1]) < min(a[1], b[1]):
                continue
            comparisons += 1
            if comparisons > 100000:
                return True
            def cross(p, q, r):
                return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
            if cross(a, b, c) * cross(a, b, d) <= 0 and cross(c, d, a) * cross(c, d, b) <= 0:
                return True
    return False


def _polygons(element, index):
    if element["type"] == "way":
        ring = _way_points(element, index)
        return [{"outer": ring, "holes": []}] if ring and _valid_ring(ring) else None
    if element["type"] != "relation" or element.get("tags", {}).get("type") != "multipolygon":
        return None
    fragments = {"outer": [], "inner": []}
    members = element.get("members")
    if not isinstance(members, list):
        return None
    for member in members:
        if not isinstance(member, dict):
            return None
        role = member.get("role", "") or "outer"
        if member.get("type") != "way" or role not in fragments:
            # Label/admin_centre nodes do not define a polygon; unknown geometric
            # relation roles cannot be silently treated as complete geometry.
            if member.get("type") == "node" and role in {"label", "admin_centre"}:
                continue
            return None
        candidate = member if "geometry" in member else index.get(("way", member.get("ref")))
        points = _way_points(candidate or {}, index)
        if not points or len(points) < 2:
            return None
        fragments[role].append(points)
    outer, inner = _stitch(fragments["outer"]), _stitch(fragments["inner"])
    if not outer or inner is None:
        return None
    polygons = [{"outer": ring, "holes": []} for ring in outer]
    for hole in inner:
        containers = [p for p in polygons if _inside(hole[0], p["outer"])]
        if len(containers) != 1 or not all(_inside(p, containers[0]["outer"]) for p in hole[:-1]):
            return None
        if _rings_intersect(hole, containers[0]["outer"]):
            return None
        for existing in containers[0]["holes"]:
            if _rings_intersect(hole, existing) or _inside(hole[0], existing) or _inside(existing[0], hole):
                return None
        containers[0]["holes"].append(hole)
    return polygons


def validate_payload(payload):
    if not isinstance(payload, dict) or payload.get("remark"):
        raise SourceError("Overpass returned an error/partial response (remark)")
    elements = payload.get("elements")
    if not isinstance(elements, list) or len(elements) > MAX_ELEMENTS:
        raise SourceError("Invalid or oversized Overpass element list")
    seen = set()
    vertices = 0
    for e in elements:
        if not isinstance(e, dict) or e.get("type") not in {"node", "way", "relation"}:
            raise SourceError("Invalid OSM element type")
        ident = e.get("id")
        if isinstance(ident, bool) or not isinstance(ident, int) or ident <= 0:
            raise SourceError("Invalid OSM identifier")
        key = (e["type"], ident)
        if key in seen:
            raise SourceError("Duplicate OSM element identifier")
        seen.add(key)
        if not isinstance(e.get("tags", {}), dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in e.get("tags", {}).items()):
            raise SourceError("Invalid OSM tags")
        vertices += len(e.get("geometry", [])) if isinstance(e.get("geometry", []), list) else 0
        for m in e.get("members", []) if isinstance(e.get("members", []), list) else []:
            vertices += len(m.get("geometry", [])) if isinstance(m, dict) and isinstance(m.get("geometry", []), list) else 0
        if vertices > MAX_VERTICES:
            raise SourceError("Overpass geometry exceeds vertex limit")
    return elements


def _anchor(element, polygons):
    point = _coord(element)
    if point:
        return point
    if polygons:
        ring = polygons[0]["outer"]
        point = (sum(p[0] for p in ring[:-1]) / (len(ring) - 1), sum(p[1] for p in ring[:-1]) / (len(ring) - 1))
        if _inside(point, ring) and not any(_inside(point, h) for h in polygons[0]["holes"]):
            return point
        return ring[0]
    return None


def normalize_osm(payload, origin, radius_m, source):
    """Normalize a complete response, preserving missing geometry and heights."""
    origin_point = _coord(origin)
    if origin_point is None or abs(origin_point[0]) > 85 or not _number(radius_m) or not 100 <= radius_m <= 3000:
        raise ValueError("origin must be within ±85° latitude; radius must be 100..3000 m")
    if not isinstance(source, dict) or not isinstance(source.get("id"), str):
        raise ValueError("source requires a stable id")
    elements = validate_payload(payload)
    index = {(e["type"], e["id"]): e for e in elements}
    buildings, targets, evidence = [], [], [dict(source)]
    warnings = ["OpenStreetMap coverage is not exhaustive; unmapped obstacles, trees, facade details and source errors remain possible."]
    geometry_complete = True
    sea_samples = []
    for element in elements:
        tags = element.get("tags", {})
        is_building = any(tags.get(key) not in {None, "no"} for key in ["building", "building:part"])
        kind = ("mountain" if tags.get("natural") in {"peak", "volcano"} else
                "water" if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" else
                "park" if tags.get("leisure") in {"park", "garden"} else
                "landmark" if tags.get("tourism") in {"attraction", "museum", "artwork"} or tags.get("historic") in {"monument", "memorial", "castle", "ruins"} or tags.get("man_made") == "tower" else None)
        is_coast = tags.get("natural") == "coastline" and element["type"] == "way"
        if not (is_building or kind or is_coast):
            continue
        eid = f"osm:{element['type']}:{element['id']}"
        sid = f"{source['id']}:{element['type']}:{element['id']}"
        evidence.append({"id": sid, "url": f"https://www.openstreetmap.org/{element['type']}/{element['id']}",
                         "retrieved_at": source.get("retrieved_at"), "source_updated_at": element.get("timestamp"),
                         "license": "ODbL-1.0; © OpenStreetMap contributors", "method": "osm_tag_or_geometry",
                         "snapshot_source_id": source["id"], "osm_version": element.get("version"),
                         "check_date": tags.get("check_date"), "status": "reported", "recheck_after_days": 90})
        polygons = _polygons(element, index) if element["type"] in {"way", "relation"} and not is_coast else None
        if is_building:
            if not polygons:
                geometry_complete = False
                warnings.append(f"{eid}: missing/incomplete building footprint; not modelled as an obstacle.")
            else:
                height, interval, basis = _height(tags)
                min_height = parse_measure(tags.get("min_height")) or 0
                if height is not None and min_height > height:
                    warnings.append(f"{eid}: min_height exceeds height; conflicting vertical dimensions are unknown.")
                    height, interval, basis, min_height = None, None, "unknown", 0
                buildings.append({"id": eid, "name": tags.get("name"), "polygons": polygons,
                                  "height_m": height, "height_range_m": interval, "height_basis": basis,
                                  "min_height_m": min_height,
                                  "ground_elevation_m": parse_measure(tags.get("ele"), signed=True),
                                  "source_ids": [sid], "tags": dict(tags),
                                  "height_assumption": "2.4..4.2 m per level plus roof allowance; heuristic, not measured bounds" if basis == "estimated_levels" else None})
                if tags.get("building:min_level") and "min_height" not in tags:
                    warnings.append(f"{eid}: building:min_level is not converted to an exact bottom height; obstacle conservatively extends to ground.")
        if kind:
            anchor = _anchor(element, polygons)
            if anchor is not None:
                x, y = _xy(anchor, origin_point)
                if math.hypot(x, y) <= radius_m:
                    tagged_elevation = parse_measure(tags.get("ele"), signed=True)
                    target_height = parse_measure(tags.get("height")) if kind == "landmark" else None
                    ground_elevation = tagged_elevation if kind == "landmark" else None
                    if kind == "mountain":
                        # ele on a peak is already the summit altitude; a
                        # height/prominence tag must not be added to it.
                        target_elevation = tagged_elevation
                        sample_kind = "summit_point"
                        elevation_reference = "summit_above_sea_level"
                    elif kind == "landmark" and target_height is not None:
                        # OSM Key:ele explicitly places buildings/man_made
                        # structures at surrounding ground level. Geometry's
                        # elevation_m is the absolute sampled point altitude.
                        target_elevation = None if tagged_elevation is None else tagged_elevation + target_height
                        sample_kind = "structure_top_point"
                        elevation_reference = "structure_top_above_sea_level" if target_elevation is not None else "structure_top_requires_ground_elevation"
                    else:
                        target_elevation = tagged_elevation
                        sample_kind = "water_surface_point" if kind == "water" else "ground_anchor"
                        elevation_reference = "water_surface_above_sea_level" if kind == "water" else "ground_anchor_above_sea_level"
                    targets.append({"id": eid, "kind": kind, "name": tags.get("name"),
                                    "lat": anchor[0], "lon": anchor[1], "height_m": target_height,
                                    "elevation_m": target_elevation, "ground_elevation_m": ground_elevation,
                                    "elevation_reference": elevation_reference, "sample_kind": sample_kind,
                                    "source_ids": [sid],
                                    "sample_method": "mapped_point" if element["type"] == "node" else "representative_footprint_point",
                                    "sample_scope": "one point; does not establish visibility of the whole object"})
            else:
                warnings.append(f"{eid}: target geometry is incomplete; no target point inferred.")
        if is_coast:
            points = _way_points(element, index)
            if not points:
                geometry_complete = False
                warnings.append(f"{eid}: incomplete coastline geometry; no sea samples inferred.")
                continue
            for segment, (a, b) in enumerate(zip(points, points[1:])):
                ax, ay = _xy(a, origin_point)
                bx, by = _xy(b, origin_point)
                dx, dy = bx - ax, by - ay
                length = math.hypot(dx, dy)
                if length < 2:
                    continue
                fraction = max(0, min(1, -(ax * dx + ay * dy) / length**2))
                if math.hypot(ax + fraction * dx, ay + fraction * dy) > radius_m + 20:
                    continue
                count = min(32, math.ceil(min(length, 2 * radius_m) / 200))
                step = 200 / length
                fractions = {fraction}
                fractions.update(max(0, min(1, fraction + (i - count // 2) * step)) for i in range(count + 1))
                offset = min(20, length / 4)
                for f in sorted(fractions):
                    # In an east/north plane the right normal is (dy, -dx).
                    x, y = ax + f * dx + offset * dy / length, ay + f * dy - offset * dx / length
                    if math.hypot(x, y) > radius_m:
                        continue
                    lat, lon = _ll(x, y, origin_point)
                    sea_samples.append({"id": f"{eid}:sea:{segment}:{f:.6f}", "kind": "sea", "name": "Coastal sea sample",
                                        "lat": lat, "lon": lon, "height_m": 0, "elevation_m": 0, "source_ids": [sid],
                                        "sample_method": "directed_coastline_right_side", "sample_offset_m": round(offset, 3),
                                        "sample_scope": "local water-side point, assumes correct coastline direction; no whole-sea guarantee"})
    if sea_samples:
        warnings.append("Sea targets are limited samples 0.5..20 m to the right of mapped coastline segments; coastline direction, tides and local shoreline geometry are not independently verified.")
    # Deterministic bearing-first sampling avoids consuming the limit at the
    # first coastline feature. It is still deliberately a finite approximation.
    sea_samples.sort(key=lambda t: (round(math.degrees(math.atan2(*_xy((t['lat'], t['lon']), origin_point))) / 5), math.hypot(*_xy((t['lat'], t['lon']), origin_point)), t['id']))
    unique = {}
    for t in sea_samples:
        key = (round(t["lat"], 6), round(t["lon"], 6))
        unique.setdefault(key, t)
    sea_samples = list(unique.values())
    if len(sea_samples) > MAX_SEA_SAMPLES:
        indices = [round(i * (len(sea_samples) - 1) / (MAX_SEA_SAMPLES - 1)) for i in range(MAX_SEA_SAMPLES)]
        sea_samples = [sea_samples[i] for i in indices]
        warnings.append(f"Sea sampling capped at {MAX_SEA_SAMPLES} points.")
    targets.sort(key=lambda t: (math.hypot(*_xy((t["lat"], t["lon"]), origin_point)), t["id"]))
    if len(targets) > MAX_TARGETS:
        warnings.append(f"Non-sea targets capped at {MAX_TARGETS} nearest mapped objects.")
    targets = targets[:MAX_TARGETS] + sea_samples
    if not buildings:
        warnings.append("No usable building footprints found; this is missing coverage, not proof of unobstructed views.")
    if not sea_samples:
        warnings.append("No usable coastline samples found within the radius; sea visibility remains unknown.")
    return {"origin": dict(origin), "radius_m": radius_m, "buildings": buildings, "targets": targets,
            "sources": evidence, "warnings": warnings,
            "completeness": {"geometry_complete": geometry_complete, "osm_complete": False,
                             "input_elements": len(elements), "modelled_buildings": len(buildings)},
            "algorithm_version": "osm-normalizer/1.1"}


def build_query(lat, lon, radius_m):
    if not _number(lat) or not _number(lon) or not -85 <= lat <= 85 or not -180 <= lon <= 180:
        raise ValueError("Coordinates must be finite numbers, latitude within ±85°")
    if not _number(radius_m) or not 100 <= radius_m <= 3000:
        raise ValueError("radius_m must be 100..3000")
    around = f"(around:{radius_m:.0f},{lat:.7f},{lon:.7f})"
    filters = ['[building][building!=no]', '["building:part"]["building:part"!=no]',
               '[natural=coastline]', '[natural=water]', '[natural~"^(peak|volcano)$"]',
               '[leisure~"^(park|garden)$"]', '[tourism~"^(attraction|museum|artwork)$"]',
               '[historic~"^(monument|memorial|castle|ruins)$"]', '[man_made=tower]', '[waterway=riverbank]']
    return '[out:json][timeout:40][maxsize:67108864];(' + ''.join('nwr' + f + around + ';' for f in filters) + ');out meta geom;'


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SourceError("Unexpected redirect from fixed data endpoint")


class OpenDataClient:
    def __init__(self, cache_dir, allow_network=False):
        self.cache_dir = Path(cache_dir)
        self.allow_network = bool(allow_network)

    def fetch_scene(self, lat, lon, radius_m=1200):
        query = build_query(lat, lon, radius_m)
        key = hashlib.sha256((OVERPASS_URL + "\n" + query).encode()).hexdigest()
        data_path, meta_path = self.cache_dir / f"osm-{key}.json", self.cache_dir / f"osm-{key}.meta.json"
        if data_path.exists() or meta_path.exists():
            try:
                if data_path.stat().st_size > MAX_BYTES or meta_path.stat().st_size > 100000:
                    raise SourceError("Cached source exceeds size limit")
                raw = data_path.read_bytes()
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                if meta.get("sha256") != hashlib.sha256(raw).hexdigest() or meta.get("query") != query or meta.get("url") != OVERPASS_URL:
                    raise SourceError("Cached source integrity/query mismatch")
                if not isinstance(meta.get("id"), str) or not meta.get("retrieved_at") or not meta.get("source_updated_at"):
                    raise SourceError("Cached source lacks provenance metadata")
                payload = json.loads(raw)
                validate_payload(payload)
            except (OSError, ValueError, TypeError, AttributeError) as exc:
                raise SourceError("Cached source is missing, corrupt or invalid") from exc
        else:
            if not self.allow_network:
                raise CacheMiss("No verified OSM cache; enable network explicitly to collect it")
            raw = self._download(query)
            try:
                payload = json.loads(raw)
            except (ValueError, UnicodeDecodeError) as exc:
                raise SourceError("Overpass did not return valid JSON") from exc
            validate_payload(payload)
            # Out-meta responses must include the database timestamp, even when
            # there are no elements. HTML/structural partial payloads never cache.
            if not isinstance(payload.get("osm3s"), dict) or not payload["osm3s"].get("timestamp_osm_base"):
                raise SourceError("Overpass response lacks snapshot timestamp")
            digest = hashlib.sha256(raw).hexdigest()
            meta = {"id": f"osm-snapshot:{digest[:20]}", "url": OVERPASS_URL, "query": query,
                    "retrieved_at": datetime.now(timezone.utc).isoformat(),
                    "source_updated_at": payload["osm3s"]["timestamp_osm_base"], "sha256": digest,
                    "license": "ODbL-1.0; © OpenStreetMap contributors", "method": "overpass_out_meta_geom",
                    "attribution_url": "https://www.openstreetmap.org/copyright", "status": "reported", "recheck_after_days": 90}
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            # Atomic replacements prevent readers observing partial files. A
            # crash between the pair yields an explicit integrity failure.
            tmp_data, tmp_meta = data_path.with_suffix(".json.tmp"), meta_path.with_suffix(".json.tmp")
            tmp_data.write_bytes(raw)
            tmp_meta.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp_data.replace(data_path)
            tmp_meta.replace(meta_path)
        return normalize_osm(payload, {"lat": lat, "lon": lon}, radius_m, meta)

    def _download(self, query):
        global _LAST_FETCH
        request = urllib.request.Request(OVERPASS_URL, data=urllib.parse.urlencode({"data": query}).encode(),
                                         headers={"User-Agent": "O-Podoydet-window-view/0.1 (open-data research prototype)",
                                                  "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"})
        # Serialized and paced within this process; no retries flood a provider.
        with _FETCH_LOCK:
            delay = 1.0 - (time.monotonic() - _LAST_FETCH)
            if delay > 0:
                time.sleep(delay)
            _LAST_FETCH = time.monotonic()
            try:
                deadline = time.monotonic() + 60
                opener = urllib.request.build_opener(_NoRedirect())
                with opener.open(request, timeout=45) as response:
                    if response.status != 200:
                        raise SourceError(f"Overpass HTTP {response.status}")
                    chunks, size = [], 0
                    while True:
                        if time.monotonic() > deadline:
                            raise SourceError("Overpass exceeded collection deadline")
                        # read1 performs at most one underlying read. A slow
                        # trickle cannot keep an unbounded read(-1) alive.
                        chunk = response.read1(min(65536, MAX_BYTES + 1 - size))
                        if not chunk:
                            break
                        chunks.append(chunk)
                        size += len(chunk)
                        if size > MAX_BYTES:
                            raise SourceError("Overpass response exceeds byte limit")
                    return b"".join(chunks)
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                raise SourceError(f"Overpass unavailable: {type(exc).__name__}") from exc
