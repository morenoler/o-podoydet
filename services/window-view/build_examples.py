"""Regenerate deterministic synthetic examples and hash the saved real scene."""
import hashlib
import gzip
import json
from pathlib import Path
from window_view.elevation import offset

ROOT = Path(__file__).resolve().parent


def write(path, value):
    path.write_bytes((json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8"))


def main():
    origin = {"lat": 0, "lon": 0}
    def point(x, y):
        from window_view.geometry import unproject
        lat, lon = unproject(x, y, 0, 0)
        return [lat, lon]
    def building(ident, west, south, east, north, height, levels):
        return {"id": ident, "name": ident, "polygons": [{"outer": [point(west, south), point(east, south), point(east, north), point(west, north), point(west, south)], "holes": []}],
                "height_m": height, "height_range_m": None, "height_basis": "synthetic_known", "min_height_m": 0,
                "ground_elevation_m": 0, "source_ids": ["demo:scene"], "tags": {"building:levels": str(levels)}}
    def target(ident, kind, x, y, elevation):
        lat, lon = point(x, y)
        return {"id": ident, "kind": kind, "name": ident, "lat": lat, "lon": lon,
                "height_m": 0, "elevation_m": elevation, "source_ids": ["demo:scene"]}
    scene = {"origin": origin, "radius_m": 1200, "is_demo": True,
             "buildings": [building("demo:hotel", -10, -10, 10, 10, 48, 15),
                           building("demo:east-building", 40, -20, 60, 20, 25, 8),
                           building("demo:west-building", -60, -20, -40, 20, 12, 4)],
             "targets": [target("demo:sea", "sea", -500, 0, 0),
                         target("demo:tower", "landmark", 150, 0, 80),
                         target("demo:park", "park", 0, -300, 0),
                         target("demo:mountain", "mountain", 0, 1000, 250),
                         target("demo:lake", "water", 300, 300, 0)],
             "terrain": {"flat_elevation_m": 0, "samples": [], "resolution_m": 1, "radius_m": 1200, "source_ids": ["demo:flat"]},
             "sources": [{"id": "demo:scene", "url": None, "retrieved_at": None, "source_updated_at": None,
                          "license": "Synthetic test fixture", "method": "hand-authored synthetic geometry; not a real hotel"}],
             "completeness": {"geometry_complete": True, "osm_complete": False},
             "warnings": ["Entire scene is synthetic, including sea, hotel and all buildings. No real-world claim."]}
    path = ROOT / "data/demo/synthetic.scene.json"
    write(path, scene)
    request = {"hotel": {"id": "demo:hotel", "name": "Synthetic hotel", **origin}, "floor": 4,
               "floor_height_m": 3, "date": "2026-03-20", "utc_offset_minutes": 0,
               "data_mode": "fixture", "scene_id": "synthetic"}
    write(ROOT / "examples/hotel.json", request)
    lat, lon = point(-10, 0)
    request["room"] = {"id": "demo:west-room", "window": {"lat": lat, "lon": lon, "bearing_deg": 270}}
    write(ROOT / "examples/room.json", request)
    request["floor"] = 14
    write(ROOT / "examples/room-high-floor.json", request)
    index = {"synthetic": {"path": str(path.relative_to(ROOT)).replace("\\", "/"), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "is_demo": True, "description": "Synthetic room/floor/obstacle regression scene"}}
    real_path = ROOT / "data/open/batumi-radisson.scene.json"
    packed_path = real_path.with_suffix(".json.gz")
    if real_path.exists():
        packed_path.write_bytes(gzip.compress(real_path.read_bytes(), mtime=0))
    if packed_path.exists():
        index["batumi-radisson"] = {"path": "data/open/batumi-radisson.scene.json.gz", "sha256": hashlib.sha256(packed_path.read_bytes()).hexdigest(), "is_demo": False, "description": "Public OSM + Open-Meteo snapshot around Radisson Blu Batumi; no physical room geometry verified"}
        real_request = json.loads((ROOT / "examples/collect-batumi.json").read_text(encoding="utf-8"))
        real_request.update({"data_mode": "cached", "scene_id": "batumi-radisson"})
        write(ROOT / "examples/real-hotel.json", real_request)
    write(ROOT / "data/scenes.json", index)


if __name__ == "__main__":
    main()
