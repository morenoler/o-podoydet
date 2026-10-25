"""Expanded HTTP admission audit against isolated local app/lab servers.

Start them with verify-http-integration.py --keep-running first. No account writes
or external collection; only searches, evaluations and rules-advisor test runs.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import importlib.util
from itertools import combinations
import json
from pathlib import Path
import time
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("http_audit", Path(__file__).with_name("verify-http-integration.py"))
http = importlib.util.module_from_spec(spec)
spec.loader.exec_module(http)
require = http.require
SOFT = {"unknown", "stale"}
UNRESOLVED = SOFT | {"conflict"}
COUNTS = Counter()


def request(base, path, payload=None, expected=200):
    COUNTS["requests"] += 1
    return http.request(base, path, payload, expected)


def validate(result, query, ids):
    mode = query.get("admissionMode", "verified")
    require(result["admissionMode"] == mode, "Response admission mode differs from request")
    rows = http.rows(result)
    require(len(rows) == len(ids) and {r["hotel"]["id"] for r in rows} == ids,
            "Catalog must be classified once without omissions")
    for item in rows:
        known_rooms = {r["id"] for r in item["hotel"]["rooms"]}
        require(item["best"]["room"]["id"] in known_rooms, "Best room belongs to another hotel")
        for room in item["rooms"]:
            mandatory = [(room["capacityStatus"], room["capacityEvidenceStatus"])] + [
                (c["status"], c["evidenceStatus"]) for c in room["criteria"] if c["required"]]
            known_failure = any(e in {"mismatch", "conflict"} for _, e in mandatory)
            unresolved = any(e in SOFT for _, e in mandatory)
            all_met = all(s == "match" and e not in UNRESOLVED for s, e in mandatory)
            fits = not known_failure and (all_met or mode == "explore" and unresolved)
            require((room["status"] == "fits") == fits, "Admission contradicts mandatory evidence")
            require(room["provisional"] == (fits and unresolved), "Provisional flag hides or invents uncertainty")
            if room["capacityEvidenceStatus"] in UNRESOLVED:
                require(room["capacityStatus"] == "mismatch" and room["capacityAssumed"],
                        "Unknown capacity became confirmed")
            for criterion in room["criteria"]:
                if criterion["evidenceStatus"] in UNRESOLVED:
                    require(criterion["status"] == "mismatch" and criterion["assumed"],
                            "Unresolved criterion became a positive fact")
        require((item in result["results"]) == (item["best"]["status"] == "fits"), "Wrong result bucket")
        confirmed_rooms = [r for r in item["rooms"] if r["status"] == "fits" and not r["provisional"]]
        require(not confirmed_rooms or not item["best"]["provisional"], "Unknown room outranked confirmed admission")
    flags = [row["best"]["provisional"] for row in result["results"]]
    require(flags == sorted(flags), "Provisional results precede confirmed admissions")
    COUNTS["hotelClassifications"] += len(rows)


def evidence_snapshot(result):
    """Admission may change; the same hotel/room's facts and decision inputs may not."""
    return {(row["hotel"]["id"], room["room"]["id"]): {
        key: value for key, value in room.items() if key not in {"status", "provisional"}}
        for row in http.rows(result) for room in row["rooms"]}


def pair(base, query, ids, report, label, path="/api/search"):
    outputs = {}
    for mode in ("verified", "explore"):
        full_query = {**query, "admissionMode": mode}
        result = request(base, path, full_query)
        validate(result, full_query, ids)
        outputs[mode] = result
        report["matrix"].append({"case": label, "mode": mode, "checkIn": query["checkIn"],
            "adults": query["adults"], "children": query["children"],
            "preferences": query["preferences"], "fits": len(result["results"]),
            "provisional": sum(r["best"]["provisional"] for r in result["results"]),
            "excluded": len(result["excluded"])})
    require(set(http.fit_ids(outputs["verified"])) <= set(http.fit_ids(outputs["explore"])),
            "Exploration lost a confirmed match")
    require(evidence_snapshot(outputs["verified"]) == evidence_snapshot(outputs["explore"]),
            "Changing admission mode modified source evidence")
    return outputs


def matrix(base, ids, report):
    for dates in http.DATES:
        for children in range(3):
            query = http.trip(children, dates)
            baseline = pair(base, query, ids, report, "baseline")
            for feature in http.FEATURES:
                for required in (False, True):
                    query = http.trip(children, dates, feature, required)
                    outputs = pair(base, query, ids, report, "single")
                    if not required:
                        for mode in outputs:
                            require(http.fit_ids(outputs[mode]) == http.fit_ids(baseline[mode]),
                                    "Optional preference changed admission")
            print(f"Modes: {dates[0]}, 2+{children}: 34 requests passed", flush=True)
    for children in (0, 1):
        for left, right in combinations(http.FEATURES, 2):
            query = http.trip(children)
            query["preferences"] = [{"feature": f, "required": True} for f in (left, right)]
            pair(base, query, ids, report, "required-pair")
    for children in range(3):
        query = http.trip(children)
        query["preferences"] = [{"feature": f, "required": True} for f in http.FEATURES]
        pair(base, query, ids, report, "all-required")
    legacy = request(base, "/api/search", http.trip())
    explicit = request(base, "/api/search", {**http.trip(), "admissionMode": "verified"})
    require(http.fit_ids(legacy) == http.fit_ids(explicit), "Omitted mode broke legacy API")
    require(evidence_snapshot(legacy) == evidence_snapshot(explicit), "Legacy evidence contract changed")
    request(base, "/api/search", {**http.trip(), "admissionMode": "safe"}, expected=400)


