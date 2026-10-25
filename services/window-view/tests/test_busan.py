"""Busan region packaging, evidence scope and eastern-timezone regressions."""
from datetime import datetime, timedelta, timezone
import unittest

from window_view.api import Application, ROOT, read_json
from window_view.elevation import distance
from window_view.geometry import bearing, project, unproject
from window_view.service import prepare
from window_view.solar import solar_events


class BusanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = Application()
        cls.scene = cls.app.scene("busan-haeundae")
        cls.region = read_json(ROOT / "data/regions.json")["busan-haeundae"]
        cls.request = read_json(ROOT / "examples/real-hotel.json")

    def test_primary_example_is_busan_with_explicit_floor_and_kst(self):
        self.assertEqual(self.request["scene_id"], "busan-haeundae")
        self.assertEqual(self.request["hotel"]["id"], "osm:way:627150752")
        self.assertEqual(self.request["utc_offset_minutes"], 540)
        self.assertEqual(self.request["floor"], 5)
        self.assertNotIn("floor", self.region["request_defaults"])

    def test_real_scene_has_sources_and_unknowns(self):
        scene = self.scene
        self.assertFalse(scene["is_demo"])
        self.assertGreater(len(scene["buildings"]), 2000)
        self.assertGreater(sum(b["height_m"] is None for b in scene["buildings"]), 1000)
        self.assertEqual(len(scene["terrain"]["samples"]), 600)
        self.assertTrue(all(s.get("retrieved_at") and s.get("url") for s in scene["sources"]))
        self.assertFalse(scene["completeness"]["geometry_complete"])

    def test_all_catalog_identities_are_inside_usable_snapshot(self):
        hotels = self.region["hotels"]
        self.assertEqual(len(hotels), 96)
        self.assertEqual(len({h["catalog_id"] for h in hotels}), 96)
        for record in hotels:
            with self.subTest(hotel=record["catalog_id"]):
                hotel = record["hotel"]
                self.assertLess(distance(hotel, self.scene["origin"]), self.scene["radius_m"] - 150)
                self.assertNotIn("rooms", record)
                self.assertEqual(hotel["id"], "osm:" + record["catalog_id"].replace("-", ":", 1))

    def test_main_catalog_parity_when_running_in_repository(self):
        path = ROOT.parents[1] / "data/demo.json"
        if not path.exists():
            self.skipTest("standalone service package; main catalog unavailable")
        hotels = read_json(path)["hotels"]
        exported = {r["catalog_id"]: r["hotel"] for r in self.region["hotels"]}
        self.assertEqual(set(exported), {h["id"] for h in hotels})
        for hotel in hotels:
            self.assertEqual([exported[hotel["id"]]["lon"], exported[hotel["id"]]["lat"]], hotel["coordinates"])

    def test_edge_hotel_without_sea_targets_retains_unknown(self):
        hotel = next(h for h in self.region["hotels"] if h["catalog_id"] == "way-1494488365")
        result = self.app.run({**self.region["request_defaults"], "hotel": hotel["hotel"],
                               "floor": 3, "date": "2026-03-20"})
        self.assertLess(result["room_resolution"]["evaluated_radius_m"], 1200)
        for assessment in result["assessments"]:
            sea = assessment["categories"]["sea"]
            self.assertEqual(sea["sample_count"], 0)
            self.assertEqual(sea["status"], "unknown")
            self.assertIsNone(sea["visible_in_model"])

    def test_standard_variants_and_rooftop_are_not_physical_rooms(self):
        observations = self.app.observations
        self.assertFalse(any(r.get("hotel_id") == self.request["hotel"]["id"] for r in observations["rooms"]))
        claims = [c for c in observations["claims"] if c["hotel_id"] == self.request["hotel"]["id"]]
        standard = next(c for c in claims if c["scope"] == "room_category")
        self.assertEqual(standard["value"], ["city", "ocean"])
        self.assertEqual(standard["floor_range"], [3, 8])
        self.assertEqual(standard["status"], "reported")
        rooftop = next(c for c in claims if c["scope"] == "facility")
        self.assertEqual(rooftop["value"], 18)
        self.assertNotIn("window", rooftop)

    def test_unknown_room_and_number_do_not_infer_floor_or_window(self):
        request = {**self.request, "floor": 5, "room": {"id": "1701"}}
        resolution, observers, _, _ = prepare(request, self.scene, self.app.observations)
        self.assertEqual(resolution["floor"]["floor"], 5)
        self.assertEqual(resolution["scope"], "hotel_floor_scenarios")
        self.assertEqual(len(observers), 8)

    def test_sea_samples_are_south_of_shilla_not_batumi_west(self):
        origin = self.request["hotel"]
        sea = min((t for t in self.scene["targets"] if t["kind"] == "sea"), key=lambda t: distance(origin, t))
        angle = bearing(origin["lat"], origin["lon"], sea["lat"], sea["lon"])
        self.assertTrue(150 < angle < 210, angle)
        self.assertTrue(150 < distance(origin, sea) < 500)
        self.assertEqual(sea["elevation_m"], 0)

    def test_local_civil_dates_across_seasons_and_utc_rollover(self):
        for day in ["2026-01-01", "2026-03-20", "2026-06-21", "2026-09-23", "2026-12-31"]:
            with self.subTest(day=day):
                events = solar_events(day, 35.15983896, 129.1586863, 540)
                for kind in ["sunrise", "sunset"]:
                    stamp = datetime.fromisoformat(events[kind]["time_utc"].replace("Z", "+00:00"))
                    self.assertEqual(stamp.astimezone(timezone(timedelta(hours=9))).date().isoformat(), day)
                self.assertTrue(50 < events["sunrise"]["azimuth_deg"] < 130)
                self.assertTrue(230 < events["sunset"]["azimuth_deg"] < 310)
        events = solar_events("2026-10-24", 35.15983896, 129.1586863, 540)
        self.assertTrue(events["sunrise"]["time_utc"].startswith("2026-10-23"))

    def test_integer_valued_json_offset_is_valid_end_to_end(self):
        integer = prepare(self.request, self.scene)[3]
        floating = prepare({**self.request, "utc_offset_minutes": 540.0}, self.scene)[3]
        self.assertEqual(integer, floating)

    def test_korean_coordinate_projection_round_trip(self):
        for lat, lon in [(35.1601, 129.1602), (35.15, 129.14), (35.17, 129.17)]:
            x, y = project(lat, lon, 35.15983896, 129.1586863)
            actual = unproject(x, y, 35.15983896, 129.1586863)
            self.assertAlmostEqual(actual[0], lat, places=9)
            self.assertAlmostEqual(actual[1], lon, places=9)

    def test_shilla_high_floor_conflict_is_exposed(self):
        resolution = prepare({**self.request, "floor": 30}, self.scene)[0]
        self.assertIn("requested_floor_exceeds_mapped_levels", resolution["conflicts"])
