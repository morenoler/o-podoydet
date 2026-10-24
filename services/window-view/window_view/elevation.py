"""Opt-in, cached Open-Meteo GLO-90 surface elevation sampling.

GLO-90 is a surface model, not a bare-earth survey. Values and small differences
must never be called measured ground heights. No secret keys or arbitrary URLs.
"""
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import time
from urllib.parse import urlencode
from urllib.request import Request, HTTPRedirectHandler, build_opener

URL = "https://api.open-meteo.com/v1/elevation"
MAX_POINTS = 600


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Elevation redirects are not allowed")


urlopen = build_opener(_NoRedirect()).open


def distance(a, b):
    x = math.radians(b["lon"] - a["lon"]) * math.cos(math.radians(a["lat"]))
    y = math.radians(b["lat"] - a["lat"])
    return math.hypot(x, y) * 6371008.8


def offset(origin, bearing_deg, meters):
    bearing = math.radians(bearing_deg)
    return {"lat": origin["lat"] + math.degrees(meters * math.cos(bearing) / 6371008.8),
            "lon": origin["lon"] + math.degrees(meters * math.sin(bearing) / (6371008.8 * math.cos(math.radians(origin["lat"]))))}


def nearest_elevation(point, samples, max_m=100):
    candidates = [(distance(point, s), s["elevation_m"]) for s in samples]
    if not candidates:
        return None
    gap, elevation = min(candidates)
    return elevation if gap <= max_m else None


def sample_points(scene, observers, targets, solar_events):
    """Bounded ray sampling; retained coverage is reported, never extrapolated."""
    points, seen = [], set()
    def add(point):
        key = (round(point["lat"], 6), round(point["lon"], 6))
        if key not in seen and len(points) < MAX_POINTS:
            points.append({"lat": key[0], "lon": key[1]})
            seen.add(key)
    for observer in observers:
        add(observer)
    # Prioritise the selected observer's target profiles; additional hotel facade
    # scenarios may have gaps, which the geometry layer must keep unknown.
    for observer in observers[:1]:
        for target in targets:
            length = distance(observer, target)
            steps = max(1, math.ceil(length / 75))
            for i in range(steps + 1):
                t = i / steps
                add({"lat": observer["lat"] + t * (target["lat"] - observer["lat"]),
                     "lon": observer["lon"] + t * (target["lon"] - observer["lon"])})
        for key in ("sunrise", "sunset"):
            event = solar_events.get(key)
            if event:
                for meters in range(0, int(scene["radius_m"]) + 1, 75):
                    add(offset(observer, event["azimuth_deg"], meters))
    for building in scene["buildings"]:
        for polygon in building["polygons"]:
            ring = polygon["outer"][:-1]
            if ring:
                add({"lat": sum(p[0] for p in ring) / len(ring), "lon": sum(p[1] for p in ring) / len(ring)})
    return points


def enrich(scene, points, cache_dir, allow_network=False):
    if not isinstance(points, list) or len(points) > MAX_POINTS:
        raise ValueError("elevation points must be a bounded list")
    for point in points:
        if not isinstance(point, dict):
            raise ValueError("invalid elevation coordinates")
        for key, low, high in (("lat", -90, 90), ("lon", -180, 180)):
            value = point.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
                raise ValueError("invalid elevation coordinates")
    cache_dir = Path(cache_dir) / "elevation"
    samples, sources, warnings = [], [], []
    for start in range(0, min(len(points), MAX_POINTS), 100):
        batch = points[start:start + 100]
        query = urlencode({"latitude": ",".join(str(p["lat"]) for p in batch),
                           "longitude": ",".join(str(p["lon"]) for p in batch)})
        url = URL + "?" + query
        key = hashlib.sha256(url.encode()).hexdigest()
        path = cache_dir / (key + ".json")
        try:
            if path.exists():
                if path.stat().st_size > 150_000:
                    raise ValueError("elevation cache too large")
                envelope = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(envelope, dict) or not isinstance(envelope.get("body"), str):
                    raise ValueError("invalid elevation cache envelope")
                raw = envelope["body"].encode("utf-8")
                if envelope["url"] != url or hashlib.sha256(raw).hexdigest() != envelope["sha256"]:
                    raise ValueError("elevation cache integrity mismatch")
                if len(raw) > 100_000 or datetime.fromisoformat(envelope["retrieved_at"]).tzinfo is None:
                    raise ValueError("invalid elevation cache provenance")
            elif allow_network:
                with urlopen(Request(url, headers={"User-Agent": "OPodoydet-WindowView/0.1 (research prototype)"}), timeout=20) as response:
                    raw = response.read(100_001)
                if len(raw) > 100_000:
                    raise ValueError("elevation response too large")
                envelope = {"url": url, "body": raw.decode("utf-8"), "sha256": hashlib.sha256(raw).hexdigest(),
                            "retrieved_at": datetime.now(timezone.utc).isoformat()}
            else:
                raise ValueError("elevation cache missing; network disabled")
            values = json.loads(raw)["elevation"]
            if len(values) != len(batch) or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not -500 <= v <= 9000 for v in values):
                raise ValueError("invalid elevation response")
            if not path.exists():
                cache_dir.mkdir(parents=True, exist_ok=True)
                temporary = path.with_suffix(".tmp")
                temporary.write_text(json.dumps(envelope, ensure_ascii=False), encoding="utf-8")
                temporary.replace(path)
                time.sleep(0.2)
            source_id = "open-meteo:" + key[:16]
            sources.append({"id": source_id, "url": url, "retrieved_at": envelope["retrieved_at"],
                            "source_updated_at": None, "license": "CC-BY-4.0; Copernicus DEM terms",
                            "method": "Copernicus GLO-90 surface-model samples via Open-Meteo", "sha256": envelope["sha256"]})
            samples.extend({**point, "elevation_m": value} for point, value in zip(batch, values))
        except (OSError, ValueError, KeyError, TypeError) as error:
            warnings.append("elevation_unavailable: " + str(error)[:160])
            # Do not retry the remaining upstream batches after an outage.
            break
    scene["terrain"] = {"samples": samples, "resolution_m": 90, "radius_m": scene["radius_m"],
                        "source_ids": [s["id"] for s in sources], "requested_points": len(points),
                        "returned_points": len(samples), "model": "GLO-90 DSM; not bare-earth survey"}
    scene["sources"].extend(sources)
    scene.setdefault("warnings", []).extend(warnings)
    scene["warnings"].append("Elevation is a 90 m digital surface model; buildings/vegetation may bias ground estimates. Narrow terrain obstacles may be missed.")
    for building in scene["buildings"]:
        ring = building["polygons"][0]["outer"] if building["polygons"] else []
        if ring and building.get("ground_elevation_m") is None:
            point = {"lat": sum(p[0] for p in ring[:-1]) / (len(ring) - 1), "lon": sum(p[1] for p in ring[:-1]) / (len(ring) - 1)}
            building["ground_elevation_m"] = nearest_elevation(point, samples)
            building["ground_basis"] = "approximate_dsm"
    for target in scene["targets"]:
        if target.get("elevation_m") is None:
            base = nearest_elevation(target, samples)
            target["elevation_m"] = base + (target.get("height_m") or 0) if base is not None else None
            target["elevation_basis"] = "approximate_dsm"
    return scene
