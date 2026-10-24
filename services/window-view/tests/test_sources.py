"""Offline independent fixtures: no synthetic features attached to real hotels."""
import hashlib
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from window_view.sources import (CacheMiss, OpenDataClient, OVERPASS_URL, SourceError,
                                 build_query, normalize_osm, parse_measure)


SOURCE = {"id": "test:synthetic-source", "url": "https://example.invalid/synthetic",
          "retrieved_at": "2026-10-24T00:00:00+00:00", "source_updated_at": None,
          "license": "synthetic test fixture", "method": "synthetic", "is_demo": True}
ORIGIN = {"lat": 0.0, "lon": 0.0}


def geometry(points):
    return [{"lat": p[0], "lon": p[1]} for p in points]


def square(lat=0, lon=0, size=.0001):
    return [(lat, lon), (lat, lon + size), (lat + size, lon + size), (lat + size, lon), (lat, lon)]


def way(ident=1, tags=None, points=None):
    return {"type": "way", "id": ident, "tags": tags or {"building": "yes"},
            "geometry": geometry(points if points is not None else square()),
            "timestamp": "2024-05-01T10:00:00Z", "version": 2}


def payload(elements):
    return {"version": 0.6, "osm3s": {"timestamp_osm_base": "2026-10-23T20:00:00Z"}, "elements": elements}


def normalize(elements):
    return normalize_osm(payload(elements), ORIGIN, 1200, SOURCE)


class HeightTests(unittest.TestCase):
    def test_explicit_units(self):
        for value, expected in [(12, 12), ("12.5", 12.5), ("12 m", 12), ("100 ft", 30.48), ("6'2\"", 1.8796), ("1 metres", 1)]:
            with self.subTest(value=value):
                self.assertAlmostEqual(parse_measure(value), expected)

    def test_ambiguous_and_invalid_values(self):
        for value in [True, False, "12;15", "12,5", "NaN", float("nan"), float("inf"), "10 stories", "6'12\"", "-1", "1001", None, [], {}]:
            with self.subTest(value=value):
                self.assertIsNone(parse_measure(value))
        self.assertEqual(parse_measure("-5 m", signed=True), -5)

    def test_roof_not_double_counted(self):
        b = normalize([way(tags={"building": "yes", "height": "20", "roof:height": "5", "building:levels": "3"})])["buildings"][0]
        self.assertEqual(b["height_m"], 20)
        self.assertIsNone(b["height_range_m"])
        self.assertEqual(b["height_basis"], "osm_height")

    def test_levels_are_assumptions(self):
        b = normalize([way(tags={"building": "yes", "building:levels": "5", "roof:height": "4"})])["buildings"][0]
        self.assertEqual(b["height_range_m"], [16, 25])
        self.assertIsNone(b["height_m"])
        self.assertEqual(b["height_basis"], "estimated_levels")
        self.assertIn("heuristic", b["height_assumption"])

    def test_missing_and_fractional_levels_stay_unknown(self):
        for tags in [{"building": "yes"}, {"building": "yes", "building:levels": "1.5"}, {"building": "yes", "height": "approx 10"}]:
            b = normalize([way(tags=tags)])["buildings"][0]
            self.assertIsNone(b["height_m"])
            self.assertIsNone(b["height_range_m"])
            self.assertEqual(b["height_basis"], "unknown")

    def test_min_height_and_elevation_distinct(self):
        b = normalize([way(tags={"building:part": "yes", "height": "15", "min_height": "10", "ele": "-2"})])["buildings"][0]
        self.assertEqual(b["height_m"], 15)
        self.assertEqual(b["min_height_m"], 10)
        self.assertEqual(b["ground_elevation_m"], -2)

    def test_contradictory_vertical_dimensions_unknown(self):
        scene = normalize([way(tags={"building": "yes", "height": "15", "min_height": "20"})])
        self.assertIsNone(scene["buildings"][0]["height_m"])
        self.assertEqual(scene["buildings"][0]["height_basis"], "unknown")
        self.assertTrue(any("conflicting" in w for w in scene["warnings"]))


