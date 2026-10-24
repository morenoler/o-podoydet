"""Independent published numerical reference plus solar boundary tests."""
from datetime import datetime, timedelta, timezone
import unittest
from window_view.solar import solar_position, solar_events


class SolarTests(unittest.TestCase):
    def test_nrel_spa_published_reference(self):
        # NREL/NLR SPA report Appendix A.5 (published numerical result only):
        # https://www.nlr.gov/docs/fy08osti/34302.pdf
        # SPA apparent elevation39.888378 includes refraction. NOAA output is
        # geometric; 0.1deg tolerance accommodates that distinction and model error.
        pos = solar_position(datetime.fromisoformat("2003-10-17T19:30:30+00:00"), 39.742476, -105.1786)
        self.assertAlmostEqual(pos["azimuth_deg"], 194.340241, delta=0.1)
        self.assertAlmostEqual(pos["elevation_deg"], 39.888378, delta=0.1)
        events = solar_events("2003-10-17", 39.742476, -105.1786, -420)
        for key, expected in (("sunrise", "2003-10-17T13:12:43+00:00"), ("sunset", "2003-10-18T00:20:19+00:00")):
            actual = datetime.fromisoformat(events[key]["time_utc"])
            self.assertLess(abs((actual - datetime.fromisoformat(expected)).total_seconds()), 180)

    def test_timezone_same_instant(self):
        utc = datetime.fromisoformat("2026-06-21T09:00:00+00:00")
        self.assertEqual(solar_position(utc, 41.6, 41.6), solar_position(utc.astimezone(timezone(timedelta(hours=4))), 41.6, 41.6))

    def test_naive_rejected(self):
        with self.assertRaises(ValueError):
            solar_position(datetime(2026, 1, 1), 0, 0)

    def test_polar_day_night(self):
        day = solar_events("2026-06-21", 80, 0, 0)
        night = solar_events("2026-12-21", 80, 0, 0)
        self.assertEqual(day["polar_state"], "polar_day")
        self.assertEqual(night["polar_state"], "polar_night")
        self.assertIsNone(day["sunrise"])
        self.assertIsNone(night["sunset"])

    def test_southern_polar_seasons(self):
        self.assertEqual(solar_events("2026-06-21", -80, 0, 0)["polar_state"], "polar_night")
        self.assertEqual(solar_events("2026-12-21", -80, 0, 0)["polar_state"], "polar_day")

    def test_event_threshold_and_local_date(self):
        result = solar_events("2024-02-29", 41.6, 41.6, 240)
        for key in ("sunrise", "sunset"):
            event = result[key]
            self.assertAlmostEqual(event["elevation_deg"], -0.833, places=5)
            local = datetime.fromisoformat(event["time_utc"]).astimezone(timezone(timedelta(hours=4)))
            self.assertEqual(local.date().isoformat(), "2024-02-29")

    def test_date_line_local_day(self):
        for lon, offset in ((179, 840), (-179, -720)):
            result = solar_events("2026-03-21", 0, lon, offset)
            for key in ("sunrise", "sunset"):
                local = datetime.fromisoformat(result[key]["time_utc"]).astimezone(timezone(timedelta(minutes=offset)))
                self.assertEqual(local.date().isoformat(), "2026-03-21")

    def test_invalid_dates_and_offsets(self):
        for offset in (True, 840.1, 841, -841):
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                solar_events("2026-01-01", 0, 0, offset)
        with self.assertRaises(ValueError):
            solar_events("2026-02-30", 0, 0, 0)


if __name__ == "__main__":
    unittest.main()
