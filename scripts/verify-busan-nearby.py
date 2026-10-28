"""Exercise a running, isolated Busan API using only saved public catalog data."""
import argparse
import datetime as dt
import http.cookiejar
import json
import math
from pathlib import Path
import time
import urllib.request


def distance_m(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    x = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return math.ceil(6371008.8 * 2 * math.asin(min(1, math.sqrt(x))))


def verify(base):
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    requests = []

    def api(path, payload=None):
        started = time.monotonic()
        request = urllib.request.Request(base.rstrip("/") + "/api" + path,
            data=None if payload is None else json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"})
        with client.open(request, timeout=60) as response:
            assert response.status == 200
            result = json.load(response)
        requests.append({"path": path, "seconds": round(time.monotonic() - started, 3)})
        return result

    catalog = api("/catalog")
    assert len({h["id"] for h in catalog["hotels"]}) == len(catalog["hotels"])
    today = dt.date.today()
    trip = {"region": catalog["region"], "checkIn": "", "checkOut": "", "adults": 2,
            "children": 0, "scenarios": [], "preferences": [], "text": "", "admissionMode": "explore"}

    def refine(message):
        nonlocal trip
        result = api("/search/conversation", {"trip": trip, "message": message, "focusFeatures": []})
        assert result["mode"] == "rules"
        trip = result["trip"]
        return result

    assert refine("Обязательно отель в центре города до 1500 м")["changed"]
    assert trip["pendingLocationQuery"] == {"query": "center", "relation": "near", "radiusMeters": 1500, "required": True}
    assert not trip.get("locationWishes")
    assert not trip.get("hotelFilters", {}).get("nearby"), "An ambiguous center cannot silently become a city-center filter"
    assert refine("Сомён")["changed"]
    assert not trip.get("pendingLocationQuery")
    assert trip["locationWishes"] == [{"query": "center:seomyeon", "relation": "near", "radiusMeters": 1500, "required": True}]
    refine("Обязательно рядом с кафе до 500 м")
    refine("Обязательно рядом с рестораном до 800 м")
    assert {c["query"]: (c["radiusMeters"], c["required"]) for c in trip["locationWishes"]} == {
        "center:seomyeon": (1500, True), "cafe": (500, True), "restaurant": (800, True)}
    trip.update(checkIn=str(today + dt.timedelta(days=7)), checkOut=str(today + dt.timedelta(days=10)))
    combined = api("/search", trip)
    assert combined["mode"] == "rules"
    candidates = combined["hotelCandidates"]
    assert candidates, "The real center/cafe/restaurant scenario must have at least one result"
    snapshot = json.loads(Path("data/places/busan-places.json").read_text(encoding="utf-8"))
    places = {place["id"]: place for place in snapshot["places"]}
    source_ids = {source["id"] for source in snapshot["sources"]}
    for candidate in candidates:
        hotel, criteria = candidate["hotel"], candidate["locationCriteria"]
        assert hotel["rooms"] == [] and not hotel.get("synthetic") and not hotel.get("accountListingId")
        assert {c["query"] for c in criteria} == {c["query"] for c in trip["locationWishes"]}
        assert candidate["provisional"] == any(c["required"] and c["evidenceStatus"] != "match" for c in criteria)
        for criterion in criteria:
            assert criterion["required"] and criterion["relation"] == "near"
            assert criterion["evidenceStatus"] in {"match", "unknown", "stale"}, "Known required mismatches cannot remain candidates"
            assert criterion["method"] == "haversine_straight_line" and criterion["assumptions"]
            for place in criterion["places"]:
                saved = places[place["id"]]
                assert saved["sourceId"] == place["sourceId"] and place["sourceId"] in source_ids
                assert abs(place["distanceMeters"] - distance_m(hotel["coordinates"], saved["coordinates"])) <= 2
                assert place["sourceUrl"] and place["obtainedAt"]
            if criterion["query"] == "center:seomyeon":
                assert criterion["evidenceStatus"] == "match"
                assert criterion["places"][0]["id"] == "center:seomyeon"
                assert criterion["places"][0]["distanceMeters"] <= 1500
    strict = api("/search", {**trip, "admissionMode": "verified"})
    assert {c["hotel"]["id"] for c in strict["hotelCandidates"]} <= {c["hotel"]["id"] for c in candidates}
    for candidate in strict["hotelCandidates"]:
        assert all(c["evidenceStatus"] == "match" for c in candidate["locationCriteria"])
        assert candidate["provisional"] is False

    # Keep the existing typed nearby-filter contract independent of conversational locations.
    conditions = [{"kind": "city_center", "maxMeters": 1500}, {"kind": "cafe", "maxMeters": 500},
                  {"kind": "restaurant", "maxMeters": 800}]
    structured_trip = {**trip, "locationWishes": [], "hotelFilters": {"nearby": conditions}}
    structured = api("/search", structured_trip)
    structured_candidates = structured["hotelCandidates"]
    assert structured_candidates, "Typed nearby filters must still find the center/cafe/restaurant scenario"

    def check_candidate(candidate, conditions):
        hotel, matches = candidate["hotel"], candidate["nearbyMatches"]
        assert hotel["rooms"] == [] and not hotel.get("synthetic") and not hotel.get("accountListingId")
        assert not hotel.get("hasCollectedRoomCategories")
        assert {p["kind"] for p in matches} == {c["kind"] for c in conditions}
        for condition in conditions:
            place = next(p for p in matches if p["kind"] == condition["kind"])
            assert place["meters"] <= condition["maxMeters"]
            assert abs(place["meters"] - distance_m(hotel["coordinates"], place["coordinates"])) <= 1
            assert place["sourceUrl"] == "https://www.openstreetmap.org/" + place["osmId"]
            assert place["status"] == "supported" and place["method"] == "haversine-osm-v1"

    for candidate in structured_candidates:
        check_candidate(candidate, conditions)
    refine("убери кафе")
    assert {c["query"] for c in trip["locationWishes"]} == {"center:seomyeon", "restaurant"}
    before = json.loads(json.dumps(trip))
    assert not refine("рядом с кафе или рестораном")["changed"]
    assert trip == before
    trip["hotelFilters"] = {"query": "сохранённый поиск", "maxPricePerNight": 120000,
                            "nearby": [{"kind": "park", "maxMeters": 1000}]}
    refine("убери всё рядом")
    assert not trip.get("hotelFilters", {}).get("nearby")
    assert not trip.get("locationWishes") and not trip.get("pendingLocationQuery")
    assert trip["hotelFilters"]["query"] == "сохранённый поиск" and trip["hotelFilters"]["maxPricePerNight"] == 120000
    trip.pop("hotelFilters", None)
    per_kind = {}
    config = json.loads(Path("data/busan/place-categories.json").read_text(encoding="utf-8"))
    for definition in config:
        conditions = [{"kind": definition["key"], "maxMeters": definition["defaultMaxMeters"]}]
        result = api("/search", {**trip, "hotelFilters": {"nearby": conditions}})
        assert result["mode"] == "rules"
        for candidate in result["hotelCandidates"]:
            check_candidate(candidate, conditions)
        per_kind[definition["key"]] = {"hotelCandidates": len(result["hotelCandidates"]),
            "roomRecommendations": len(result["roomRecommendations"])}
    budget = api("/search", {**trip, "hotelFilters": {"maxPricePerNight": 1}})
    assert not budget["hotelCandidates"], "Unknown prices cannot pass a numeric price cap"
    return {"checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "base": base,
        "hotels": len(catalog["hotels"]), "combinedCenterCafeRestaurantCandidates": len(candidates),
        "strictLocationCandidates": len(strict["hotelCandidates"]),
        "structuredCenterCafeRestaurantCandidates": len(structured_candidates),
        "perKind": per_kind, "requests": requests, "passed": True,
        "limitations": ["Saved-map consistency and API checks, not field verification.",
                        "No booking availability, physical room, walkability or opening-hour validation."]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8094")
    parser.add_argument("--report", default=".local/busan-nearby-review/http-quality.json")
    args = parser.parse_args()
    report = verify(args.base)
    output = Path(args.report)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("passed", "hotels", "combinedCenterCafeRestaurantCandidates", "perKind")}, ensure_ascii=False))
