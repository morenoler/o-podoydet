"""Synthetic regressions for observer-relative roof samples and self-occlusion."""
import unittest

from window_view.geometry import unproject
from window_view.service import estimate, prepare


def point(x, y):
    lat, lon = unproject(x, y, 0, 0)
    return {"lat": lat, "lon": lon}


def scene_with_footprint(vertices):
    ring = [list(unproject(x, y, 0, 0)) for x, y in vertices]
    building = {"id": "demo:neighbor", "polygons": [{"outer": ring, "holes": []}],
                "height_m": 30, "height_basis": "synthetic", "ground_elevation_m": 0,
                "source_ids": ["demo:source"], "tags": {}}
    return {"origin": point(0, 0), "radius_m": 1200, "is_demo": True,
            "buildings": [building], "targets": [],
            "terrain": {"flat_elevation_m": 0, "samples": [], "resolution_m": 1,
                        "source_ids": ["demo:source"]},
            "sources": [{"id": "demo:source", "is_demo": True}], "warnings": []}


def request_at_window(x, y, bearing):
    return {"hotel": {"id": "demo:hotel", **point(0, 0)}, "floor": 2,
            "floor_height_m": 3, "date": "2026-06-21", "utc_offset_minutes": 0,
            "data_mode": "fixture", "scene_id": "demo-roof",
            "room": {"id": "demo:room", "window": {**point(x, y), "bearing_deg": bearing}}}


class RoofOcclusionTests(unittest.TestCase):
    def test_corner_is_selected_relative_to_window_and_endpoint_contact_is_clear(self):
        scene = scene_with_footprint([(50, 50), (70, 50), (70, 70), (50, 70), (50, 50)])
        request = request_at_window(100, 100, 225)
        target = prepare(request, scene)[2][0]
        expected = point(70, 70)
        self.assertAlmostEqual(target["lat"], expected["lat"], places=10)
        self.assertAlmostEqual(target["lon"], expected["lon"], places=10)
        result = estimate(request, scene)["assessments"][0]["targets"][0]
        self.assertEqual(result["status"], "clear_in_model")
        self.assertEqual(result["blockers"], [])

    def test_concave_target_roof_cannot_ignore_its_own_intervening_wall(self):
        # The nearest vertex is the rear notch (0,10), but the ray first
        # enters the front wall at y=5, below the roof. It is not visible.
        scene = scene_with_footprint([(-10, 5), (10, 5), (10, 20), (0, 10),
                                     (-10, 20), (-10, 5)])
        request = request_at_window(0, 0, 0)
        request["room"]["window"]["vertical_fov_deg"] = 160
        result = estimate(request, scene)["assessments"][0]["targets"][0]
        self.assertEqual(result["status"], "blocked")
        self.assertFalse(result["visible_in_model"])
        self.assertEqual(result["blockers"][0]["id"], "demo:neighbor")
        self.assertEqual(result["blockers"][0]["reason"], "building_prism_intersection")
        self.assertAlmostEqual(result["blockers"][0]["distance_m"], 5, places=2)


if __name__ == "__main__":
    unittest.main()
