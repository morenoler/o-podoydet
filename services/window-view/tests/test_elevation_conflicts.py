"""Synthetic Korean-coordinate regressions for conflicting vertical datums."""
from copy import deepcopy
import unittest

from window_view.elevation import reconcile_elevations
from window_view.geometry import assess_target, assess_sun, unproject


ORIGIN = (35.1592, 129.1592)
FLAT = {"flat_elevation_m": 0, "radius_m": 1000}


def point(x, y):
    lat, lon = unproject(x, y, *ORIGIN)
    return {"lat": lat, "lon": lon}


def building(x=50, y=0, tagged=301):
    ring = [list(unproject(a, b, *ORIGIN)) for a, b in
            [(x - 10, y - 10), (x + 10, y - 10), (x + 10, y + 10),
             (x - 10, y + 10), (x - 10, y - 10)]]
    return {"id": "demo:conflicted-building", "polygons": [{"outer": ring, "holes": []}],
            "height_m": 300, "height_basis": "osm_height", "ground_elevation_m": tagged,
            "tags": {"ele": str(tagged), "height": "300"}, "source_ids": ["demo:osm"]}


def scene(tagged=301, dsm=5):
    return {"is_demo": True, "buildings": [building(tagged=tagged)],
            "terrain": {"samples": [{**point(50, 0), "elevation_m": dsm}],
                        "source_ids": ["demo:dsm"]}, "targets": [], "warnings": []}


def observer(**changes):
    return {**point(0, 0), "height_agl_m": 20, "ground_elevation_m": 0,
            "bearing_deg": 90, "horizontal_fov_deg": 90, **changes}


def target(**changes):
    return {"id": "demo:target", "kind": "landmark", **point(100, 0),
            "elevation_m": 20, **changes}


