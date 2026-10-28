"""Explicit offline PBF preparation; never called by ordinary builds or tests.

Optional pinned dependency (install in the workspace, not the application's runtime):
  python -m pip install --target .local/busan-extract/python-libs --only-binary=:all: osmium==4.3.2
Pass that directory with --python-libs. This tool makes no network requests.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import importlib.metadata
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

VERSION = "pyosmium-4.3.2-nwr-bbox-center-v1"
MAX_INPUT_BYTES = 400_000_000


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_selectors(config: list[dict]) -> dict[str, list[list[tuple[str, str, str]]]]:
    result = {}
    expression = re.compile(r"\[([^!=\]]+)(!?=)([^\]]+)\]")
    for category in config:
        key = category["key"]
        if key in result:
            raise ValueError(f"Duplicate category: {key}")
        queries = []
        for query in category["osmQueries"]:
            matches = list(expression.finditer(query))
            if not matches or "".join(match.group() for match in matches) != query:
                raise ValueError(f"Unsupported selector: {query}")
            queries.append([match.groups() for match in matches])
        result[key] = queries
    return result


def matching_kinds(tags: dict, selectors: dict) -> list[str]:
    return [kind for kind, queries in selectors.items() if any(all(
        tags.get(key) == value if op == "=" else tags.get(key) != value
        for key, op, value in query) for query in queries)]


def checked_bbox(value: list) -> list[float]:
    if len(value) != 4 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in value):
        raise ValueError("BBox needs four finite numbers in lon/lat order")
    west, south, east, north = value
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("Invalid bbox extent")
    return value


def load_bbox(manifest_path: Path) -> tuple[list[float], str]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    evidence = manifest["entries"]["boundary"]
    path = (manifest_path.parent / evidence["path"]).resolve()
    if not path.is_relative_to(manifest_path.parent.resolve()):
        raise ValueError("Boundary snapshot must be inside the manifest directory")
    if path.stat().st_size != evidence["bytes"] or sha256(path) != evidence["sha256"]:
        raise ValueError("Boundary snapshot checksum/size mismatch")
    snapshot = json.loads(path.read_text(encoding="utf-8"))
    boundaries = [entry for entry in snapshot["elements"] if entry.get("type") == "relation" and entry.get("id") == manifest["boundaryRelationId"]]
    if len(boundaries) != 1:
        raise ValueError("Expected exactly one matching boundary relation")
    box = boundaries[0]["bounds"]
    return checked_bbox([box["minlon"], box["minlat"], box["maxlon"], box["maxlat"]]), evidence["sha256"]


def point_in_bbox(lon: float, lat: float, bbox: list[float]) -> bool:
    return math.isfinite(lon) and math.isfinite(lat) and bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]


def bounds(points: list[tuple[float, float]]) -> tuple | None:
    if not points:
        return None
    if any(not math.isfinite(lon) or not math.isfinite(lat) or abs(lon) > 180 or abs(lat) > 90 for lon, lat in points):
        raise ValueError("Invalid coordinate")
    return min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)


def union_bounds(items: list[tuple]) -> tuple:
    if not items or any(item is None for item in items):
        raise ValueError("Incomplete geometry")
    return min(p[0] for p in items), min(p[1] for p in items), max(p[2] for p in items), max(p[3] for p in items)


def representative_position(box: tuple) -> dict:
    return {"lon": (box[0] + box[2]) / 2, "lat": (box[1] + box[3]) / 2}


def object_metadata(obj, object_type: str, tags: dict) -> dict:
    result = {"type": object_type, "id": obj.id, "tags": tags, "version": obj.version}
    # Geofabrik's missing timestamp is the Unix epoch, not a date of field verification.
    if obj.timestamp.year > 1970:
        result["timestamp"] = obj.timestamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return result


def resolve_relation(members: list[tuple], node_bounds: dict, way_bounds: dict) -> tuple[tuple | None, str | None]:
    if any(kind == "r" for kind, _ in members):
        return None, "excluded_nested_relation"
    boxes = [node_bounds.get(ref) if kind == "n" else way_bounds.get(ref) for kind, ref in members]
    if not boxes or any(box is None for box in boxes):
        return None, "unresolved_relation_geometry"
    return union_bounds(boxes), None


def extract(args) -> dict:
    started = time.monotonic()
    if args.output.resolve() == args.report.resolve():
        raise ValueError("Output and report must be different files")
    if args.python_libs:
        sys.path.insert(0, str(args.python_libs.resolve()))
    try:
        import osmium
        if importlib.metadata.version("osmium") != "4.3.2":
            raise ImportError("Expected osmium==4.3.2")
    except ImportError as error:
        raise RuntimeError("This optional offline tool needs osmium==4.3.2; install it into .local and pass --python-libs. Ordinary application builds/tests do not require it.") from error
    os.environ.setdefault("OSMIUM_POOL_THREADS", "2")
    provenance = json.loads(args.source_manifest.read_text(encoding="utf-8"))
    if not 0 < args.input.stat().st_size <= MAX_INPUT_BYTES or args.input.stat().st_size != provenance["bytes"] or sha256(args.input) != provenance["sha256"]:
        raise ValueError("PBF checksum/size mismatch or input exceeds 400 MB")
    if urlparse(provenance["sourceUrl"]).scheme != "https":
        raise ValueError("Expected an HTTPS provenance URL")
    retrieved = datetime.fromisoformat(provenance["retrievedAt"].replace("Z", "+00:00"))
    if retrieved.tzinfo is None or retrieved > datetime.now(timezone.utc):
        raise ValueError("Invalid retrieval timestamp")
    for path in (args.output, args.report):
        if path.exists():
            raise ValueError(f"Preserve existing snapshots: output already exists: {path}")
    bbox, boundary_sha = load_bbox(args.boundary_manifest)
    selectors = parse_selectors(json.loads(args.config.read_text(encoding="utf-8")))
    counts = collections.Counter()
    elements, relations = [], {}
    way_refs, node_refs = set(), set()
    way_boxes, node_boxes = {}, {}
    identities = set()

    def bounded():
        if time.monotonic() - started > args.max_seconds:
            raise RuntimeError("Offline extraction exceeded its time limit")

    def attach(item, box):
        position = representative_position(box)
        if not point_in_bbox(position["lon"], position["lat"], bbox):
            counts["outside_bbox_" + item["type"]] += 1
            return
        identity = item["type"], item["id"]
        if identity in identities:
            raise ValueError(f"Duplicate OSM identity: {identity}; input must be a single snapshot")
        identities.add(identity)
        if item["type"] == "node":
            item.update(position)
        else:
            item["center"] = position
            item["bounds"] = dict(zip(["minlon", "minlat", "maxlon", "maxlat"], box))
        elements.append(item)
        counts["included_" + item["type"]] += 1
        if not any(item["tags"].get(key, "").strip() for key in ("name:en", "name", "name:ko")):
            counts["included_without_name"] += 1
        for kind in matching_kinds(item["tags"], selectors):
            counts["category_" + kind] += 1

    class Relations(osmium.SimpleHandler):
        def relation(self, relation):
            tags = dict(relation.tags)
            if not matching_kinds(tags, selectors):
                return
            bounded()
            members = [(member.type, member.ref) for member in relation.members]
            item = object_metadata(relation, "relation", tags)
            item["members"] = [{"type": {"n": "node", "w": "way", "r": "relation"}[m.type], "ref": m.ref, "role": m.role} for m in relation.members]
            relations[relation.id] = item, members
            way_refs.update(ref for kind, ref in members if kind == "w")
            node_refs.update(ref for kind, ref in members if kind == "n")

    class Objects(osmium.SimpleHandler):
        def node(self, node):
            if not node.location.valid():
                counts["invalid_node_location"] += 1
                return
            if node.id in node_refs:
                node_boxes[node.id] = node.lon, node.lat, node.lon, node.lat
            if not node.tags or not point_in_bbox(node.lon, node.lat, bbox):
                return
            tags = dict(node.tags)
            if matching_kinds(tags, selectors):
                bounded()
                attach(object_metadata(node, "node", tags), (node.lon, node.lat, node.lon, node.lat))

        def way(self, way):
            tags = dict(way.tags)
            selected = matching_kinds(tags, selectors)
            if not selected and way.id not in way_refs:
                return
            bounded()
            if not way.nodes or any(not node.location.valid() for node in way.nodes):
                counts["unresolved_way_geometry"] += 1
                return
            box = bounds([(node.lon, node.lat) for node in way.nodes])
            if way.id in way_refs:
                way_boxes[way.id] = box
            if selected:
                item = object_metadata(way, "way", tags)
                item["nodes"] = [node.ref for node in way.nodes]
                attach(item, box)

    with osmium.io.Reader(str(args.input)) as reader:
        header = reader.header()
        replication = header.get("osmosis_replication_timestamp")
        generator = header.get("generator")
    print(json.dumps({"phase": "relations", "replicationTimestamp": replication}), flush=True)
    Relations().apply_file(str(args.input))
    print(json.dumps({"phase": "objects", "candidateRelations": len(relations), "neededWays": len(way_refs), "neededNodes": len(node_refs)}), flush=True)
    Objects().apply_file(str(args.input), locations=True, idx="flex_mem")
    for item, members in relations.values():
        box, reason = resolve_relation(members, node_boxes, way_boxes)
        if reason:
            counts[reason] += 1
        else:
            attach(item, box)
    elements.sort(key=lambda item: (item["type"], item["id"]))
    output = {"version": 0.6, "generator": "O-Podoydet offline Geofabrik POI projection v1",
              "osm3s": {"timestamp_osm_base": replication, "copyright": provenance["attribution"]}, "elements": elements}
    raw = (json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    report = {**provenance, "pbfHeaderReplicationTimestamp": replication, "pbfGenerator": generator,
              "extractedAt": utc_now(), "extractPath": args.output.name, "extractSha256": hashlib.sha256(raw).hexdigest(),
              "extractBytes": len(raw), "extractElementCount": len(elements), "bboxLonLat": bbox,
              "method": VERSION, "counts": dict(counts), "duplicateOsmIds": 0,
              "exclusionCountsScope": "National PBF candidates; bbox membership is unknown for unresolved geometry.",
              "configSha256": sha256(args.config), "boundarySha256": boundary_sha,
              "extractorSha256": sha256(Path(__file__)),
              "limitations": ["BBox selection, not administrative-boundary clipping.",
                              "Way/relation position is the bounding-box center, not an entrance or access point.",
                              "Relations containing nested relations or unresolved geometry are excluded and counted.",
                              "Object timestamp is source edit time, not current opening-state verification.",
                              "Only features carrying configured OSM tags are included; missing places remain unknown.",
                              "The selected city-center anchor is a separate explicit research choice."]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("xb") as destination:
        destination.write(raw)
    with args.report.open("x", encoding="utf-8") as destination:
        destination.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ("input", "source-manifest", "boundary-manifest", "config", "output", "report"):
        parser.add_argument("--" + argument, type=Path, required=True)
    parser.add_argument("--python-libs", type=Path)
    parser.add_argument("--max-seconds", type=int, default=600)
    args = parser.parse_args()
    if not 1 <= args.max_seconds <= 1800:
        parser.error("--max-seconds must be between 1 and 1800")
    print(json.dumps(extract(args), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
