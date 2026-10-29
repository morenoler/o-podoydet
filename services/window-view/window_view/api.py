"""Small standalone JSON HTTP service; bounded bodies and serial expensive jobs."""
from copy import deepcopy
import hashlib
import gzip
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading

from .elevation import enrich, sample_points
from .service import estimate, prepare
from .sources import OpenDataClient, SourceError, CacheMiss
from .validation import ValidationError, validate_request

ROOT = Path(__file__).resolve().parents[1]
MAX_BODY = 32 * 1024


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


class Application:
    def __init__(self, cache_dir=None, allow_network=False, scenes=None, observations=None):
        self.cache_dir = Path(cache_dir or ROOT / ".cache")
        self.allow_network = allow_network
        self.scenes = scenes
        self.observations = observations if observations is not None else read_json(ROOT / "data/open/published_views.json")

    def scene(self, scene_id):
        if self.scenes is not None:
            if scene_id not in self.scenes:
                raise ValidationError("Unknown scene_id")
            return deepcopy(self.scenes[scene_id])
        index = read_json(ROOT / "data/scenes.json")
        if scene_id not in index:
            raise ValidationError("Unknown scene_id; see GET /v1/scenes")
        item = index[scene_id]
        path = (ROOT / item["path"]).resolve()
        if not path.is_relative_to(ROOT / "data"):
            raise SourceError("Invalid scene index path")
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != item["sha256"]:
            raise SourceError("Packaged scene integrity mismatch")
        return json.loads(gzip.decompress(raw) if path.suffix == ".gz" else raw)

    def run(self, request):
        validate_request(request)
        mode = request.get("data_mode", "cached")
        if mode == "live" and not self.allow_network:
            raise PermissionError("Network collection is disabled. Start with --allow-network or use a packaged scene.")
        if request.get("scene_id"):
            scene = self.scene(request["scene_id"])
            if bool(scene.get("is_demo")) != (mode == "fixture"):
                raise ValidationError("Synthetic scenes require fixture mode; real scenes require cached mode")
            if mode == "live":
                raise ValidationError("Use a live hotel query without scene_id to collect fresh-source inputs")
        else:
            hotel = request["hotel"]
            scene = OpenDataClient(self.cache_dir / "osm", allow_network=(mode == "live")).fetch_scene(
                hotel["lat"], hotel["lon"], request.get("radius_m", 1200))
        if not scene.get("terrain"):
            _, observers, targets, events = prepare(request, scene, self.observations)
            scene = enrich(scene, sample_points(scene, observers, targets, events), self.cache_dir, mode == "live")
        return estimate(request, scene, self.observations)


def create_server(host="127.0.0.1", port=8011, application=None):
    application = application or Application()
    busy = threading.BoundedSemaphore(1)

    class Handler(BaseHTTPRequestHandler):
        server_version = "WindowView/0.1"

        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def send_json(self, status, value):
            raw = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if self.path == "/health":
                self.send_json(200, {"ok": True, "service": "window-view", "network_enabled": application.allow_network})
            elif self.path == "/openapi.json":
                self.send_json(200, read_json(ROOT / "openapi.json"))
            elif self.path == "/v1/scenes":
                index = {key: {k: v for k, v in item.items() if k not in {"sha256", "path"}} for key, item in read_json(ROOT / "data/scenes.json").items()}
                self.send_json(200, index)
            elif self.path == "/v1/regions":
                self.send_json(200, read_json(ROOT / "data/regions.json"))
            else:
                self.send_json(404, {"error": "not_found"})

        def do_POST(self):
            if self.path != "/v1/views/estimate":
                self.send_json(404, {"error": "not_found"})
                return
            if self.headers.get("Transfer-Encoding"):
                self.send_json(400, {"error": "chunked_requests_not_supported"})
                return
            if self.headers.get_content_type() != "application/json":
                self.send_json(415, {"error": "application_json_required"})
                return
            try:
                length = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                length = -1
            if not 0 < length <= MAX_BODY:
                self.send_json(413, {"error": "invalid_or_excessive_body_length", "max_bytes": MAX_BODY})
                return
            if not busy.acquire(blocking=False):
                self.send_json(429, {"error": "assessment_in_progress", "retry_after_seconds": 3})
                return
            try:
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValidationError("Incomplete body")
                request = json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValidationError("Non-finite JSON value")))
                status, response = 200, application.run(request)
            except (ValidationError, json.JSONDecodeError, UnicodeDecodeError) as error:
                status, response = 422, {"error": "invalid_request", "detail": str(error)[:300]}
            except PermissionError as error:
                status, response = 403, {"error": "network_disabled", "detail": str(error)}
            except CacheMiss as error:
                status, response = 503, {"error": "source_cache_missing", "detail": str(error)[:300]}
            except SourceError as error:
                status, response = 502, {"error": "source_unavailable", "detail": str(error)[:300]}
            except Exception:
                # Avoid leaking file paths, credentials or upstream internals.
                status, response = 500, {"error": "internal_error"}
            finally:
                busy.release()
            # A client may send its next request as soon as it receives this
            # response. Release the calculation slot first, including errors.
            try:
                self.send_json(status, response)
            except (TypeError, ValueError):
                # Serialization still fails closed without exposing internals.
                self.send_json(500, {"error": "internal_error"})

        def log_message(self, format, *args):
            # No payload, room ID or source quote enters access logs.
            return

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server
