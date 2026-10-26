"""Synthetic geometry only; none of these rooms belongs to a real hotel."""
import math
import unittest
from window_view.geometry import assess_target, assess_sun, project, unproject, bearing, point_in_polygon

ORIGIN = (41.6, 41.6)
FLAT = {"flat_elevation_m": 0, "resolution_m": 20, "source_ids": ["demo:flat"], "radius_m": 1000}


def at(x, y):
    lat, lon = unproject(x, y, *ORIGIN)
    return {"lat": lat, "lon": lon}


def observer(**kwargs):
    return {**at(0, 0), "height_agl_m": 10, "ground_elevation_m": 0, "bearing_deg": 90,
            "horizontal_fov_deg": 90, "vertical_fov_deg": 90, "pitch_deg": 0, "exclude_building_ids": [], **kwargs}


def target(x=100, y=0, height=10, **kwargs):
    return {"id": "demo:target", "kind": "landmark", **at(x, y), "elevation_m": height, **kwargs}


def ring(x0=40, y0=-10, x1=60, y1=10):
    return [list(unproject(x, y, *ORIGIN)) for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]]


def building(**kwargs):
    return {"id": "demo:building", "polygons": [{"outer": ring(), "holes": []}], "height_m": 20,
            "height_basis": "osm_height", "ground_elevation_m": 0, "min_height_m": 0, **kwargs}


class GeometryTests(unittest.TestCase):
    def assess(self, buildings=(), obs=None, aim=None, terrain=FLAT):
        return assess_target(obs or observer(), aim or target(), list(buildings), terrain)

    def test_projection_round_trip_antimeridian(self):
        x, y = project(0, -179.999, 0, 179.999)
        self.assertLess(abs(x), 250)
        lat, lon = unproject(x, y, 0, 179.999)
        self.assertAlmostEqual(lat, 0)
        self.assertAlmostEqual(lon, -179.999)

    def test_cardinal_bearings(self):
        self.assertAlmostEqual(bearing(0, 0, 1, 0), 0)
        self.assertAlmostEqual(bearing(0, 0, 0, 1), 90)
        self.assertAlmostEqual(bearing(0, 0, -1, 0), 180)
        self.assertAlmostEqual(bearing(0, 0, 0, -1), 270)

    def test_clear_in_supplied_flat_model(self):
        self.assertEqual(self.assess()["status"], "clear_in_model")

    def test_building_blocks(self):
        result = self.assess([building()])
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["blockers"][0]["id"], "demo:building")

    def test_low_building_does_not_block(self):
        self.assertEqual(self.assess([building(height_m=3)])["status"], "clear_in_model")

    def test_interval_straddles_sightline(self):
        self.assertEqual(self.assess([building(height_m=None, height_range_m=[6, 15])])["status"], "unknown")

    def test_estimate_wholly_above_sightline(self):
        self.assertEqual(self.assess([building(height_m=None, height_range_m=[15, 25])])["status"], "blocked")

    def test_unknown_height_not_ignored(self):
        self.assertEqual(self.assess([building(height_m=None)])["status"], "unknown")

    def test_ground_elevation_affects_blocking(self):
        self.assertEqual(self.assess([building(height_m=2, ground_elevation_m=12)])["status"], "blocked")
        self.assertEqual(self.assess([building(height_m=7, ground_elevation_m=5)])["status"], "blocked")

    def test_known_ground_blocks_even_with_unknown_roof(self):
        result = self.assess([building(height_m=None, ground_elevation_m=12)])
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["blockers"][0]["reason"], "ground_under_building_intersection")

    def test_prism_min_height_allows_underpass(self):
        self.assertEqual(self.assess([building(min_height_m=12)])["status"], "clear_in_model")

    def test_exclusion_must_be_explicit(self):
        self.assertEqual(self.assess([building()], obs=observer(exclude_building_ids=["demo:building"]))["status"], "clear_in_model")
        self.assertEqual(self.assess([building()])["status"], "blocked")

    def test_fov_wrap_and_vertical(self):
        self.assertEqual(self.assess(obs=observer(bearing_deg=355), aim=target(0, 100))["status"], "clear_in_model")
        self.assertEqual(self.assess(obs=observer(bearing_deg=270))["status"], "outside_fov")
        self.assertEqual(self.assess(aim=target(height=1000))["status"], "outside_fov")

    def test_unknown_vertical_datum(self):
        result = self.assess(obs=observer(ground_elevation_m=None), terrain=None)
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(self.assess(obs=observer(ground_elevation_m=None, bearing_deg=270), terrain=None)["status"], "outside_fov")

    def test_missing_terrain_unknown_but_known_building_decisive(self):
        self.assertEqual(self.assess(terrain=None)["status"], "unknown")
        self.assertEqual(self.assess([building()], terrain=None)["status"], "blocked")

    def test_terrain_gap_not_clear(self):
        terrain = {"samples": [{**at(0, 0), "elevation_m": 0}, {**at(100, 0), "elevation_m": 0}], "resolution_m": 5}
        self.assertEqual(self.assess(terrain=terrain)["status"], "unknown")

    def test_sampled_hill_blocks(self):
        terrain = {"samples": [{**at(x, 0), "elevation_m": 20 if 35 <= x <= 65 else 0} for x in range(0, 101, 5)], "resolution_m": 5}
        result = self.assess(terrain=terrain)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["blockers"][0]["id"], "terrain")

    def test_hole_contains_complete_ray(self):
        polygon = {"outer": ring(-100, -100, 200, 100), "holes": [ring(-10, -20, 110, 20)]}
        self.assertFalse(point_in_polygon(list(ORIGIN), polygon))
        self.assertEqual(self.assess([building(polygons=[polygon])])["status"], "clear_in_model")

    def test_hole_does_not_erase_outer_wall(self):
        polygon = {"outer": ring(30, -50, 80, 50), "holes": [ring(40, -30, 70, 30)]}
        self.assertEqual(self.assess([building(polygons=[polygon])])["status"], "blocked")

    def test_earth_curvature_sea_horizon(self):
        result = self.assess(obs=observer(height_agl_m=2), aim=target(x=30000, height=0, kind="sea"))
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["blockers"][0]["id"], "terrain")

    def test_sun_nearby_obstruction(self):
        self.assertEqual(assess_sun(observer(), 90, 1, [building()], FLAT)["status"], "blocked")
        result = assess_sun(observer(), 90, 30, [building()], FLAT)
        self.assertEqual(result["status"], "clear_in_model")
        self.assertIsNone(result["distance_m"])
        self.assertIn("solar_horizon_beyond_radius_unchecked", result["model_limits"])

    def test_flat_model_uses_analytic_horizon_without_work_gap(self):
        result = assess_sun(observer(), 90, 1, [], {"flat_elevation_m": 0, "resolution_m": 1, "radius_m": 50000})
        self.assertEqual(result["status"], "clear_in_model")
        self.assertNotIn("terrain_profile_work_limit", result["uncertainties"])

    def test_near_and_far_targets_declined(self):
        self.assertEqual(self.assess(aim=target(x=0))["status"], "unknown")
        self.assertEqual(self.assess(aim=target(x=60000))["status"], "unknown")

    def test_invalid_nonfinite_and_boolean_inputs(self):
        for value in (float("nan"), True, -1):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.assess(obs=observer(height_agl_m=value))


if __name__ == "__main__":
    unittest.main()
