import argparse
import json
from pathlib import Path

from .api import Application, create_server
from .elevation import enrich, sample_points
from .service import prepare
from .sources import OpenDataClient


def main():
    parser = argparse.ArgumentParser(description="О!Подойдёт — open-data window-view estimates")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8011)
    serve.add_argument("--allow-network", action="store_true")
    serve.add_argument("--cache-dir", default=".cache")
    evaluate = sub.add_parser("evaluate")
    evaluate.add_argument("request")
    evaluate.add_argument("--output")
    evaluate.add_argument("--allow-network", action="store_true")
    collect = sub.add_parser("collect")
    collect.add_argument("request", help="JSON request with hotel coordinates, floor and date")
    collect.add_argument("--output", required=True)
    collect.add_argument("--cache-dir", default=".cache")
    args = parser.parse_args()
    if args.command == "serve":
        server = create_server(args.host, args.port, Application(args.cache_dir, args.allow_network))
        print(f"WindowView http://{args.host}:{server.server_port} (network={args.allow_network})", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
        return
    request = json.loads(Path(args.request).read_text(encoding="utf-8-sig"))
    if args.command == "collect":
        from .validation import validate_request
        validate_request(request)
        hotel = request["hotel"]
        scene = OpenDataClient(Path(args.cache_dir) / "osm", allow_network=True).fetch_scene(hotel["lat"], hotel["lon"], request.get("radius_m", 1200))
        _, observers, targets, events = prepare(request, scene)
        scene = enrich(scene, sample_points(scene, observers, targets, events), args.cache_dir, allow_network=True)
        scene["is_demo"] = False
        result = scene
    else:
        result = Application(allow_network=args.allow_network).run(request)
    content = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.output:
        Path(args.output).write_text(content, encoding="utf-8")
        print(args.output)
    else:
        print(content)


if __name__ == "__main__":
    main()