class GeometryNormalizationTests(unittest.TestCase):
    def test_closed_way_and_provenance(self):
        scene = normalize([way()])
        b = scene["buildings"][0]
        self.assertEqual(b["id"], "osm:way:1")
        self.assertEqual(b["polygons"][0]["outer"], square())
        self.assertEqual(scene["sources"][1]["source_updated_at"], "2024-05-01T10:00:00Z")
        self.assertNotEqual(scene["sources"][1]["source_updated_at"], SOURCE["retrieved_at"])
        self.assertFalse(scene["completeness"]["osm_complete"])

    def test_no_implicit_closing_edge(self):
        scene = normalize([way(points=square()[:-1])])
        self.assertEqual(scene["buildings"], [])
        self.assertFalse(scene["completeness"]["geometry_complete"])

    def test_null_geometry_does_not_bridge_gap(self):
        b = way()
        b["geometry"][2] = None
        self.assertEqual(normalize([b])["buildings"], [])

    def test_missing_node_does_not_bridge_gap(self):
        nodes = [{"type": "node", "id": i + 1, "lat": p[0], "lon": p[1]} for i, p in enumerate(square()[:-1])]
        b = {"type": "way", "id": 10, "nodes": [1, 2, 3, 4, 1], "tags": {"building": "yes"}}
        self.assertEqual(len(normalize(nodes + [b])["buildings"]), 1)
        self.assertEqual(normalize(nodes[:-1] + [b])["buildings"], [])

    def test_multipolygon_hole_and_separate_outer(self):
        outer = square(size=.001)
        hole = square(.0002, .0002, .0002)
        other = square(.002, .002)
        members = [
            {"type": "way", "ref": 1, "role": "outer", "geometry": geometry(outer[:3])},
            {"type": "way", "ref": 2, "role": "outer", "geometry": geometry(list(reversed(outer[2:])))},
            {"type": "way", "ref": 3, "role": "inner", "geometry": geometry(hole)},
            {"type": "way", "ref": 4, "role": "outer", "geometry": geometry(other)}]
        relation = {"type": "relation", "id": 1, "tags": {"type": "multipolygon", "building": "yes"}, "members": members}
        b = normalize([relation])["buildings"][0]
        self.assertEqual(len(b["polygons"]), 2)
        self.assertEqual(b["polygons"][0]["holes"], [hole])
        self.assertEqual(b["polygons"][1]["outer"], other)

    def test_disconnected_relation_is_not_closed(self):
        members = [{"type": "way", "ref": i, "role": "outer", "geometry": geometry(p)} for i, p in enumerate([[(0, 0), (0, .001)], [(.001, .001), (.001, 0)]], 1)]
        relation = {"type": "relation", "id": 1, "tags": {"type": "multipolygon", "building": "yes"}, "members": members}
        self.assertEqual(normalize([relation])["buildings"], [])

    def test_orphan_hole_rejects_polygon(self):
        members = [{"type": "way", "ref": 1, "role": "outer", "geometry": geometry(square())},
                   {"type": "way", "ref": 2, "role": "inner", "geometry": geometry(square(.001, .001))}]
        relation = {"type": "relation", "id": 1, "tags": {"type": "multipolygon", "building": "yes"}, "members": members}
        self.assertEqual(normalize([relation])["buildings"], [])

    def test_hole_edges_cannot_cross_concave_outer(self):
        # Every hole vertex is inside one arm of this U-shaped footprint, but
        # the hole's top edge exits through the open centre of the U.
        outer = [(0, 0), (0, .003), (.003, .003), (.003, .002), (.001, .002), (.001, .001), (.003, .001), (.003, 0), (0, 0)]
        hole = [(.0005, .0005), (.0005, .0025), (.0025, .0025), (.0025, .0005), (.0005, .0005)]
        members = [{"type": "way", "ref": 1, "role": "outer", "geometry": geometry(outer)},
                   {"type": "way", "ref": 2, "role": "inner", "geometry": geometry(hole)}]
        relation = {"type": "relation", "id": 1, "tags": {"type": "multipolygon", "building": "yes"}, "members": members}
        self.assertEqual(normalize([relation])["buildings"], [])

    def test_degenerate_or_pinched_polygon_rejected(self):
        for ring in [[(0, 0), (0, .001), (0, .002), (0, 0)], [(0, 0), (0, .001), (.001, .001), (0, .001), (0, 0)]]:
            self.assertEqual(normalize([way(points=ring)])["buildings"], [])

    def test_self_crossing_unequal_lobes_rejected(self):
        # Signed area is nonzero, so an area-only validation misses this.
        ring = [(0, 0), (.001, .002), (0, .002), (.002, 0), (0, 0)]
        self.assertEqual(normalize([way(points=ring)])["buildings"], [])

    def test_no_building_tag_no_building_model(self):
        scene = normalize([way(tags={"building": "no", "tourism": "museum"})])
        self.assertEqual(scene["buildings"], [])
        self.assertEqual(scene["targets"][0]["kind"], "landmark")

    def test_no_invented_room_facts(self):
        scene = normalize([way(tags={"building": "hotel", "name": "Synthetic fixture"})])
        self.assertNotIn("rooms", scene)
        self.assertNotIn("windows", scene)


