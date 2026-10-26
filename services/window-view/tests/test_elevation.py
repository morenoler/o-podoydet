"""Offline elevation acquisition, cache integrity and source-preservation tests."""
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

from window_view.elevation import MAX_POINTS, URL, _NoRedirect, enrich, nearest_elevation, sample_points


def scene():
    return {"origin": {"lat": 0, "lon": 0}, "radius_m": 1200, "is_demo": True,
            "buildings": [{"id": "demo:building", "height_m": 12, "ground_elevation_m": None,
                "polygons": [{"outer": [[-.00001, -.00001], [-.00001, .00001], [.00001, .00001], [.00001, -.00001], [-.00001, -.00001]], "holes": []}]}],
            "targets": [{"id": "demo:target", "lat": 0, "lon": 0, "height_m": 5, "elevation_m": None},
                        {"id": "demo:sea", "lat": 0, "lon": 0, "height_m": 0, "elevation_m": 0}],
            "sources": [], "warnings": []}


class Response:
    def __init__(self, raw):
        self.raw = raw
        self.status = 200
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self, size):
        return self.raw[:size]


class ElevationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)
        self.points = [{"lat": 0, "lon": 0}]

    def cached(self, body, *, points=None, **changes):
        points = self.points if points is None else points
        query = urlencode({"latitude": ",".join(str(p["lat"]) for p in points), "longitude": ",".join(str(p["lon"]) for p in points)})
        url = URL + "?" + query
        raw = json.dumps(body) if not isinstance(body, str) else body
        envelope = {"url": url, "body": raw, "sha256": hashlib.sha256(raw.encode()).hexdigest(), "retrieved_at": "2020-01-02T03:04:05+00:00", **changes}
        path = self.path / "elevation" / (hashlib.sha256(url.encode()).hexdigest() + ".json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(envelope), encoding="utf-8")
        return path

    def test_network_disabled_missing_cache_preserves_unknown(self):
        with patch("window_view.elevation.urlopen", side_effect=AssertionError("must remain offline")) as fetch:
            result = enrich(scene(), self.points, self.path)
        fetch.assert_not_called()
        self.assertEqual(result["terrain"]["samples"], [])
        self.assertIsNone(result["buildings"][0]["ground_elevation_m"])
        self.assertIsNone(result["targets"][0]["elevation_m"])
        self.assertEqual(result["targets"][1]["elevation_m"], 0)
        self.assertTrue(any("cache missing" in w for w in result["warnings"]))

    def test_cache_read_does_not_refresh_dates_or_network(self):
        path = self.cached({"elevation": [7]})
        original = path.read_bytes()
        with patch("window_view.elevation.urlopen", side_effect=AssertionError("do not refresh cache")) as fetch:
            result = enrich(scene(), self.points, self.path, True)
        fetch.assert_not_called()
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(result["sources"][0]["retrieved_at"], "2020-01-02T03:04:05+00:00")
        self.assertIsNone(result["sources"][0]["source_updated_at"])
        self.assertEqual(result["buildings"][0]["ground_elevation_m"], 7)
        self.assertEqual(result["targets"][0]["elevation_m"], 12)

    def test_tagged_elevation_is_not_overwritten_by_dem(self):
        self.cached({"elevation": [7]})
        original = scene()
        original["buildings"][0]["ground_elevation_m"] = 100
        original["targets"][0]["elevation_m"] = 200
        result = enrich(original, self.points, self.path)
        self.assertEqual(result["buildings"][0]["ground_elevation_m"], 100)
        self.assertEqual(result["targets"][0]["elevation_m"], 200)
        self.assertNotIn("ground_basis", result["buildings"][0])

    def test_checksum_and_url_tampering_rejected_without_refetch(self):
        for changes in [{"sha256": "wrong"}, {"url": "https://example.invalid/wrong"}]:
            with self.subTest(changes=changes):
                self.cached({"elevation": [7]}, **changes)
                with patch("window_view.elevation.urlopen", side_effect=AssertionError("no refresh of corrupt cache")) as fetch:
                    result = enrich(scene(), self.points, self.path, True)
                fetch.assert_not_called()
                self.assertEqual(result["terrain"]["samples"], [])
                self.assertTrue(any("integrity" in w for w in result["warnings"]))

    def test_invalid_response_values_are_not_cached(self):
        values = [[True], [False], [None], ["8"], [math.nan], [math.inf], [-math.inf], [-501], [9001], [], [1, 2]]
        for value in values:
            with self.subTest(value=value), patch("window_view.elevation.urlopen", return_value=Response(json.dumps({"elevation": value}).encode())):
                result = enrich(scene(), self.points, self.path, True)
                self.assertEqual(result["terrain"]["samples"], [])
                self.assertEqual(list(self.path.glob("elevation/*.json")), [])

    def test_network_success_caches_then_offline_replays(self):
        with patch("window_view.elevation.urlopen", return_value=Response(b'{"elevation":[8.5]}')) as fetch, patch("window_view.elevation.time.sleep"):
            result = enrich(scene(), self.points, self.path, True)
        self.assertEqual(fetch.call_count, 1)
        request = fetch.call_args.args[0]
        self.assertTrue(request.full_url.startswith(URL + "?"))
        self.assertEqual(fetch.call_args.kwargs["timeout"], 20)
        with patch("window_view.elevation.urlopen", side_effect=AssertionError("must use cache")):
            replay = enrich(scene(), self.points, self.path)
        self.assertEqual(result, replay)
        self.assertEqual(result["terrain"]["returned_points"], 1)

    def test_provider_error_and_html_are_not_empty_success(self):
        responses = [b"<html>upstream error</html>", b'{"error":true}', b"null", b'{"elevation":null}']
        for raw in responses:
            with self.subTest(raw=raw), patch("window_view.elevation.urlopen", return_value=Response(raw)):
                result = enrich(scene(), self.points, self.path, True)
                self.assertEqual(result["terrain"]["samples"], [])
                self.assertTrue(any("elevation_unavailable" in w for w in result["warnings"]))
        with patch("window_view.elevation.urlopen", side_effect=TimeoutError("provider timeout")) as fetch:
            result = enrich(scene(), self.points * 250, self.path, True)
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(result["terrain"]["returned_points"], 0)

    def test_oversize_network_response_rejected(self):
        with patch("window_view.elevation.urlopen", return_value=Response(b" " * 100001)):
            result = enrich(scene(), self.points, self.path, True)
        self.assertEqual(result["terrain"]["returned_points"], 0)
        self.assertTrue(any("too large" in w for w in result["warnings"]))

    def test_partial_batches_keep_exact_coverage_and_stop(self):
        points = [{"lat": 0, "lon": i / 100000} for i in range(250)]
        responses = [Response(json.dumps({"elevation": [1] * 100}).encode()), Response(b'{"elevation":[2]}')]
        with patch("window_view.elevation.urlopen", side_effect=responses) as fetch, patch("window_view.elevation.time.sleep"):
            result = enrich(scene(), points, self.path, True)
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(result["terrain"]["requested_points"], 250)
        self.assertEqual(result["terrain"]["returned_points"], 100)
        self.assertEqual(len(result["sources"]), 1)
        self.assertEqual(len(list(self.path.glob("elevation/*.json"))), 1)

    def test_empty_points_make_no_network_request(self):
        with patch("window_view.elevation.urlopen") as fetch:
            result = enrich(scene(), [], self.path, True)
        fetch.assert_not_called()
        self.assertEqual(result["terrain"]["returned_points"], 0)

    def test_no_elevation_extrapolation_beyond_distance(self):
        samples = [{"lat": 0, "lon": 0, "elevation_m": 8}]
        self.assertEqual(nearest_elevation({"lat": 0, "lon": .0001}, samples), 8)
        self.assertIsNone(nearest_elevation({"lat": 0, "lon": .01}, samples))
        self.assertIsNone(nearest_elevation({"lat": 0, "lon": 0}, []))

    def test_sampling_deduplicates_and_caps_points(self):
        original = scene()
        observer = {"lat": 0, "lon": 0}
        targets = [{"lat": i / 10000, "lon": .01} for i in range(100)]
        points = sample_points(original, [observer, observer], targets, {"sunrise": {"azimuth_deg": 90}})
        self.assertLessEqual(len(points), MAX_POINTS)
        self.assertEqual(len(points), len({(p["lat"], p["lon"]) for p in points}))
        self.assertEqual(points[0], observer)

    def test_bad_cache_body_type_is_degraded_not_exception(self):
        path = self.cached({"elevation": [7]})
        envelope = json.loads(path.read_text())
        envelope["body"] = None
        path.write_text(json.dumps(envelope))
        result = enrich(scene(), self.points, self.path)
        self.assertEqual(result["terrain"]["returned_points"], 0)
        self.assertTrue(any("elevation_unavailable" in w for w in result["warnings"]))

    def test_oversize_cache_and_body_are_rejected(self):
        for spaces in [100001, 160000]:
            with self.subTest(spaces=spaces):
                self.cached(" " * spaces + '{"elevation":[7]}')
                with patch("window_view.elevation.urlopen", side_effect=AssertionError("do not refetch corrupt cache")):
                    result = enrich(scene(), self.points, self.path, True)
                self.assertEqual(result["terrain"]["returned_points"], 0)
                self.assertTrue(any("elevation_unavailable" in w for w in result["warnings"]))

    def test_invalid_cache_provenance_does_not_gain_current_timestamp(self):
        for value in ["yesterday", "2020-01-01T00:00:00", None]:
            with self.subTest(value=value):
                self.cached({"elevation": [7]}, retrieved_at=value)
                result = enrich(scene(), self.points, self.path)
                self.assertEqual(result["sources"], [])
                self.assertEqual(result["terrain"]["returned_points"], 0)

    def test_missing_second_cached_batch_preserves_partial_coverage(self):
        points = [{"lat": 0, "lon": i / 100000} for i in range(150)]
        self.cached({"elevation": [3] * 100}, points=points[:100])
        with patch("window_view.elevation.urlopen", side_effect=AssertionError("must stay offline")):
            result = enrich(scene(), points, self.path)
        self.assertEqual(result["terrain"]["requested_points"], 150)
        self.assertEqual(result["terrain"]["returned_points"], 100)
        self.assertTrue(any("cache missing" in w for w in result["warnings"]))

    def test_input_count_cap_rejects_without_network(self):
        with patch("window_view.elevation.urlopen") as fetch:
            with self.assertRaises(ValueError):
                enrich(scene(), self.points * (MAX_POINTS + 1), self.path, True)
        fetch.assert_not_called()

    def test_redirect_cannot_retarget_fixed_provider(self):
        with self.assertRaises(ValueError):
            _NoRedirect().redirect_request(None, None, 302, "Moved", {}, "http://127.0.0.1/private")

    def test_nonfinite_and_out_of_range_input_points_never_reach_provider(self):
        for point in [{"lat": math.nan, "lon": 0}, {"lat": 0, "lon": math.inf}, {"lat": 91, "lon": 0}, {"lat": 0, "lon": 181}, {"lat": True, "lon": 0}]:
            with self.subTest(point=point), patch("window_view.elevation.urlopen", return_value=Response(b'{"elevation":[1]}')) as fetch, patch("window_view.elevation.time.sleep"):
                try:
                    result = enrich(scene(), [point], self.path, True)
                except ValueError:
                    result = None
                fetch.assert_not_called()
                if result is not None:
                    self.assertEqual(result["terrain"]["returned_points"], 0)


if __name__ == "__main__":
    unittest.main()