def detail(base, ids, report):
    report["details"] = []
    for mode in ("verified", "explore"):
        query = {**http.trip(1, feature="family", required=True), "admissionMode": mode}
        result = request(base, "/api/search", query)
        by_id = {r["hotel"]["id"]: r for r in http.rows(result)}
        def selected_conditions(room):
            # Detail intentionally adds all eight characteristics for inspection;
            # those extra optional rows must not change admission or the best room.
            return {**room, "criteria": [c for c in room["criteria"] if c["feature"] == "family"]}
        for hotel_id in sorted(ids)[::16]:
            value = request(base, f"/api/hotels/{hotel_id}/evaluate", query)
            require([selected_conditions(r) for r in value["rooms"]] == by_id[hotel_id]["rooms"] and
                    selected_conditions(value["best"]) == by_id[hotel_id]["best"],
                    f"Detail and search disagree: {hotel_id}, {mode}")
            report["details"].append({"hotelId": hotel_id, "mode": mode, "status": value["best"]["status"]})


def advisor(base, query, report, search_path="/api/search"):
    search = request(base, search_path, query)
    started = request(base, "/api/advisor/runs", {"trip": query, "searchId": search["searchId"], "mode": "rules"}, 202)
    deadline = time.monotonic() + 60
    while True:
        run = request(base, "/api/advisor/runs/" + started["id"])
        if run["status"] in {"completed", "failed", "cancelled"}:
            break
        require(time.monotonic() < deadline, "Advisor timed out")
        time.sleep(.2)
    require(run["status"] == "completed", "Advisor failed")
    require(run["execution"] == "rules" and run["modelCalls"] == 0, "Expected offline rules advisor")
    candidates = {c["id"]: c for c in run["context"]["candidates"]}
    fit_ids = set(http.fit_ids(search))
    selected = run["report"]["candidateIds"]
    require(run["report"]["outcome"] == ("shortlist" if fit_ids else "no_matches"), "Advisor ignored search mode")
    for cid in selected:
        candidate = candidates[cid]
        if fit_ids:
            require(candidate["status"] == "fits" and candidate["hotelId"] in fit_ids, "Advisor recommended excluded room")
        else:
            # no_matches uses excluded candidates to explain the rejection, not as a shortlist.
            require(candidate["status"] == "excluded" and not candidate["provisional"],
                    "No-match explanation silently admitted a candidate")
        unresolved = [c for c in candidate["criteria"] if c["required"] and c["evidenceStatus"] in SOFT]
        if fit_ids:
            require(not any(c["required"] and c["evidenceStatus"] in {"mismatch", "conflict"}
                            for c in candidate["criteria"]), "Advisor hides known mandatory failure")
        if unresolved:
            if fit_ids:
                require(query["admissionMode"] == "explore" and candidate["provisional"], "Advisor certifies unknown")
            cited = {eid for caution in run["report"]["cautions"] if caution["candidateId"] == cid
                     for eid in caution["evidenceIds"]}
            require({c["id"] for c in unresolved} <= cited, "Advisor omitted mandatory uncertainty caution")
    report.setdefault("advisor", []).append({"mode": query["admissionMode"], "path": search_path,
        "outcome": run["report"]["outcome"], "selected": len(selected),
        "provisional": sum(candidates[c]["provisional"] for c in selected)})


def laboratory(base, report):
    catalog = request(base, "/api/catalog")
    ids = {h["id"] for h in catalog["hotels"] if h.get("synthetic")}
    require(len(ids) == 6, "Expected six isolated lab fixtures")
    query = http.trip(1, feature="courtyard", required=True)
    query["preferences"].append({"feature": "family", "required": True})
    outputs = pair(base, query, ids, report, "lab-evidence-states", "/api/lab/search")
    require(http.fit_ids(outputs["verified"]) == ["lab-demo-match"], "Strict lab control changed")
    explore = set(http.fit_ids(outputs["explore"]))
    require({"lab-demo-match", "lab-demo-unknown", "lab-demo-stale"} <= explore,
            "Exploration did not admit unresolved lab cases")
    require(not explore & {"lab-demo-mismatch", "lab-demo-conflict"}, "Known lab failure admitted")
    for mode in ("verified", "explore"):
        advisor(base, {**query, "admissionMode": mode}, report, "/api/lab/search")


def local_url(value):
    parsed = urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"} or parsed.path not in {"", "/"}:
        raise argparse.ArgumentTypeError("Use an isolated http://127.0.0.1:port server")
    return value.rstrip("/")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=local_url, default="http://127.0.0.1:8090")
    parser.add_argument("--lab", type=local_url, default="http://127.0.0.1:8091")
    parser.add_argument("--report", default=".local/search-modes-report.json")
    args = parser.parse_args()
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "status": "running", "matrix": [],
              "scope": "HTTP contracts and recorded evidence, not field validation or LLM quality"}
    try:
        require(args.app != args.lab, "App and lab must be isolated")
        catalog = request(args.app, "/api/catalog")
        ids = {h["id"] for h in catalog["hotels"]}
        require(len(ids) == 96 and not any(h.get("synthetic") for h in catalog["hotels"]),
                "Expected unmodified 96-object real catalog")
        matrix(args.app, ids, report)
        detail(args.app, ids, report)
        for mode in ("verified", "explore"):
            advisor(args.app, {**http.trip(1, feature="area_safety", required=True), "admissionMode": mode}, report)
        laboratory(args.lab, report)
        report["status"] = "passed"
    except Exception as error:
        report.update(status="failed", error=str(error))
        print(f"FAILED: {error}", flush=True)
    finally:
        report["counts"] = dict(COUNTS)
        report["counts"]["matrixSearches"] = len(report["matrix"])
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        http.write(ROOT / args.report, report)
        print(json.dumps({"status": report["status"], "counts": report["counts"], "report": args.report}), flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
