"""Focused HTTP regression for personal wishes, against an already-running isolated server.

Run: python -X utf8 scripts/verify-personal-wishes.py --base http://127.0.0.1:8090
     --report .local/wishes-map/personal-http.json
Uses saved data and a rules-only advisor. Creates only anonymous search snapshots and
two advisor runs; never starts services, changes listings, or accesses a language model.
This checks contracts and uncertainty handling, not actual conditions in hotel rooms.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
from http.cookiejar import CookieJar
import json
from pathlib import Path
import sys
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener

UNRESOLVED = {"unknown", "stale", "conflict"}
CANARY = "PRIVATE_PERSONAL_WISH_HTTP_CANARY_20261026"
FEATURES = {"beach_walk", "step_free_route", "courtyard", "step_free_access",
            "family", "area_safety", "clean_air", "low_noise"}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


class Browser:
    def __init__(self, base):
        parsed = urlsplit(base)
        require(parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
                and not parsed.username and not parsed.password and parsed.path in {"", "/"}
                and not parsed.query and not parsed.fragment, "--base must be a local HTTP origin")
        self.base = base.rstrip("/")
        self.client = build_opener(HTTPCookieProcessor(CookieJar()))
        self.requests = 0

    def request(self, path, payload=None, expected=200, timeout=15):
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json", "Origin": self.base} if body is not None else {}
        self.requests += 1
        try:
            response = self.client.open(Request(self.base + path, data=body, headers=headers), timeout=timeout)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            status = response.status
            require("json" in response.headers.get("Content-Type", ""), f"{path}: expected JSON")
        result = json.loads(raw)
        require(status == expected, f"{path}: HTTP {status}, expected {expected}: {str(result)[:240]}")
        return result


def trip(text="", *, conflict=False):
    return {"region": "Пусан", "checkIn": "2027-06-10", "checkOut": "2027-06-15",
            "adults": 2, "children": 0, "scenarios": ["family"], "text": text,
            "preferences": [{"feature": "courtyard" if conflict else "family", "required": conflict}],
            "admissionMode": "explore"}


def metadata(wishes, query, expected):
    require(isinstance(wishes, dict), "Missing personalWishes metadata")
    require(set(wishes) == {"status", "completeness", "features", "excludedFeatures", "ownerCriteria"},
            "Unexpected personalWishes fields or missing provenance boundary")
    require(wishes["status"] == expected, f"Expected recognition {expected}, got {wishes['status']}")
    require(wishes["completeness"] == "unverified", "Free text was declared completely understood")
    for field in ("features", "excludedFeatures"):
        values = wishes[field]
        require(isinstance(values, list) and len(values) == len(set(values)) and set(values) <= FEATURES,
                f"Invalid recognized feature list: {field}")
    require(not (set(wishes["features"]) & set(wishes["excludedFeatures"])), "A wish is both positive and excluded")
    require(isinstance(wishes["ownerCriteria"], list), "Owner constraints must be an array")
    for item in wishes["ownerCriteria"]:
        require(set(item) == {"id", "feature", "label", "required"}
                and item["feature"] in {"floor", "window_direction"}
                and type(item["required"]) is bool, "Owner metadata contains evidence or private source data")
    serialized = json.dumps(wishes, ensure_ascii=False)
    require(CANARY not in serialized, "Raw personal query leaked into new metadata")
    if query["text"].strip():
        require(query["text"] not in serialized, "Metadata copied the original query")


def evidence_is_honest(item, counts):
    for room in item["rooms"]:
        if room.get("capacityEvidenceStatus") == "unknown":
            require(room["capacityStatus"] == "mismatch" and room["capacityAssumed"],
                    "Missing capacity was converted into a positive match")
        for criterion in room["criteria"]:
            state = criterion["evidenceStatus"]
            counts[state] += 1
            if state in UNRESOLVED:
                require(criterion["status"] == "mismatch" and criterion["assumed"],
                        "Unresolved criterion became a positive factual match")
    for criterion in item.get("ownerCriteria", []):
        counts["owner:" + criterion["evidenceStatus"]] += 1
        if criterion["evidenceStatus"] in UNRESOLVED:
            require(criterion["status"] == "mismatch" and criterion["assumed"],
                    "Missing floor/direction evidence became a positive match")


def check_search(browser, label, query, expected, report, expected_ids=None):
    result = browser.request("/api/search", query)
    require(result["mode"] == "rules", "Search must use deterministic rules in this offline check")
    metadata(result.get("personalWishes"), query, expected)
    wishes = result["personalWishes"]
    items = result["results"] + result["excluded"]
    ids = [item["hotel"]["id"] for item in items]
    require(ids and len(ids) == len(set(ids)), "Missing or duplicate hotel classifications")
    if expected_ids is not None:
        require(set(ids) == expected_ids, "Personal text lost a hotel instead of classifying it")
    counts = Counter()
    for item in items:
        require(item.get("personalWishes") == wishes, "Card metadata differs from search metadata")
        require(item["best"]["room"]["id"] in {room["room"]["id"] for room in item["rooms"]},
                "Selected room is outside this hotel")
        evidence_is_honest(item, counts)
        if label == "floor_and_direction" and not item["hotel"].get("accountListingId"):
            require(len(item.get("ownerCriteria", [])) == 2
                    and all(c["evidenceStatus"] == "unknown" for c in item["ownerCriteria"]),
                    "Real catalog's unavailable floor/direction was invented")
    if label in {"blank_with_chips", "unrecognized_with_chips"}:
        require(not wishes["features"] and not wishes["excludedFeatures"] and not wishes["ownerCriteria"],
                "Selected chips/scenarios masquerade as text recognition")
        require(result["preferences"] == query["preferences"], "Unsupported text changed selected chips")
    elif label == "partly_supported_text":
        require(set(wishes["features"]) == {"courtyard", "low_noise"}, "Known part of the text was lost")
        require(not wishes["excludedFeatures"] and not wishes["ownerCriteria"], "Unsupported pool was invented")
        require(counts["unknown"] > 0, "No genuine unknown criterion was exercised")
    elif label == "floor_and_direction":
        require(not wishes["features"] and {c["feature"] for c in wishes["ownerCriteria"]}
                == {"floor", "window_direction"}, "Numeric floor and window direction were not recognized")
    elif label == "cancelled_chip_conflict":
        require(wishes["excludedFeatures"] == ["courtyard"] and not wishes["features"],
                "Negated text was treated as a positive condition")
        require(result["conflicts"] and not result["results"], "Text/chip conflict did not block recommendations")
    report["searchCases"].append({"case": label, "recognition": wishes["status"],
        "completeness": wishes["completeness"], "classifiedHotels": len(items),
        "fitCount": len(result["results"]), "excludedCount": len(result["excluded"]),
        "features": wishes["features"], "ownerFeatures": [c["feature"] for c in wishes["ownerCriteria"]],
        "conflicts": len(result["conflicts"]), "criterionEvidenceCounts": dict(counts)})
    # The first selected and first excluded/last hotel exercise more than one room category.
    samples = {items[0]["hotel"]["id"]: items[0], items[-1]["hotel"]["id"]: items[-1]}
    for hotel_id, item in samples.items():
        detail = browser.request(f"/api/hotels/{quote(hotel_id, safe='')}/evaluate", query)
        metadata(detail.get("personalWishes"), query, expected)
        require(detail["personalWishes"] == wishes, "Detail recognition differs from the search")
        require(detail["best"]["room"]["id"] == item["best"]["room"]["id"]
                and detail["best"]["status"] == item["best"]["status"], "Detail changed the selected room/admission")
        by_feature = {c["feature"]: c for c in detail["best"]["criteria"]}
        for criterion in item["best"]["criteria"]:
            other = by_feature[criterion["feature"]]
            require((criterion["status"], criterion["evidenceStatus"]) == (other["status"], other["evidenceStatus"]),
                    "Detail changed evidence for the selected room")
        report["detailChecks"].append({"case": label, "hotelId": hotel_id, "roomId": detail["best"]["room"]["id"]})
    print(f"{label}: {len(items)} hotels and {len(samples)} details passed", flush=True)
    return result, set(ids)


def check_advisor(browser, label, query, result, report):
    # Other integration clients may evict the bounded global snapshot cache. Take a fresh
    # snapshot immediately before the run, while still checking the earlier interpretation.
    refreshed = browser.request("/api/search", query)
    require(refreshed["personalWishes"] == result["personalWishes"], "Repeated search changed text recognition")
    result = refreshed
    run = browser.request("/api/advisor/runs", {"trip": query, "searchId": result["searchId"], "mode": "rules"}, 202)
    run_path = "/api/advisor/runs/" + quote(run["id"], safe="")
    deadline = time.monotonic() + 45
    try:
        while run["status"] in {"queued", "running"}:
            remaining = deadline - time.monotonic()
            require(remaining > 0, "Rules advisor exceeded its 45-second deadline")
            run = browser.request(run_path, timeout=min(10, remaining))
            if run["status"] in {"queued", "running"}:
                time.sleep(min(.2, max(0, deadline - time.monotonic())))
        require(run["status"] == "completed", f"Advisor did not complete: {run.get('error', run['status'])}")
    finally:
        if run["status"] in {"queued", "running"}:
            # Cancel only the anonymous run created by this script, never another client's run.
            browser.request(run_path + "/cancel", {}, timeout=5)
    require(run["execution"] == "rules" and all(run[field] == 0 for field in ("modelCalls", "inputTokens", "outputTokens")),
            "Rules advisor invoked or billed a model")
    context, advice = run["context"], run["report"]
    metadata(context.get("personalWishes"), query, result["personalWishes"]["status"])
    require(context["personalWishes"] == result["personalWishes"] and context["searchId"] == result["searchId"],
            "Advisor did not reuse exact search recognition")
    expected = "clarification_needed" if result["conflicts"] else "shortlist" if result["results"] else "no_matches"
    require(advice["outcome"] == expected, "Recognition notice changed advisor outcome")
    notice = "В личном пожелании ничего не распознано." if label == "unrecognized_with_chips" else "Из личного пожелания проверены только распознанные условия; остальной текст не проверен."
    require(advice["summary"].startswith(notice) and len(advice["summary"]) <= 1800,
            "Advisor omitted or truncated the recognition notice")
    require(CANARY not in advice["summary"], "Advisor notice leaked raw personal query")
    candidates = {item["id"]: item for item in context["candidates"]}
    cautions = {item["candidateId"]: set(item["evidenceIds"]) for item in advice["cautions"]}
    for candidate_id in advice["candidateIds"]:
        require(candidate_id in candidates, "Advisor invented a candidate")
        candidate = candidates[candidate_id]
        for criterion in candidate["criteria"]:
            if criterion["evidenceStatus"] in UNRESOLVED:
                require(criterion["status"] == "mismatch" and criterion["id"] in cautions.get(candidate_id, set()),
                        "Advisor hid uncertainty behind a recognized personal wish")
    report["advisorChecks"].append({"case": label, "recognition": context["personalWishes"]["status"],
        "status": run["status"], "outcome": advice["outcome"], "modelCalls": run["modelCalls"],
        "candidateCount": len(advice["candidateIds"]), "noticePresent": True, "freshSearchSnapshot": True})
    print(f"advisor {label}: notice, snapshot and uncertainty passed", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8090")
    parser.add_argument("--report", default=".local/wishes-map/personal-http.json")
    args = parser.parse_args()
    started = time.monotonic()
    report = {"status": "running", "generatedAt": datetime.now(timezone.utc).isoformat(),
              "base": args.base, "searchCases": [], "detailChecks": [], "advisorChecks": [],
              "limitations": ["HTTP logic and saved-source consistency only; no hotel or room field verification.",
                              "Rules parser and rules advisor only; local/remote LLM quality is not evaluated.",
                              "Floor and window direction are checked as unknown for real catalog hotels; no fabricated owner listing is created."]}
    browser = None
    try:
        browser = Browser(args.base)
        health = browser.request("/api/health")
        require(health.get("ok") and health.get("mode") == "rules" and health.get("accountsEnabled"),
                "Use an isolated server with accounts enabled and LLM_API_KEY/LLM_MODEL unset")
        cases = [("blank_with_chips", trip(), "not_requested"),
                 ("unrecognized_with_chips", trip("абракадабра " + CANARY), "unrecognized"),
                 ("partly_supported_text", trip("Тихо и бассейн. " + CANARY), "recognized"),
                 ("floor_and_direction", trip("Не выше 3 этажа. Окна на восток. " + CANARY), "recognized"),
                 ("cancelled_chip_conflict", trip("Окна во двор не нужны. " + CANARY, conflict=True), "recognized")]
        known_ids, advice_cases = None, []
        for label, query, expected in cases:
            result, known_ids = check_search(browser, label, query, expected, report, known_ids)
            if label in {"unrecognized_with_chips", "partly_supported_text"}:
                advice_cases.append((label, query, result))
        for label, query, result in advice_cases:
            check_advisor(browser, label, query, result, report)
        report["classifiedHotelsAcrossCases"] = sum(item["classifiedHotels"] for item in report["searchCases"])
        report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = f"{type(error).__name__}: {error}"
        print(report["error"], file=sys.stderr)
    finally:
        report["httpRequests"] = browser.requests if browser else 0
        report["durationSeconds"] = round(time.monotonic() - started, 2)
        output = Path(args.report)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{report['status']}: {report['httpRequests']} HTTP requests; report {output}", flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