class TargetTests(unittest.TestCase):
    def test_tower_uses_ground_plus_height_for_top_point(self):
        tower = {"type": "node", "id": 1, "lat": 0, "lon": .001,
                 "tags": {"man_made": "tower", "ele": "10", "height": "100"}}
        target = normalize([tower])["targets"][0]
        self.assertEqual(target["elevation_m"], 110)
        self.assertEqual(target["ground_elevation_m"], 10)
        self.assertEqual(target["height_m"], 100)
        self.assertEqual(target["sample_kind"], "structure_top_point")
        self.assertEqual(target["elevation_reference"], "structure_top_above_sea_level")

    def test_peak_ele_is_already_summit_altitude(self):
        peak = {"type": "node", "id": 1, "lat": 0, "lon": .001,
                "tags": {"natural": "peak", "ele": "100", "height": "30"}}
        target = normalize([peak])["targets"][0]
        self.assertEqual(target["elevation_m"], 100)
        self.assertIsNone(target["height_m"])
        self.assertEqual(target["sample_kind"], "summit_point")

    def test_landmark_without_height_is_explicit_ground_anchor(self):
        monument = {"type": "node", "id": 1, "lat": 0, "lon": .001,
                    "tags": {"historic": "monument", "ele": "10"}}
        target = normalize([monument])["targets"][0]
        self.assertEqual(target["elevation_m"], 10)
        self.assertEqual(target["ground_elevation_m"], 10)
        self.assertIsNone(target["height_m"])
        self.assertEqual(target["sample_kind"], "ground_anchor")

    def test_tower_without_ele_defers_absolute_top_to_terrain(self):
        tower = {"type": "node", "id": 1, "lat": 0, "lon": .001,
                 "tags": {"man_made": "tower", "height": "100"}}
        target = normalize([tower])["targets"][0]
        self.assertIsNone(target["elevation_m"])
        self.assertIsNone(target["ground_elevation_m"])
        self.assertEqual(target["height_m"], 100)
        self.assertEqual(target["elevation_reference"], "structure_top_requires_ground_elevation")

    def test_sea_on_right_of_eastward_coast_is_south(self):
        scene = normalize([way(tags={"natural": "coastline"}, points=[(0, -.002), (0, .002)])])
        sea = [t for t in scene["targets"] if t["kind"] == "sea"]
        self.assertTrue(sea)
        self.assertTrue(all(t["lat"] < 0 for t in sea))
        self.assertTrue(all(t["elevation_m"] == 0 for t in sea))

    def test_reversing_coast_changes_water_side(self):
        scene = normalize([way(tags={"natural": "coastline"}, points=[(0, .002), (0, -.002)])])
        self.assertTrue(all(t["lat"] > 0 for t in scene["targets"]))

    def test_long_crossing_segment_still_sampled(self):
        scene = normalize([way(tags={"natural": "coastline"}, points=[(0, -.1), (0, .1)])])
        self.assertTrue(scene["targets"])
        self.assertLessEqual(len(scene["targets"]), 48)

    def test_beach_is_not_a_sea_target(self):
        self.assertEqual(normalize([way(tags={"natural": "beach"})])["targets"], [])

    def test_inland_water_is_not_sea(self):
        targets = normalize([way(tags={"natural": "water", "water": "lake"})])["targets"]
        self.assertEqual([t["kind"] for t in targets], ["water"])

    def test_nodes_and_target_radius(self):
        elements = [{"type": "node", "id": 1, "lat": .001, "lon": .001, "tags": {"natural": "peak", "ele": "20"}},
                    {"type": "node", "id": 2, "lat": 1, "lon": 1, "tags": {"tourism": "museum"}}]
        targets = normalize(elements)["targets"]
        self.assertEqual(len(targets), 1)
        self.assertEqual(targets[0]["kind"], "mountain")
        self.assertEqual(targets[0]["elevation_m"], 20)


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)

    def test_network_off_by_default(self):
        with patch.object(OpenDataClient, "_download") as download:
            with self.assertRaises(CacheMiss):
                OpenDataClient(self.path).fetch_scene(0, 0)
            download.assert_not_called()

    def test_cache_roundtrip_offline_and_stable_source_id(self):
        raw = json.dumps(payload([way()])).encode()
        with patch.object(OpenDataClient, "_download", return_value=raw) as download:
            a = OpenDataClient(self.path, True).fetch_scene(0, 0)
            b = OpenDataClient(self.path).fetch_scene(0, 0)
        self.assertEqual(a, b)
        self.assertEqual(download.call_count, 1)
        self.assertEqual(a["sources"][0]["sha256"], hashlib.sha256(raw).hexdigest())

    def test_cache_hash_corruption_is_error_even_network_enabled(self):
        with patch.object(OpenDataClient, "_download", return_value=json.dumps(payload([])).encode()):
            OpenDataClient(self.path, True).fetch_scene(0, 0)
        path = next(p for p in self.path.glob("*.json") if ".meta." not in p.name)
        path.write_text('{"elements": []}', encoding="utf-8")
        with patch.object(OpenDataClient, "_download") as download:
            with self.assertRaises(SourceError):
                OpenDataClient(self.path, True).fetch_scene(0, 0)
            download.assert_not_called()

    def test_cache_query_tamper_rejected(self):
        with patch.object(OpenDataClient, "_download", return_value=json.dumps(payload([])).encode()):
            OpenDataClient(self.path, True).fetch_scene(0, 0)
        path = next(self.path.glob("*.meta.json"))
        meta = json.loads(path.read_text())
        meta["query"] = "tampered"
        path.write_text(json.dumps(meta), encoding="utf-8")
        with self.assertRaises(SourceError):
            OpenDataClient(self.path).fetch_scene(0, 0)

    def test_upstream_partial_and_invalid_payload_not_cached(self):
        bad = [b"<html>timeout</html>", json.dumps({"elements": [], "remark": "runtime error: out of memory"}).encode(),
               b'{"elements": []}', b'{"elements": {}}', json.dumps(payload([{"type": "way", "id": True}])).encode(),
               json.dumps(payload([way(), way()])).encode()]
        for raw in bad:
            with self.subTest(raw=raw):
                with patch.object(OpenDataClient, "_download", return_value=raw):
                    with self.assertRaises(SourceError):
                        OpenDataClient(self.path, True).fetch_scene(0, 0)
                self.assertEqual(list(self.path.iterdir()), [])

    def test_provider_error_propagates_without_empty_scene(self):
        with patch.object(OpenDataClient, "_download", side_effect=SourceError("rate limited")):
            with self.assertRaisesRegex(SourceError, "rate limited"):
                OpenDataClient(self.path, True).fetch_scene(0, 0)

    def test_bounds_and_query_injection_rejected(self):
        for args in [(True, 0, 1200), (float("nan"), 0, 1200), (0, float("inf"), 1200), (86, 0, 1200), (0, 181, 1200), (0, 0, 99), (0, 0, 3001), ("0);out;", 0, 1200)]:
            with self.subTest(args=args):
                with self.assertRaises(ValueError):
                    build_query(*args)
        query = build_query(41.6, 41.6, 1200)
        self.assertIn("out meta geom", query)
        self.assertIn("building:part", query)
        self.assertNotIn("beach", query)

    def test_payload_caps_and_bad_coordinates(self):
        with self.assertRaises(ValueError):
            normalize_osm(payload([]), {"lat": math.nan, "lon": 0}, 1200, SOURCE)
        with patch("window_view.sources.MAX_ELEMENTS", 1):
            with self.assertRaises(SourceError):
                normalize([way(1), way(2)])
        with patch("window_view.sources.MAX_VERTICES", 1):
            with self.assertRaises(SourceError):
                normalize([way()])


if __name__ == "__main__":
    unittest.main()