class ElevationConflictTests(unittest.TestCase):
    def test_disagreement_keeps_both_sources_and_withholds_ground(self):
        original = scene()
        result = reconcile_elevations(original)
        self.assertIs(result, original)
        b = result["buildings"][0]
        self.assertTrue(b["ground_elevation_conflict"])
        self.assertIsNone(b["ground_elevation_m"])
        self.assertEqual(b["ground_basis"], "conflict")
        self.assertEqual(b["tags"]["ele"], "301")
        self.assertEqual([c["elevation_m"] for c in b["ground_elevation_candidates"]], [301, 5])
        self.assertEqual([c["source_ids"] for c in b["ground_elevation_candidates"]], [["demo:osm"], ["demo:dsm"]])
        self.assertLess(b["ground_elevation_candidates"][1]["distance_m"], 0.01)

    def test_offline_reconciliation_is_idempotent(self):
        value = reconcile_elevations(scene())
        saved = deepcopy(value)
        reconcile_elevations(value)
        self.assertEqual(value, saved)
        self.assertEqual(len(value["warnings"]), 1)

    def test_dsm_higher_is_also_a_conflict_not_a_winner(self):
        b = reconcile_elevations(scene(tagged=5, dsm=301))["buildings"][0]
        self.assertTrue(b["ground_elevation_conflict"])
        self.assertIsNone(b["ground_elevation_m"])

    def test_broad_conflict_threshold_is_not_a_ground_verification(self):
        for dsm in (300, 201):
            with self.subTest(dsm=dsm):
                b = reconcile_elevations(scene(dsm=dsm))["buildings"][0]
                self.assertFalse(b.get("ground_elevation_conflict", False))
                self.assertEqual(b["ground_elevation_m"], 301)
                self.assertEqual(b["ground_elevation_candidates"][1]["basis"], "approximate_dsm")

    def test_distant_dsm_does_not_create_a_spurious_conflict(self):
        value = scene()
        value["terrain"]["samples"][0].update(point(500, 0))
        b = reconcile_elevations(value)["buildings"][0]
        self.assertNotIn("ground_elevation_conflict", b)
        self.assertEqual(b["ground_elevation_m"], 301)

    def test_later_missing_samples_do_not_resolve_recorded_conflict(self):
        value = reconcile_elevations(scene())
        candidates = deepcopy(value["buildings"][0]["ground_elevation_candidates"])
        value["terrain"]["samples"] = []
        b = reconcile_elevations(value)["buildings"][0]
        self.assertTrue(b["ground_elevation_conflict"])
        self.assertEqual(b["ground_elevation_candidates"], candidates)

    def test_later_sample_preserves_prior_conflicting_evidence(self):
        value = reconcile_elevations(scene())
        value["terrain"]["samples"][0]["elevation_m"] = 301
        b = reconcile_elevations(value)["buildings"][0]
        self.assertTrue(b["ground_elevation_conflict"])
        self.assertIsNone(b["ground_elevation_m"])
        self.assertEqual([c["elevation_m"] for c in b["ground_elevation_candidates"]], [301, 5, 301])

    def test_later_fallback_does_not_silently_override_conflict(self):
        value = reconcile_elevations(scene())
        value["terrain"]["samples"] = []
        value["buildings"][0]["ground_elevation_m"] = 5
        b = reconcile_elevations(value)["buildings"][0]
        self.assertIsNone(b["ground_elevation_m"])

    def test_landmark_top_does_not_retain_disputed_absolute_elevation(self):
        value = scene()
        value["targets"] = [target(id="demo:conflicted-building", elevation_m=601)]
        aim = reconcile_elevations(value)["targets"][0]
        self.assertTrue(aim["ground_elevation_conflict"])
        self.assertIsNone(aim["elevation_m"])
        self.assertEqual(len(aim["ground_elevation_candidates"]), 2)

    def test_conflicting_obstacle_does_not_become_a_solid_mountain(self):
        value = reconcile_elevations(scene())
        result = assess_target(observer(), target(), value["buildings"], FLAT)
        self.assertEqual(result["status"], "unknown")
        self.assertIsNone(result["visible_in_model"])
        self.assertEqual(result["blockers"], [])
        self.assertIn("building_ground_elevation_conflict:demo:conflicted-building", result["uncertainties"])

    def test_unrelated_conflicting_building_does_not_poison_other_rays(self):
        b = building(y=100)
        b["ground_elevation_conflict"] = True
        result = assess_target(observer(), target(), [b], FLAT)
        self.assertEqual(result["status"], "clear_in_model")

    def test_independent_known_blocker_remains_decisive(self):
        uncertain = reconcile_elevations(scene())["buildings"][0]
        certain = building(x=75, tagged=0)
        certain["id"] = "demo:independent-blocker"
        result = assess_target(observer(), target(), [uncertain, certain], FLAT)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual([b["id"] for b in result["blockers"]], ["demo:independent-blocker"])

    def test_conflicting_observer_ground_cannot_fall_back_to_dsm(self):
        obs = observer(ground_elevation_m=None, ground_elevation_conflict=True)
        result = assess_target(obs, target(), [], FLAT)
        self.assertEqual(result["status"], "unknown")
        self.assertIn("observer_ground_elevation_conflict", result["uncertainties"])
        solar = assess_sun(obs, 90, 0, [], FLAT)
        self.assertEqual(solar["status"], "unknown")

    def test_conflicting_roof_target_cannot_fall_back_to_dsm(self):
        aim = target(elevation_m=None, ground_elevation_conflict=True, height_m=300)
        result = assess_target(observer(), aim, [], FLAT)
        self.assertEqual(result["status"], "unknown")
        self.assertIn("target_ground_elevation_conflict", result["uncertainties"])

    def test_horizontal_exclusion_does_not_depend_on_vertical_conflict(self):
        result = assess_target(observer(bearing_deg=270, ground_elevation_conflict=True), target(), [], FLAT)
        self.assertEqual(result["status"], "outside_fov")


if __name__ == "__main__":
    unittest.main()
