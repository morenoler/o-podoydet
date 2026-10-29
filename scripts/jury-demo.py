"""Exercise the synthetic host-dialog demo through its real HTTP API (stdlib only)."""
import argparse
from datetime import datetime, timedelta, timezone
from http.cookiejar import CookieJar
import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener


def trip():
    check_in = datetime.now(timezone(timedelta(hours=9))).date() + timedelta(days=7)
    return {
        "region": "Пусан", "checkIn": check_in.isoformat(),
        "checkOut": (check_in + timedelta(days=3)).isoformat(),
        "adults": 2, "children": 0, "scenarios": [], "text": "",
        "admissionMode": "verified",
        "preferences": [{"feature": "courtyard", "required": True}],
    }


def run(base):
    opener = build_opener(HTTPCookieProcessor(CookieJar()))

    def request(path, payload=None, method=None):
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = Request(base.rstrip("/") + path, data=data, method=method,
                      headers={"Content-Type": "application/json"})
        with opener.open(req, timeout=30) as response:
            return json.load(response)

    # Check the read-only guarded endpoint before any mutation: refuse the ordinary catalog.
    request("/api/v2/questions?hotelId=demo-harbor")
    query = trip()
    before = request("/api/search", query)
    simulated = request("/api/v2/host/demo-harbor/simulate", {}, "POST")
    after = request("/api/search", query)
    matches = after.get("results", [])
    harbor = [item for item in matches if item.get("hotel", {}).get("id") == "demo-harbor"]
    if len(harbor) != 1 or len(matches) != 1:
        raise ValueError("Expected exactly one synthetic courtyard match after the host answer")
    criterion = next((item for item in harbor[0].get("best", {}).get("criteria", [])
                      if item.get("feature") == "courtyard"), {})
    if criterion.get("status") != "match":
        raise ValueError("The room courtyard criterion did not become a match")
    facts = criterion.get("facts", [])
    if not any(item.get("demo") is True or item.get("simulated") is True for item in facts):
        raise ValueError("Search evidence lost its synthetic provenance")
    knowledge = request("/api/v2/hotels/demo-harbor/knowledge")
    print(json.dumps({
        "is_demo": True, "before": len(before.get("results", [])), "after": len(matches),
        "hotelId": "demo-harbor", "answers": len(simulated.get("answers", [])),
        "repeatRun": len(before.get("results", [])) == 1,
        "note": "Синтетический сценарий. Повторный запуск сохраняет ранее полученные ответы.",
        "knowledgeAvailable": bool(knowledge),
    }, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8081")
    args = parser.parse_args()
    try:
        run(args.base)
    except (HTTPError, URLError, TimeoutError, ValueError, KeyError) as error:
        print(f"Демо не прошло проверку: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
