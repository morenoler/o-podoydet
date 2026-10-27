"""Offline-source HTTP checks against an already running isolated two-region server."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import http.cookiejar
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request


def verify(base: str) -> dict:
    request_count = 0
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def api(path, payload=None, expected=200, opener=client):
        nonlocal request_count
        request = urllib.request.Request(base.rstrip("/") + "/api" + path,
            data=None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"})
        try:
            with opener.open(request, timeout=90) as response:
                status, result = response.status, json.load(response)
        except urllib.error.HTTPError as error:
            status, result = error.code, json.load(error)
        request_count += 1
        assert status == expected, (path, status, expected, result)
        return result

    catalogs = {}
    metadata = api("/regions")
    assert metadata["defaultRegion"] == "Пусан"
    assert {r["region"] for r in metadata["regions"]} == {"Пусан", "Сочи"}
    for region, folder in [("Пусан", "busan"), ("Сочи", "sochi")]:
        catalog = api("/catalog?" + urllib.parse.urlencode({"region": region}))
        saved = json.loads(Path(f"data/{folder}/verified-hotels.json").read_text(encoding="utf-8"))
        assert catalog["region"] == region
        assert {h["id"] for h in catalog["hotels"]} == {h["id"] for h in saved["hotels"]}
        assert all(h["region"] == region for h in catalog["hotels"])
        catalogs[region] = catalog
    assert not ({h["id"] for h in catalogs["Сочи"]["hotels"]} & {h["id"] for h in catalogs["Пусан"]["hotels"]})
    api("/catalog?" + urllib.parse.urlencode({"region": "Unknown"}), expected=400)
    today = dt.date.today()
    trip = {"region": "Сочи", "checkIn": str(today + dt.timedelta(days=7)), "checkOut": str(today + dt.timedelta(days=10)),
        "adults": 2, "children": 0, "scenarios": [], "preferences": [], "text": "", "admissionMode": "explore"}
    search = api("/search", trip)
    assert search["roomRecommendations"] == [], "OSM map records must not invent physical rooms/categories"
    ids = {h["id"] for h in catalogs["Сочи"]["hotels"]}
    assert {c["hotel"]["id"] for c in search["hotelCandidates"]} == ids
    for candidate in search["hotelCandidates"]:
        assert not candidate["hotel"].get("hasCollectedRoomCategories")
        assert candidate["hotel"]["route"] is None
        assert "pricePerNight" not in candidate["hotel"]
    limited = api("/search", {**trip, "hotelFilters": {"maxPricePerNight": 10000}})
    assert not limited["hotelCandidates"] and not limited["roomRecommendations"]
    conversation = api("/search/conversation", {"trip": trip, "message": "до 5000 рублей за ночь", "focusFeatures": []})
    assert conversation["trip"]["region"] == "Сочи"
    assert conversation["trip"]["hotelFilters"]["maxPricePerNight"] == 5000
    by_kind = {}
    config = json.loads(Path("data/sochi/place-categories.json").read_text(encoding="utf-8"))
    for c in config:
        filtered = api("/search", {**trip, "hotelFilters": {"nearby": [{"kind": c["key"], "maxMeters": c["defaultMaxMeters"]}]}})
        for candidate in filtered["hotelCandidates"]:
            assert candidate["hotel"]["id"] in ids
            assert any(p["kind"] == c["key"] and p["meters"] <= c["defaultMaxMeters"] for p in candidate["nearbyMatches"])
        by_kind[c["key"]] = len(filtered["hotelCandidates"])
    for hotel in catalogs["Сочи"]["hotels"][:5]:
        detail = api("/hotels/" + hotel["id"])
        assert detail["region"] == "Сочи" and detail["hotel"]["id"] == hotel["id"]
        assert not detail["facts"]

    def concurrent_region(index):
        region = "Сочи" if index % 2 else "Пусан"
        result = api("/catalog?" + urllib.parse.urlencode({"region": region}), opener=urllib.request.build_opener())
        assert result["region"] == region and all(h["region"] == region for h in result["hotels"])
        return region

    with ThreadPoolExecutor(max_workers=4) as executor:
        concurrent_checks = list(executor.map(concurrent_region, range(16)))
    assert api("/catalog")["region"] == "Пусан", "Requests must not change the global default"
    return {"checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "passed": True,
        "catalogRecords": {region: len(catalog["hotels"]) for region, catalog in catalogs.items()},
        "requests": request_count, "concurrentCatalogChecks": len(concurrent_checks), "nearbyCandidates": by_kind,
        "limits": ["API/source consistency only, not field verification or confirmation of operating businesses.",
                   "Room categories, prices, availability, walking routes and room noise remain unknown for Sochi."]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8095")
    parser.add_argument("--report", default=".local/sochi-review/http-quality.json")
    args = parser.parse_args()
    report = verify(args.base)
    path = Path(args.report)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
