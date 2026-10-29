"""Real localhost HTTP boundary tests, entirely synthetic and offline."""
from copy import deepcopy
import http.client
import json
import tempfile
import threading
import unittest
from unittest.mock import patch

from window_view.api import Application, MAX_BODY, create_server
from window_view.sources import CacheMiss, SourceError


def demo_scene():
    return {"origin": {"lat": 0, "lon": 0}, "radius_m": 1200, "is_demo": True,
            "buildings": [], "targets": [{"id": "demo:sea", "kind": "sea", "name": "Synthetic sea point",
                "lat": 0, "lon": .001, "height_m": 0, "elevation_m": 0, "source_ids": ["demo:source"]}],
            "terrain": {"flat_elevation_m": 0, "samples": [], "resolution_m": 1, "source_ids": ["demo:source"]},
            "sources": [{"id": "demo:source", "is_demo": True, "method": "synthetic_fixture"}],
            "warnings": ["Synthetic HTTP test scene; no real hotel facts."]}


def valid_request():
    return {"hotel": {"id": "demo:hotel", "lat": 0, "lon": 0}, "floor": 3,
            "date": "2026-06-21", "utc_offset_minutes": 0, "scene_id": "demo-http", "data_mode": "fixture"}


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        # The second synthetic copy deliberately exercises the mode flag; it
        # is never supplied as evidence for an actual hotel.
        classified_real = {**demo_scene(), "is_demo": False}
        self.application = Application(cache_dir=self.directory.name, scenes={"demo-http": demo_scene(), "mode-marker": classified_real}, observations={})
        self.server = create_server("127.0.0.1", 0, self.application)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(3)
        self.directory.cleanup()

    def call(self, method="POST", path="/v1/views/estimate", value=None, raw=None, headers=None):
        body = raw if raw is not None else json.dumps(value if value is not None else valid_request()).encode()
        request_headers = {"Content-Type": "application/json"}
        if headers:
            request_headers.update(headers)
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request(method, path, body=body if method == "POST" else None, headers=request_headers)
            response = connection.getresponse()
            result = response.status, dict(response.getheaders()), json.loads(response.read())
            return result
        finally:
            connection.close()

    def test_health_reports_offline(self):
        status, headers, result = self.call("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(result, {"ok": True, "service": "window-view", "network_enabled": False})
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")

    def test_regions_publish_busan_identities_without_a_default_floor(self):
        status, _, regions = self.call("GET", "/v1/regions")
        self.assertEqual(status, 200)
        busan = regions["busan-haeundae"]
        self.assertEqual(len(busan["hotels"]), 96)
        self.assertEqual(busan["request_defaults"]["utc_offset_minutes"], 540)
        self.assertNotIn("floor", busan["request_defaults"])

    def test_successful_fixture_is_real_http_json(self):
        with patch("window_view.sources.urllib.request.build_opener", side_effect=AssertionError("no external requests")), patch("window_view.elevation.urlopen", side_effect=AssertionError("no external requests")):
            status, headers, result = self.call()
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertTrue(result["is_demo"])
        self.assertFalse(result["actual_visibility_confirmed"])
        self.assertEqual(result["room_resolution"]["scope"], "hotel_floor_scenarios")
        self.assertEqual(len(result["assessments"]), 8)
        self.assertEqual(result["room_resolution"]["floor"]["floor"], 3)

    def test_room_window_uses_one_direction_without_confirming_actual_view(self):
        request = valid_request()
        request["room"] = {"id": "demo:room", "window": {"lat": 0, "lon": 0, "bearing_deg": 90}}
        status, _, result = self.call(value=request)
        self.assertEqual(status, 200)
        self.assertEqual(result["room_resolution"]["scope"], "room_window")
        self.assertEqual(len(result["assessments"]), 1)
        self.assertFalse(result["room_resolution"]["room_view_confirmed"])

    def test_floor_required(self):
        request = valid_request()
        del request["floor"]
        status, _, result = self.call(value=request)
        self.assertEqual(status, 422)
        self.assertIn("floor", result["detail"])

    def test_bool_and_invalid_floor_rejected(self):
        for floor in [True, False, "3", 3.5, -1, 0, 101]:
            with self.subTest(floor=floor):
                request = {**valid_request(), "floor": floor}
                self.assertEqual(self.call(value=request)[0], 422)

    def test_explicit_zero_based_ground_floor_accepted(self):
        request = {**valid_request(), "floor": 0, "ground_floor_number": 0}
        status, _, result = self.call(value=request)
        self.assertEqual(status, 200)
        self.assertEqual(result["room_resolution"]["floor"]["height_agl_m"], 1.6)

    def test_nonfinite_json_and_bad_encoding_rejected(self):
        for raw in [b'{"floor":NaN}', b'{"floor":Infinity}', b'{"floor":-Infinity}', b'{"floor":1e9999}', b'\xff', b'{broken', b'[]', b'null']:
            with self.subTest(raw=raw):
                status, _, result = self.call(raw=raw)
                self.assertEqual(status, 422)
                self.assertEqual(result["error"], "invalid_request")

    def test_unhashable_data_modes_are_validation_errors_not_internal_errors(self):
        for mode in ([], {}, ["cached"], {"mode": "cached"}):
            with self.subTest(mode=mode):
                status, _, result = self.call(value={**valid_request(), "data_mode": mode})
                self.assertEqual(status, 422)
                self.assertEqual(result["error"], "invalid_request")
                self.assertIn("data_mode", result["detail"])

    def test_unknown_fields_and_url_controls_rejected(self):
        for extra in [{"fetch_url": "http://127.0.0.1/private"}, {"data_mode": "anything"}, {"scene_id": "../secret"}]:
            with self.subTest(extra=extra):
                self.assertEqual(self.call(value={**valid_request(), **extra})[0], 422)

    def test_body_type_and_length_limits(self):
        # Header rejections intentionally have no queued body: on Windows a
        # peer closing with unread bytes can reset the socket before its early
        # rejection reaches the client. The server must reject these headers
        # before allocating/reading the declared oversized body.
        self.assertEqual(self.call(raw=b"", headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.call(raw=b"")[0], 413)
        self.assertEqual(self.call(raw=b"", headers={"Content-Length": str(MAX_BODY + 1)})[0], 413)
        self.assertEqual(self.call(raw=b"", headers={"Content-Length": "bogus"})[0], 413)
        self.assertEqual(self.call(raw=b"", headers={"Transfer-Encoding": "chunked"})[0], 400)
        valid = json.dumps(valid_request()).encode()
        self.assertEqual(self.call(raw=valid + b" " * (MAX_BODY - len(valid)))[0], 200)

    def test_unknown_endpoints(self):
        self.assertEqual(self.call("GET", "/missing")[0], 404)
        self.assertEqual(self.call("POST", "/missing", raw=b"")[0], 404)

    def test_network_disabled_before_any_provider_request(self):
        request = valid_request()
        request.pop("scene_id")
        request["data_mode"] = "live"
        with patch("window_view.api.OpenDataClient.fetch_scene", side_effect=AssertionError("must not collect")) as fetch:
            status, _, result = self.call(value=request)
        self.assertEqual(status, 403)
        self.assertEqual(result["error"], "network_disabled")
        fetch.assert_not_called()

    def test_cached_missing_does_not_fetch(self):
        request = valid_request()
        request.pop("scene_id")
        request["data_mode"] = "cached"
        with patch("window_view.sources.urllib.request.build_opener", side_effect=AssertionError("must not fetch")) as opener:
            status, _, result = self.call(value=request)
        self.assertEqual(status, 503)
        self.assertEqual(result["error"], "source_cache_missing")
        opener.assert_not_called()

    def test_fixture_real_mode_mismatches_rejected(self):
        for changes in [{"data_mode": "cached"}, {"scene_id": "mode-marker"}, {"scene_id": "not-packaged"}]:
            with self.subTest(changes=changes):
                self.assertEqual(self.call(value={**valid_request(), **changes})[0], 422)

    def test_source_errors_are_distinct(self):
        for error, expected_status, expected_code in [(CacheMiss("cache absent"), 503, "source_cache_missing"), (SourceError("bad upstream"), 502, "source_unavailable")]:
            with self.subTest(error=error), patch.object(self.application, "run", side_effect=error):
                status, _, result = self.call()
                self.assertEqual(status, expected_status)
                self.assertEqual(result["error"], expected_code)

    def test_internal_error_does_not_leak_and_semaphore_releases(self):
        with patch.object(self.application, "run", side_effect=RuntimeError("secret-path-and-token")):
            status, _, result = self.call()
        self.assertEqual(status, 500)
        self.assertEqual(result, {"error": "internal_error"})
        self.assertEqual(self.call()[0], 200)

    def test_invalid_application_response_is_internal_error_and_releases_slot(self):
        with patch.object(self.application, "run", return_value={"invalid": float("nan")}):
            status, _, result = self.call()
        self.assertEqual(status, 500)
        self.assertEqual(result, {"error": "internal_error"})
        self.assertEqual(self.call()[0], 200)

    def test_concurrent_assessment_receives_bounded_busy_response(self):
        entered, release = threading.Event(), threading.Event()
        first_result = []
        def blocked(_request):
            entered.set()
            if not release.wait(4):
                raise RuntimeError("test release timeout")
            return {"synthetic": True}
        with patch.object(self.application, "run", side_effect=blocked):
            worker = threading.Thread(target=lambda: first_result.append(self.call()), daemon=True)
            worker.start()
            try:
                self.assertTrue(entered.wait(2))
                status, _, result = self.call(raw=b"", headers={"Content-Length": "1"})
                self.assertEqual(status, 429)
                self.assertEqual(result["error"], "assessment_in_progress")
            finally:
                release.set()
                worker.join(5)
        self.assertEqual(first_result[0][0], 200)
        self.assertEqual(self.call()[0], 200)

    def test_completed_response_releases_slot_before_client_receives_it(self):
        # Hold the first response writer after its computation has finished.
        # A subsequent request must be allowed, even while that writer waits.
        handler = self.server.RequestHandlerClass
        send_json = handler.send_json
        writing, release = threading.Event(), threading.Event()
        first_result = []
        writer_threads = []

        def held_response(instance, status, value):
            if not writing.is_set():
                writer_threads.append(threading.current_thread())
                writing.set()
                if not release.wait(4):
                    raise RuntimeError("test response release timeout")
            return send_json(instance, status, value)

        with patch.object(handler, "send_json", held_response), patch.object(self.application, "run", return_value={"synthetic": True}):
            worker = threading.Thread(target=lambda: first_result.append(self.call()), daemon=True)
            worker.start()
            try:
                self.assertTrue(writing.wait(2))
                self.assertEqual(self.call()[0], 200)
            finally:
                release.set()
                worker.join(5)
                for writer in writer_threads:
                    writer.join(5)
        self.assertEqual(first_result[0][0], 200)


if __name__ == "__main__":
    unittest.main()
