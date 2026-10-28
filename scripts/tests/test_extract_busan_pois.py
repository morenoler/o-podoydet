"""Pure stdlib geometry/provenance checks. No osmium import and no real-data mutation."""
import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

SCRIPT = Path(__file__).resolve().parents[1] / "extract-busan-pois.py"
spec = importlib.util.spec_from_file_location("extract_busan_pois", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExtractBusanPoisTest(unittest.TestCase):
    def test_configured_selectors_do_not_invent_city_center_or_mix_rail_modes(self):
        config = json.loads((SCRIPT.parent.parent / "data/busan/place-categories.json").read_text(encoding="utf-8"))
        selectors = module.parse_selectors(config)
        self.assertEqual(["cafe"], module.matching_kinds({"amenity": "cafe"}, selectors))
        self.assertEqual(["subway"], module.matching_kinds({"railway": "station", "subway": "yes"}, selectors))
        self.assertEqual(["train_station"], module.matching_kinds({"railway": "station"}, selectors))
        self.assertEqual([], module.matching_kinds({"place": "city", "name": "Synthetic town"}, selectors))

    def test_unknown_selector_cannot_become_match_everything(self):
        for selector in ("", "[amenity~cafe]", "[amenity=cafe] garbage"):
            with self.assertRaises(ValueError):
                module.parse_selectors([{"key": "cafe", "osmQueries": [selector]}])

    def test_bbox_uses_lon_lat_inclusive_boundaries(self):
        box = module.checked_bbox([128, 34, 130, 36])
        self.assertTrue(module.point_in_bbox(128, 34, box))
        self.assertTrue(module.point_in_bbox(130, 36, box))
        self.assertFalse(module.point_in_bbox(35, 129, box))
        self.assertFalse(module.point_in_bbox(float("nan"), 35, box))
        for invalid in ([129, 36, 128, 35], [0, 0, 181, 1], [0, False, 1, 1]):
            with self.assertRaises(ValueError):
                module.checked_bbox(invalid)

    def test_representative_way_position_is_bbox_center(self):
        box = module.bounds([(129.0, 35.0), (129.1, 35.2), (129.0, 35.0)])
        self.assertEqual((129.0, 35.0, 129.1, 35.2), box)
        self.assertEqual({"lon": 129.05, "lat": 35.1}, module.representative_position(box))
        self.assertIsNone(module.bounds([]))

    def test_invalid_coordinates_are_rejected(self):
        for points in ([(181, 35)], [(129, 91)], [(float("inf"), 35)]):
            with self.assertRaises(ValueError):
                module.bounds(points)

    def test_relation_needs_all_members_and_never_connects_nested_geometry(self):
        nodes = {1: (129, 35, 129, 35)}
        ways = {2: (129.1, 35.1, 129.2, 35.2)}
        self.assertEqual(((129, 35, 129.2, 35.2), None), module.resolve_relation([("n", 1), ("w", 2)], nodes, ways))
        self.assertEqual((None, "unresolved_relation_geometry"), module.resolve_relation([("w", 3)], nodes, ways))
        self.assertEqual((None, "excluded_nested_relation"), module.resolve_relation([("r", 3)], nodes, ways))

    def test_missing_object_date_is_not_replaced_by_retrieval_time(self):
        obj = SimpleNamespace(id=1, version=2, timestamp=datetime(1970, 1, 1, tzinfo=timezone.utc))
        self.assertNotIn("timestamp", module.object_metadata(obj, "node", {"name": "Synthetic cafe"}))
        obj.timestamp = datetime(2000, 1, 1, tzinfo=timezone.utc)
        self.assertEqual("2000-01-01T00:00:00Z", module.object_metadata(obj, "node", {})["timestamp"])

    def test_boundary_comes_from_integrity_checked_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            snapshot = root / "boundary.json"
            snapshot.write_text(json.dumps({"elements": [{"type": "relation", "id": 123, "bounds": {"minlon": 128, "minlat": 34, "maxlon": 130, "maxlat": 36}}]}), encoding="utf-8")
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"boundaryRelationId": 123, "entries": {"boundary": {"path": "boundary.json", "bytes": snapshot.stat().st_size, "sha256": module.sha256(snapshot)}}}), encoding="utf-8")
            self.assertEqual([128, 34, 130, 36], module.load_bbox(manifest)[0])
            snapshot.write_text("{}", encoding="utf-8")
            with self.assertRaises(ValueError):
                module.load_bbox(manifest)


if __name__ == "__main__":
    unittest.main()
