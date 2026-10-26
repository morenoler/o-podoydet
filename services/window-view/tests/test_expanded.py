"""Independent adversarial cases; synthetic coordinates are not real room evidence."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import math
import unittest

from window_view.geometry import assess_target, assess_sun, point_in_polygon
from window_view.solar import solar_position, solar_events
from window_view.validation import ValidationError, validate_request
from window_view.service import estimate


METRES_PER_DEGREE = math.pi * 6371000 / 180
FLAT = {"flat_elevation_m": 0, "resolution_m": 1,
        "source_ids": ["demo:expanded-flat-terrain"]}


def location(east, north):
    return [north / METRES_PER_DEGREE, east / METRES_PER_DEGREE]


def ring(left, bottom, right, top):
    return [location(left, bottom), location(right, bottom),
            location(right, top), location(left, top), location(left, bottom)]


def observer(**extra):
    value = {"lat": 0, "lon": 0, "height_agl_m": 20,
             "ground_elevation_m": 0, "bearing_deg": 90,
             "horizontal_fov_deg": 90, "vertical_fov_deg": 160,
             "pitch_deg": 0, "exclude_building_ids": []}
    value.update(extra)
    return value


def target(east=100, north=0, **extra):
    lat, lon = location(east, north)
    value = {"id": "demo:target", "kind": "landmark", "name": "Synthetic target",
             "lat": lat, "lon": lon, "height_m": 0,
             "elevation_m": 20, "source_ids": ["demo:expanded"]}
    value.update(extra)
    return value


def building(**extra):
    value = {"id": "demo:blocker", "name": "Synthetic building",
             "polygons": [{"outer": ring(40, -10, 60, 10), "holes": []}],
             "height_m": 30, "height_range_m": None, "height_basis": "osm_height",
             "min_height_m": 0, "ground_elevation_m": 0,
             "source_ids": ["demo:expanded"], "tags": {}}
    value.update(extra)
    return value


class ExpandedGeometry(unittest.TestCase):
    def assertStatus(self, expected, observation=None, destination=None, blocks=None,
                     terrain=FLAT):
        result = assess_target(observation or observer(), destination or target(),
                               [] if blocks is None else blocks, terrain)
        self.assertEqual(result["status"], expected, result)
        if expected == "unknown":
            self.assertIsNone(result["visible_in_model"], result)
        elif expected == "clear_in_model":
            self.assertIs(result["visible_in_model"], True, result)
        else:
            self.assertIs(result["visible_in_model"], False, result)
        return result

    def test_roof_height_changes_outcome(self):
        for height in [0, 2, 5, 10, 15, 19]:
            with self.subTest(height=height):
                self.assertStatus("clear_in_model", blocks=[building(height_m=height)])
        for height in [21, 30, 50, 100, 500]:
            with self.subTest(height=height):
                self.assertStatus("blocked", blocks=[building(height_m=height)])

    def test_observer_height_changes_outcome(self):
        for height, expected in [(5, "blocked"), (10, "blocked"), (30, "clear_in_model"),
                                 (50, "clear_in_model"), (100, "clear_in_model")]:
            with self.subTest(height=height):
                self.assertStatus(expected, observation=observer(height_agl_m=height),
                                  destination=target(elevation_m=height),
                                  blocks=[building(height_m=20)])

    def test_unknown_building_height_is_not_empty_space(self):
        self.assertStatus("unknown", blocks=[building(height_m=None, height_basis="unknown")])

    def test_height_interval_crossing_ray_is_uncertain(self):
        for interval, expected in [([1, 10], "clear_in_model"),
                                   ([10, 30], "unknown"), ([30, 40], "blocked")]:
            with self.subTest(interval=interval):
                self.assertStatus(expected, blocks=[building(height_m=sum(interval) / 2,
                                  height_range_m=interval, height_basis="estimated_levels")])

    def test_absolute_ground_elevation_changes_blocker(self):
        self.assertStatus("clear_in_model", blocks=[building(height_m=10)])
        self.assertStatus("blocked", blocks=[building(height_m=10, ground_elevation_m=15)])

    def test_open_space_below_raised_building(self):
        self.assertStatus("clear_in_model", blocks=[building(height_m=40, min_height_m=25)])
        self.assertStatus("blocked", blocks=[building(height_m=40, min_height_m=15)])

    def test_blocker_behind_target_ignored(self):
        distant = building(polygons=[{"outer": ring(150, -20, 200, 20), "holes": []}])
        self.assertStatus("clear_in_model", blocks=[distant])

    def test_unrelated_polygons_not_joined(self):
        disjoint = building(polygons=[{"outer": ring(40, 20, 60, 40), "holes": []},
                                      {"outer": ring(40, -40, 60, -20), "holes": []}])
        self.assertStatus("clear_in_model", blocks=[disjoint])

    def test_hole_is_not_solid_building(self):
        courtyard = {"outer": ring(-100, -100, 100, 100),
                     "holes": [ring(-70, -70, 70, 70)]}
        self.assertFalse(point_in_polygon(location(0, 0), courtyard))
        self.assertTrue(point_in_polygon(location(80, 0), courtyard))
        self.assertStatus("clear_in_model", destination=target(east=50),
                          blocks=[building(polygons=[courtyard])])
        self.assertStatus("blocked", destination=target(east=120),
                          blocks=[building(polygons=[courtyard])])

    def test_self_building_requires_explicit_exclusion(self):
        own = building(polygons=[{"outer": ring(-10, -10, 10, 10), "holes": []}])
        self.assertStatus("blocked", blocks=[own])
        self.assertStatus("clear_in_model", observation=observer(
            exclude_building_ids=[own["id"]]), blocks=[own])

    def test_known_horizontal_exclusion_survives_missing_elevation(self):
        self.assertStatus("outside_fov", observation=observer(bearing_deg=270,
            ground_elevation_m=None), terrain=None)

    def test_wraparound_near_north(self):
        for window, point_bearing in [(359, 1), (1, 359), (0, 359), (359, 0)]:
            with self.subTest(window=window, point_bearing=point_bearing):
                dest = target(east=100 * math.sin(math.radians(point_bearing)),
                              north=100 * math.cos(math.radians(point_bearing)))
                self.assertStatus("clear_in_model", observation=observer(
                    bearing_deg=window, horizontal_fov_deg=10), destination=dest)

    def test_vertical_field_of_view_and_pitch(self):
        elevated = target(elevation_m=120)
        self.assertStatus("outside_fov", observation=observer(vertical_fov_deg=20),
                          destination=elevated)
        self.assertStatus("clear_in_model", observation=observer(vertical_fov_deg=20,
                          pitch_deg=45), destination=elevated)

    def test_unknown_terrain_never_silently_assumes_flat_ground(self):
        self.assertStatus("unknown", terrain=None)
        self.assertStatus("unknown", observation=observer(ground_elevation_m=None),
                          terrain=None)

    def test_clear_blocker_decision_does_not_need_complete_terrain(self):
        self.assertStatus("blocked", blocks=[building()], terrain=None)

    def test_inputs_are_not_mutated(self):
        obs, dest, blocks, ground = observer(), target(), [building()], deepcopy(FLAT)
        before = deepcopy([obs, dest, blocks, ground])
        assess_target(obs, dest, blocks, ground)
        self.assertEqual([obs, dest, blocks, ground], before)

    def test_sun_uses_direction_not_finite_nearby_target(self):
        blocked = assess_sun(observer(), 90, 5, [building(height_m=100)], FLAT)
        self.assertEqual(blocked["status"], "blocked", blocked)
        away = assess_sun(observer(), 270, 5, [building(height_m=100)], FLAT)
        self.assertEqual(away["status"], "outside_fov", away)

    def test_curvature_blocks_distant_sea_at_low_eye_height(self):
        sea = target(east=15000, kind="sea", elevation_m=0)
        # Deliberately coarser constant plane keeps the 15 km test inside the
        # documented profile work bound; this is not a real terrain snapshot.
        terrain = {**FLAT, "resolution_m": 50}
        self.assertStatus("blocked", observation=observer(height_agl_m=2), destination=sea,
                          terrain=terrain)
        self.assertStatus("clear_in_model", observation=observer(height_agl_m=100), destination=sea,
                          terrain=terrain)


class ExpandedSolar(unittest.TestCase):
    def test_independent_nrel_spa_published_position(self):
        # NREL/TP-560-34302 Appendix A.5. SPA apparent elevation vs geometric
        # elevation differs slightly; this tolerance does not claim SPA precision.
        actual = solar_position(datetime(2003, 10, 17, 19, 30, 30,
                                tzinfo=timezone.utc), 39.742476, -105.1786)
        self.assertAlmostEqual(actual["azimuth_deg"], 194.340241, delta=0.1)
        self.assertAlmostEqual(actual["elevation_deg"], 39.888378, delta=0.1)

    def test_independent_nrel_spa_published_events(self):
        actual = solar_events("2003-10-17", 39.742476, -105.1786, -420)
        for name, reference in [("sunrise", "2003-10-17T13:12:43.46+00:00"),
                                ("sunset", "2003-10-18T00:20:19.19+00:00")]:
            with self.subTest(event=name):
                value = datetime.fromisoformat(actual[name]["time_utc"].replace("Z", "+00:00"))
                error = abs((value - datetime.fromisoformat(reference)).total_seconds())
                self.assertLess(error, 180, f"{name}: error {error}s; {actual}")

    def test_explicit_civil_date_with_fractional_offset(self):
        for offset, lat, lon in [(330, 19.08, 72.88), (-210, 47.56, -52.71),
                                 (840, 1.87, -157.43), (-720, 0, -170)]:
            with self.subTest(offset=offset):
                actual = solar_events("2026-06-21", lat, lon, offset)
                for name in ["sunrise", "sunset"]:
                    instant = datetime.fromisoformat(actual[name]["time_utc"].replace("Z", "+00:00"))
                    local = instant.astimezone(timezone(timedelta(minutes=offset)))
                    self.assertEqual(local.date().isoformat(), "2026-06-21")

    def test_polar_summer_and_winter_have_no_invented_events(self):
        for latitude, day in [(80, "2026-06-21"), (80, "2026-12-21"),
                              (-80, "2026-06-21"), (-80, "2026-12-21")]:
            with self.subTest(latitude=latitude, day=day):
                actual = solar_events(day, latitude, 0, 0)
                self.assertIsNone(actual["sunrise"], actual)
                self.assertIsNone(actual["sunset"], actual)
                self.assertIsNotNone(actual["polar_state"], actual)

    def test_date_and_direction_grid_finite(self):
        for month in [1, 3, 6, 9, 12]:
            for lat, lon in [(0, 0), (41.65, 41.64), (-33.86, 151.21),
                             (70, 179.9), (-70, -179.9)]:
                with self.subTest(month=month, lat=lat, lon=lon):
                    actual = solar_position(datetime(2026, month, 21, 12,
                                            tzinfo=timezone.utc), lat, lon)
                    self.assertTrue(math.isfinite(actual["azimuth_deg"]))
                    self.assertTrue(math.isfinite(actual["elevation_deg"]))
                    self.assertGreaterEqual(actual["azimuth_deg"], 0)
                    self.assertLess(actual["azimuth_deg"], 360)
                    self.assertGreaterEqual(actual["elevation_deg"], -90)
                    self.assertLessEqual(actual["elevation_deg"], 90)


class ExpandedValidation(unittest.TestCase):
    def request(self):
        return {"hotel": {"id": "demo:hotel", "lat": 41.65, "lon": 41.64},
                "floor": 3, "date": "2026-06-21", "utc_offset_minutes": 240}

    def test_floor_is_required_and_not_inferred_from_room_id(self):
        value = self.request()
        value.pop("floor")
        value["room"] = {"id": "1203"}
        with self.assertRaises(ValidationError):
            validate_request(value)

    def test_floor_and_offset_type_boundaries(self):
        for field, values in {"floor": [True, "3", 3.5, -1, 101, math.nan, math.inf],
                              "utc_offset_minutes": [False, 240.5, -721, 841]}.items():
            for invalid in values:
                with self.subTest(field=field, value=invalid):
                    request = self.request()
                    request[field] = invalid
                    with self.assertRaises(ValidationError):
                        validate_request(request)

    def test_explicit_ground_floor_number(self):
        value = self.request()
        value.update(floor=0, ground_floor_number=0)
        validate_request(value)
        value["ground_floor_number"] = 1
        with self.assertRaises(ValidationError):
            validate_request(value)

    def test_scene_id_cannot_traverse_filesystem(self):
        for scene_id in ["../secret", "C:\\secret", "scene/other", "", ["scene"]]:
            with self.subTest(scene_id=scene_id):
                value = self.request()
                value.update(data_mode="fixture", scene_id=scene_id)
                with self.assertRaises(ValidationError):
                    validate_request(value)

    def test_window_requires_paired_coordinates(self):
        value = self.request()
        value["room"] = {"id": "demo:room", "window": {"lat": 41.65}}
        with self.assertRaises(ValidationError):
            validate_request(value)

    def test_invalid_dates_and_geometry_are_rejected(self):
        for day in ["2026-02-30", "20260621", "1899-01-01", "2100-01-01", None]:
            with self.subTest(day=day):
                value = self.request()
                value["date"] = day
                with self.assertRaises(ValidationError):
                    validate_request(value)
        for value in [None, math.nan, math.inf, True, "41.65", 91]:
            with self.subTest(latitude=value):
                request = self.request()
                request["hotel"]["lat"] = value
                with self.assertRaises(ValidationError):
                    validate_request(request)

    def test_source_requires_explicit_timestamp_timezone(self):
        value = self.request()
        value["room"] = {"id": "demo:room", "source": {
            "url": "https://example.org/rooms", "quote": "Synthetic metadata",
            "retrieved_at": "2026-10-24T12:00:00"}}
        with self.assertRaises(ValidationError):
            validate_request(value)

    def test_arbitrary_fetch_url_is_not_an_api_option(self):
        value = self.request()
        value["fetch_url"] = "http://127.0.0.1/admin"
        with self.assertRaises(ValidationError):
            validate_request(value)


class ExpandedService(unittest.TestCase):
    def request(self):
        return {"hotel": {"id": "demo:hotel", "lat": 0, "lon": 0},
                "floor": 5, "floor_height_m": 3, "eye_height_m": 1.6,
                "date": "2026-06-21", "utc_offset_minutes": 0,
                "room": {"id": "demo:503", "window": {
                    "lat": 0, "lon": 0, "bearing_deg": 90}}}

    def scene(self):
        return {"origin": {"lat": 0, "lon": 0}, "radius_m": 1200,
                "buildings": [], "targets": [target()], "sources": [],
                "warnings": [], "terrain": deepcopy(FLAT), "is_demo": True}

    def test_height_uses_explicit_floor_convention(self):
        request = self.request()
        result = estimate(request, self.scene())
        self.assertEqual(result["room_resolution"]["floor"]["height_agl_m"], 13.6)
        request.update(floor=0, ground_floor_number=0)
        result = estimate(request, self.scene())
        self.assertEqual(result["room_resolution"]["floor"]["height_agl_m"], 1.6)

    def test_incomplete_room_falls_back_at_same_requested_floor(self):
        request = self.request()
        request["room"] = {"id": "1203"}
        result = estimate(request, self.scene())
        self.assertEqual(result["room_resolution"]["scope"], "hotel_floor_scenarios")
        self.assertEqual(len(result["assessments"]), 8)
        self.assertEqual({a["observer"]["height_agl_m"] for a in result["assessments"]}, {13.6})
        self.assertIs(result["room_resolution"]["room_view_confirmed"], False)

    def test_complete_input_is_not_independent_confirmation(self):
        result = estimate(self.request(), self.scene())
        self.assertEqual(result["room_resolution"]["scope"], "room_window")
        self.assertEqual(len(result["assessments"]), 1)
        self.assertIs(result["actual_visibility_confirmed"], False)
        self.assertIs(result["room_resolution"]["room_view_confirmed"], False)

    def test_category_statement_stays_separate(self):
        claim = {"hotel_id": "demo:hotel", "scope": "room_category",
                 "category_id": "demo:sea-category", "status": "reported",
                 "kind": "sea", "value": True}
        result = estimate(self.request(), self.scene(), {"claims": [claim]})
        self.assertEqual(result["published_claims"], [claim])
        self.assertIsNone(result["assessments"][0]["categories"]["sea"]["visible_in_model"])

    def test_conflicting_room_observations_do_not_choose_first(self):
        request = self.request()
        request["room"] = {"id": "demo:503"}
        records = [{"hotel_id": "demo:hotel", "room_id": "demo:503", "scope": "physical_room",
                    "floor": 5, "window": {"lat": 0, "lon": 0, "bearing_deg": angle}}
                   for angle in [90, 270]]
        result = estimate(request, self.scene(), {"rooms": records})
        self.assertEqual(result["room_resolution"]["scope"], "hotel_floor_scenarios")

    def test_roof_evaluation_uses_roof_height(self):
        scene = self.scene()
        scene["buildings"] = [building(height_m=50)]
        result = estimate(self.request(), scene)
        roof = next(t for t in result["assessments"][0]["targets"]
                    if t["kind"] == "neighbor_building")
        self.assertGreater(roof["elevation_angle_deg"], 30, roof)

    def test_unknown_roof_height_is_not_a_ground_level_roof(self):
        scene = self.scene()
        scene["buildings"] = [building(height_m=None, height_basis="unknown")]
        result = estimate(self.request(), scene)
        roof = next(t for t in result["assessments"][0]["targets"]
                    if t["kind"] == "neighbor_building")
        self.assertEqual(roof["status"], "unknown", roof)

    def test_sun_event_preserves_geometric_and_visibility_ray_semantics(self):
        result = estimate(self.request(), self.scene())
        sunrise = result["assessments"][0]["sun"]["sunrise"]
        self.assertAlmostEqual(sunrise["elevation_deg"], -0.833, delta=0.01)
        self.assertEqual(sunrise["evaluated_elevation_deg"], 0)
        self.assertIs(sunrise["actual_first_or_last_visible_time_computed"], False)

    def test_storey_uncertainty_cannot_miss_thin_raised_obstruction(self):
        request = self.request()
        request["floor"] = 21
        request.pop("floor_height_m")
        scene = self.scene()
        scene["targets"] = [target(elevation_m=80)]
        scene["buildings"] = [building(height_m=68.6, min_height_m=68,
            polygons=[{"outer": ring(49, -10, 51, 10), "holes": []}])]
        result = estimate(request, scene)
        assessed = next(t for t in result["assessments"][0]["targets"]
                        if t["id"] == "demo:target")
        # Nominal 61.6 m and range endpoints 51.6/71.6 all pass above/below
        # the thin prism, but 56.6 m inside that same range is occluded.
        self.assertEqual(assessed["status"], "unknown", assessed)

    def test_floor_conflict_preserves_input_and_withholds_confirmation(self):
        scene = self.scene()
        scene["buildings"] = [building(id="demo:hotel", height_m=6,
            tags={"building:levels": "2"},
            polygons=[{"outer": ring(-10, -10, 10, 10), "holes": []}])]
        result = estimate(self.request(), scene)
        self.assertEqual(result["room_resolution"]["floor"]["floor"], 5)
        self.assertIn("requested_floor_exceeds_mapped_levels", result["room_resolution"]["conflicts"])
        self.assertTrue(all(t["visible_in_model"] is None
                            for t in result["assessments"][0]["targets"]))

    def test_real_empty_building_coverage_is_unknown(self):
        scene = self.scene()
        scene["is_demo"] = False
        result = estimate(self.request(), scene)
        assessed = result["assessments"][0]["targets"][0]
        self.assertEqual(assessed["status"], "unknown", assessed)
        self.assertIn("no_building_coverage", assessed["uncertainties"])

    def test_solar_horizon_radius_does_not_exceed_requested_scene(self):
        request = self.request()
        request["radius_m"] = 200
        scene = self.scene()
        result = estimate(request, scene)
        sunrise = result["assessments"][0]["sun"]["sunrise"]
        self.assertEqual(sunrise["visibility"]["model_radius_m"], 200)

    def test_uncertain_height_cannot_skip_narrow_vertical_fov(self):
        request = self.request()
        request["floor"] = 21
        request.pop("floor_height_m")
        request["room"]["window"].update(pitch_deg=14, vertical_fov_deg=1)
        scene = self.scene()
        scene["targets"] = [target(elevation_m=80)]
        result = estimate(request, scene)
        assessed = result["assessments"][0]["targets"][0]
        # The FOV intersects the height interval between sampled endpoints.
        self.assertEqual(assessed["status"], "unknown", assessed)


if __name__ == "__main__":
    unittest.main()
