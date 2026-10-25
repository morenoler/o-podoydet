"""Offline HTTP integration audit; isolated SQLite databases, no model/network calls.

Build the app, lab and Java first. Run: python -X utf8 scripts/verify-http-integration.py
--keep-running leaves the three local servers for a manual browser check; their PIDs
and fresh database paths are saved under .local/http-smoke/<run>/processes.json.
This checks API consistency and recorded evidence, not conditions at the hotels.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
FEATURES = ("beach_walk", "step_free_route", "courtyard", "step_free_access",
            "family", "area_safety", "clean_air", "low_noise")
DATES = (("2026-10-26", "2026-10-27"), ("2026-11-07", "2026-11-08"))
UNRESOLVED = {"unknown", "stale", "conflict"}
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def request(base, path, payload=None, expected=200, timeout=120):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(base + path, data=body,
                  headers={"Content-Type": "application/json"} if body is not None else {})
    try:
        response = urlopen(req, timeout=timeout)
    except HTTPError as error:
        response = error
    with response:
        raw = response.read()
        status = response.status
        kind = response.headers.get("Content-Type", "")
    result = json.loads(raw) if "json" in kind else raw.decode("utf-8")
    require(status == expected, f"{path}: HTTP {status}, expected {expected}: {str(result)[:300]}")
    return result


def trip(children=0, dates=DATES[0], feature=None, required=False):
    return {"region": "Пусан", "checkIn": dates[0], "checkOut": dates[1],
            "adults": 2, "children": children, "scenarios": [], "text": "",
            "preferences": [{"feature": feature, "required": required}] if feature else []}


def rows(result):
    return result["results"] + result["excluded"]


def fit_ids(result):
    return sorted(item["hotel"]["id"] for item in result["results"])


def validate_result(result, expected_ids):
    items = rows(result)
    ids = [item["hotel"]["id"] for item in items]
    require(len(ids) == len(set(ids)) and set(ids) == expected_ids,
            "Search must classify every catalog hotel exactly once")
    for item in items:
        listed_rooms = {room["id"] for room in item["hotel"]["rooms"]}
        require(item["best"]["room"]["id"] in listed_rooms, "Best room must belong to the hotel")
        for room in item["rooms"]:
            require(room["room"]["id"] in listed_rooms, "Cross-hotel room reference")
            if room["capacityEvidenceStatus"] in UNRESOLVED:
                require(room["capacityStatus"] == "mismatch" and room["capacityAssumed"],
                        "Unknown capacity must not be admitted as confirmed")
            for criterion in room["criteria"]:
                if criterion["evidenceStatus"] in UNRESOLVED:
                    require(criterion["status"] == "mismatch" and criterion["assumed"],
                            "Unresolved evidence must not be presented as a positive match")
            admitted = room["capacityStatus"] == "match" and all(
                c["status"] == "match" for c in room["criteria"] if c["required"])
            require((room["status"] == "fits") == admitted, "Binary admission inconsistent with evidence")
        require((item in result["results"]) == (item["best"]["status"] == "fits"),
                "Best room must agree with the search bucket")


def criterion_summary(items, feature):
    criteria = [next(c for c in item["best"]["criteria"] if c["feature"] == feature) for item in items]
    return {"binary": dict(Counter(c["status"] for c in criteria)),
            "evidence": dict(Counter(c["evidenceStatus"] for c in criteria)),
            "risk": dict(Counter(c.get("riskLevel", "unspecified") for c in criteria))}


def matrix(base, catalog, report):
    expected_ids = {hotel["id"] for hotel in catalog["hotels"]}
    report["searchMatrix"] = []
    for dates in DATES:
        for children in range(3):
            baseline = request(base, "/api/search", trip(children, dates))
            validate_result(baseline, expected_ids)
            baseline_ids = fit_ids(baseline)
            report["searchMatrix"].append({"checkIn": dates[0], "adults": 2, "children": children,
                "feature": None, "required": False, "fits": len(baseline_ids),
                "excluded": len(baseline["excluded"]), "fitHotelIds": baseline_ids})
            for feature in FEATURES:
                for required in (True, False):
                    result = request(base, "/api/search", trip(children, dates, feature, required))
                    validate_result(result, expected_ids)
                    if not required:
                        require(fit_ids(result) == baseline_ids, "Optional condition changed admission")
                    counts = criterion_summary(rows(result), feature)
                    if dates == DATES[1] and feature == "clean_air":
                        require(counts["evidence"] == {"unknown": len(expected_ids)},
                                "Forecast beyond its horizon must stay unknown")
                    report["searchMatrix"].append({"checkIn": dates[0], "adults": 2,
                        "children": children, "feature": feature, "required": required,
                        "fits": len(result["results"]), "excluded": len(result["excluded"]),
                        **counts})
            print(f"Search: {dates[0]} 2+{children}, 17 requests passed", flush=True)
    require(len(report["searchMatrix"]) == 102, "Incomplete search matrix")


def real_categories(base, catalog, report):
    report["realCategories"] = []
    for hotel_id in ("way-627150752", "node-368952148", "way-843161717"):
        hotel = next(h for h in catalog["hotels"] if h["id"] == hotel_id)
        for children in range(3):
            query = trip(children, feature="family", required=True)
            search = request(base, "/api/search", query)
            selected = next(h for h in rows(search) if h["hotel"]["id"] == hotel_id)
            detail = request(base, f"/api/hotels/{hotel_id}/evaluate", query)
            require(detail["best"]["status"] == selected["best"]["status"] and
                    detail["best"]["room"]["id"] == selected["best"]["room"]["id"],
                    "Hotel detail disagrees with selected search category")
            category_rows = []
            for room in detail["rooms"]:
                family = next(c for c in room["criteria"] if c["feature"] == "family")
                category_rows.append({"name": room["room"]["name"], "capacity": room["room"].get("capacity"),
                    "status": room["status"], "capacityStatus": room["capacityStatus"],
                    "capacityEvidenceStatus": room["capacityEvidenceStatus"],
                    "capacityExplanation": room["capacityExplanation"],
                    "familyStatus": family["status"], "familyEvidenceStatus": family["evidenceStatus"]})
                if children and room["room"].get("capacity", 0) is not None:
                    age_limited = any("childMaxAge" in rule for rule in room["room"].get("occupancyRules", []))
                    if age_limited and room["room"]["capacity"] < 2 + children:
                        require(room["capacityEvidenceStatus"] == "unknown", "Missing child age bypassed occupancy restriction")
            report["realCategories"].append({"hotelId": hotel_id, "name": hotel["name"],
                "adults": 2, "children": children, "best": detail["best"]["room"]["name"],
                "status": detail["best"]["status"], "categories": category_rows})


def ambient_evidence(base, report):
    """Annual station measurements remain visible context, never hotel dB claims."""
    source = read(ROOT / "data/noise-context.json")["ambientMeasurements"]
    result = request(base, "/api/search", trip(feature="low_noise"))
    checked = 0
    for item in rows(result):
        criterion = item["best"]["criteria"][0]
        require(any(e.get("sourceUrl") == source["source"]["url"]
                    for e in criterion["environmentalEvidence"]), "Annual station source disappeared")
        require(any("эти децибелы не участвуют в фильтре" in detail for detail in criterion["details"]),
                "Station measurements lack their spatial limitation")
        require(criterion["evidenceStatus"] == "unknown" and criterion["status"] == "mismatch",
                "Historical station measurements became positive hotel noise evidence")
        checked += 1
    report["ambientNoise"] = {"hotelsChecked": checked, "sourceUrl": source["source"]["url"],
        "year": source["year"], "stationCount": len(source["observations"]),
        "usedAsHotelDecibels": False, "sourceAndSpatialLimitationVisible": True}


def loaded_catalog(catalog, report):
    source = read(ROOT / "data/verified-hotels.json")
    require(len(catalog["hotels"]) == len(source["hotels"]), "Loaded catalog count differs from input")
    for loaded, original in zip(catalog["hotels"], source["hotels"]):
        require({k: v for k, v in loaded.items() if k != "rooms"} ==
                {k: v for k, v in original.items() if k != "rooms"}, "Loaded hotel differs from input")
        # Evidence.rooms intentionally rebuilds unknown placeholders; verified
        # categories (including sources, capacities and rules) must be identical.
        require([r for r in loaded["rooms"] if r.get("evidenceStatus") == "verified"] ==
                [r for r in original["rooms"] if r.get("evidenceStatus") == "verified"],
                "Loaded verified category differs from input")
    report["loadedCatalogCheck"] = {"hotelMetadataAndVerifiedCategoriesEqualSource": True,
        "unknownPlaceholdersRegeneratedByEvidencePolicy": True,
        "hotelCount": len(catalog["hotels"]),
        "roomCount": sum(len(h["rooms"]) for h in catalog["hotels"]),
        "verifiedRoomCount": sum(room.get("evidenceStatus") == "verified"
                                 for hotel in catalog["hotels"] for room in hotel["rooms"])}


def dated_environment(base, report):
    def shilla(feature, dates):
        result = request(base, "/api/search", trip(dates=dates, feature=feature))
        return next(h for h in rows(result) if h["hotel"]["id"] == "way-627150752")["best"]["criteria"][0]
    air = shilla("clean_air", DATES[0])
    require(air["evidenceStatus"] == "mismatch" and not air["assumed"] and air["value"] > 50,
            "Covered forecast exceeding the threshold lost its recorded mismatch")
    require(any("24 из 24 часов" in detail for detail in air["details"]), "One-night air coverage is incomplete")
    distant_air = shilla("clean_air", DATES[1])
    require(distant_air["evidenceStatus"] == "unknown" and distant_air["assumed"],
            "Distant dates borrowed a current air-quality snapshot")
    noise = shilla("low_noise", DATES[1])
    event = next(e for e in read(ROOT / "data/noise-context.json")["events"]
                 if e["id"] == "busan-fireworks-2026-dongbaek")
    require(noise["evidenceStatus"] == "mismatch" and not noise["assumed"] and
            event["name"] in noise["explanation"] and any(
                e["sourceUrl"] == event["source"]["url"] for e in noise["environmentalEvidence"]),
            "Dated fireworks warning lost the event or its official source")
    report["datedEnvironment"] = {"hotelId": "way-627150752", "nearAirHours": 24,
        "nearAirMaximumUsAqi": air["value"], "nearAirStatus": air["evidenceStatus"],
        "distantAirStatus": distant_air["evidenceStatus"], "fireworksStatus": noise["evidenceStatus"],
        "fireworksRisk": noise["riskLevel"], "fireworksSource": event["source"]["url"],
        "fireworksStartsAt": event["startsAt"]}


def advisor(base, query, search_path, expected_ids):
    config = request(base, "/api/advisor/config")
    require(config["modes"] == ["rules"] and config["defaultMode"] == "rules", "Rules-only configuration lost")
    search = request(base, search_path, query)
    started = request(base, "/api/advisor/runs", {"mode": "rules", "trip": query,
                      "searchId": search["searchId"]}, expected=202)
    deadline = time.monotonic() + 60
    while True:
        run = request(base, "/api/advisor/runs/" + started["id"])
        if run["status"] in ("completed", "failed", "cancelled"):
            break
        require(time.monotonic() < deadline, "Advisor timed out")
        time.sleep(0.2)
    require(run["status"] == "completed", f"Advisor failed: {run.get('error')}")
    require(run["execution"] == "rules" and all(run[k] == 0 for k in ("modelCalls", "inputTokens", "outputTokens")),
            "Rules run must not call or bill a language model")
    candidates = {candidate["id"]: candidate for candidate in run["context"]["candidates"]}
    selected = run["report"]["candidateIds"]
    require(len(selected) <= 3 and set(selected) <= candidates.keys(), "Unknown advisor candidate")
    outcome = "shortlist" if search["results"] else "no_matches"
    require(run["report"]["outcome"] == outcome, "Advisor outcome disagrees with search")
    for candidate_id in selected:
        candidate = candidates[candidate_id]
        require(candidate["hotelId"] in expected_ids, "Advisor leaked a foreign hotel")
        if outcome == "shortlist":
            require(candidate["status"] == "fits" and all(
                c["status"] == "match" for c in candidate["criteria"] if c["required"]),
                    "Advisor recommended an excluded or unresolved mandatory condition")
    return {"id": run["id"], "status": run["status"], "execution": run["execution"],
            "modelCalls": run["modelCalls"], "outcome": outcome, "candidateIds": selected,
            "testCases": run["context"].get("testCases", [])}


def laboratory(app, lab, catalog, report):
    lab_catalog = request(lab, "/api/catalog")
    synthetic_ids = {h["id"] for h in lab_catalog["hotels"] if h.get("synthetic")}
    real_ids = {h["id"] for h in catalog["hotels"]}
    require(len(synthetic_ids) == 6 and len(lab_catalog["hotels"]) == len(real_ids) + 6,
            "Lab must preserve six synthetic cases and the real catalog")
    request(app, "/api/lab/search", trip(), expected=404)
    strict = trip(1, feature="family", required=True)
    strict["preferences"].append({"feature": "courtyard", "required": True})
    optional = json.loads(json.dumps(strict))
    optional["preferences"][1]["required"] = False
    strict_result = request(lab, "/api/lab/search", strict)
    optional_result = request(lab, "/api/lab/search", optional)
    for result in (strict_result, optional_result):
        validate_result(result, synthetic_ids)
    require(fit_ids(strict_result) == ["lab-demo-match"], "Strict lab selection changed")
    require(len(optional_result["results"]) == 5, "Optional lab preference must retain five known capacities")
    raw = {item["hotel"]["id"]: next(c["evidenceStatus"] for c in item["best"]["criteria"]
           if c["feature"] == "courtyard") for item in rows(strict_result)}
    for name, status in (("match", "match"), ("mismatch", "mismatch"), ("unknown", "unknown"),
                         ("stale", "stale"), ("conflict", "conflict")):
        require(raw["lab-demo-" + name] == status, "Lab lost raw evidence state")
    for feature in ("clean_air", "low_noise", "area_safety"):
        result = request(lab, "/api/lab/search", trip(1, feature=feature))
        require(criterion_summary(rows(result), feature)["evidence"] == {"unknown": 6},
                "Synthetic coordinates borrowed real environmental evidence")
    report["lab"] = {"realHotels": len(real_ids), "syntheticHotels": len(synthetic_ids),
                     "strictFits": fit_ids(strict_result), "optionalFits": fit_ids(optional_result),
                     "rawCourtyardStates": raw, "environmentUnknown": {f: 6 for f in ("clean_air", "low_noise", "area_safety")}}
    report["advisor"] = [advisor(app, trip(2, feature="family", required=True), "/api/search", real_ids),
                          advisor(app, trip(2, feature="step_free_access", required=True), "/api/search", real_ids),
                          advisor(lab, strict, "/api/lab/search", synthetic_ids),
                          advisor(lab, optional, "/api/lab/search", synthetic_ids)]
    for run in report["advisor"][2:]:
        require(len(run["testCases"]) == 6, "Advisor lab context lost one of six cases")
    app_history = {run["id"] for run in request(app, "/api/advisor/runs")}
    lab_history = {run["id"] for run in request(lab, "/api/advisor/runs")}
    require(not (app_history & lab_history), "Isolated databases share advisor history")


def views(app, report):
    report["windowView"] = []
    for example, expected_demo in (("real-hotel", False), ("room", True), ("room-high-floor", True)):
        payload = read(ROOT / f"services/window-view/examples/{example}.json")
        begin = time.monotonic()
        result = request(app, "/api/views/estimate", payload)
        require(result["actual_visibility_confirmed"] is False and result["is_demo"] == expected_demo,
                "Geometry result misrepresented as a confirmed real view")
        assessments = result["assessments"]
        targets = [target for assessment in assessments for target in assessment["targets"]]
        if expected_demo:
            sea = next(target for target in targets if target["id"] == "demo:sea")
            require(sea["status"] == ("blocked" if example == "room" else "clear_in_model"),
                    "Floor change did not affect the synthetic obstruction as expected")
        else:
            require(payload["floor"] == 5 and len(assessments) == 8 and result["sources"],
                    "Real hotel fallback lost its floor, directions or sources")
        report["windowView"].append({"example": example, "floor": payload["floor"],
            "isDemo": result["is_demo"], "actualVisibilityConfirmed": False,
            "scope": result["room_resolution"]["scope"], "directions": len(assessments),
            "targets": len(targets), "statusCounts": dict(Counter(t["status"] for t in targets)),
            "sourceCount": len(result["sources"]), "seconds": round(time.monotonic() - begin, 3)})
    missing = read(ROOT / "services/window-view/examples/real-hotel.json")
    del missing["floor"]
    request(app, "/api/views/estimate", missing, expected=400)
    report["missingFloorStatus"] = 400


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-port", type=int, default=8080)
    parser.add_argument("--lab-port", type=int, default=8081)
    parser.add_argument("--view-port", type=int, default=8011)
    parser.add_argument("--keep-running", action="store_true")
    parser.add_argument("--report", default="docs/HTTP_INTEGRATION_REPORT.json")
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    run_dir = ROOT / ".local/http-smoke" / stamp
    run_dir.mkdir(parents=True)
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "status": "running",
              "scope": "Actual HTTP on isolated Java 21/SQLite and offline Python; no field validation",
              "limitations": ["Published category claims are not room availability or a field inspection.",
                "Child ages are absent from Trip; age-limited occupancy remains unresolved.",
                "Model geometry is not a photograph or confirmation of a view.",
                "Fixed trip dates and recorded evidence: future reruns can legitimately change freshness outcomes.",
                "Rules advisor only; no local LLM quality assessment."], "inputSha256": {}}
    processes, handles, process_rows = [], [], []
    success = False
    try:
        require(len({args.app_port, args.lab_port, args.view_port}) == 3, "Choose three distinct ports")
        for port in (args.app_port, args.lab_port, args.view_port):
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", port))
        for file in ("dist/index.html", "dist-lab/index.html", "backend/target/o-podoydet-backend.jar"):
            require((ROOT / file).is_file(), "Build missing: " + file)
        java_home = os.environ.get("JAVA_HOME")
        jdks = sorted(p for p in (ROOT / ".local/tools").glob("jdk-21*") if p.is_dir())
        java_binary = "java.exe" if os.name == "nt" else "java"
        java = str(Path(java_home) / "bin" / java_binary) if java_home else (
            str(jdks[0] / "bin" / java_binary) if jdks else "java")
        node = shutil.which("node")
        require(node is not None, "Node is required to generate isolated lab fixtures")
        completed = subprocess.run([node, "--import", "tsx", "scripts/lab-data.ts", str(run_dir / "lab-hotels.json")],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", creationflags=FLAGS, timeout=30)
        require(completed.returncode == 0, "Lab fixture generation failed: " + completed.stderr[:300])
        jar = run_dir / "backend.jar"
        shutil.copyfile(ROOT / "backend/target/o-podoydet-backend.jar", jar)
        for file in ("data/verified-hotels.json", "data/area-assessments.json", "data/noise-context.json",
                     "data/traffic-ktdb-2024.json", "services/window-view/data/scenes.json", "backend/target/o-podoydet-backend.jar"):
            report["inputSha256"][file] = digest(ROOT / file)
        env = os.environ.copy()
        env.update(LLM_API_KEY="", ADVISOR_LOCAL_MODEL="", ADVISOR_PYTHON=sys.executable,
                   WINDOW_VIEW_URL=f"http://127.0.0.1:{args.view_port}", PYTHONUTF8="1", FRONTEND_ORIGIN="")
        tmp = run_dir / "tmp"
        tmp.mkdir()
        env["JAVA_TOOL_OPTIONS"] = "-Djava.io.tmpdir=" + str(tmp)
        def launch(name, command, cwd, overrides, port):
            log = (run_dir / (name + ".log")).open("wb")
            handles.append(log)
            child = subprocess.Popen(command, cwd=cwd, env={**env, **overrides}, stdout=log,
                                     stderr=subprocess.STDOUT, creationflags=FLAGS)
            processes.append(child)
            process_rows.append({"name": name, "pid": child.pid, "port": port,
                                 "log": str(run_dir / (name + ".log")), "database": overrides.get("DB_PATH")})
            return f"http://127.0.0.1:{port}"
        view = launch("window-view", [sys.executable, "-X", "utf8", "-m", "window_view", "serve", "--port", str(args.view_port)],
                      ROOT / "services/window-view", {}, args.view_port)
        java_command = [java, "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-jar", str(jar)]
        app = launch("app", java_command, ROOT, {"PORT": str(args.app_port), "LAB_MODE": "false",
                     "DATA_PATH": str(ROOT / "data/verified-hotels.json"), "DIST_PATH": str(ROOT / "dist"),
                     "DB_PATH": str(run_dir / "app.sqlite3")}, args.app_port)
        lab = launch("lab", java_command, ROOT, {"PORT": str(args.lab_port), "LAB_MODE": "true",
                     "DATA_PATH": str(run_dir / "lab-hotels.json"), "DIST_PATH": str(ROOT / "dist-lab"),
                     "DB_PATH": str(run_dir / "lab.sqlite3")}, args.lab_port)
        write(run_dir / "processes.json", process_rows)
        for base, endpoint in ((view, "/health"), (app, "/api/health"), (lab, "/api/health")):
            deadline = time.monotonic() + 30
            while True:
                try:
                    request(base, endpoint, timeout=2)
                    break
                except (URLError, TimeoutError):
                    require(time.monotonic() < deadline and all(p.poll() is None for p in processes),
                            "Server failed to start; inspect local logs")
                    time.sleep(0.15)
        report["health"] = {"app": request(app, "/api/health"), "lab": request(lab, "/api/health"),
                            "windowView": request(view, "/health")}
        require(report["health"]["windowView"]["network_enabled"] is False, "View service unexpectedly allows collection")
        for base in (app, lab):
            require("<html" in request(base, "/").lower(), "Built frontend is not served")
        catalog = request(app, "/api/catalog")
        require(len(catalog["hotels"]) == 96 and not any(h.get("synthetic") for h in catalog["hotels"]),
                "Production catalog must contain 96 real objects only")
        loaded_catalog(catalog, report)
        print(f"Ready: {app} · {lab} · {view}; metadata {run_dir / 'processes.json'}", flush=True)
        matrix(app, catalog, report)
        real_categories(app, catalog, report)
        ambient_evidence(app, report)
        dated_environment(app, report)
        laboratory(app, lab, catalog, report)
        views(app, report)
        for file, sha in report["inputSha256"].items():
            require(digest(ROOT / file) == sha, "Input changed during smoke: " + file)
        report["status"] = "passed"
        report["searchRequestCount"] = len(report["searchMatrix"])
        report["hotelClassifications"] = len(report["searchMatrix"]) * len(catalog["hotels"])
        success = True
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        print(f"FAILED: {error}", flush=True)
    finally:
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        write(ROOT / args.report, report)
        if not (success and args.keep_running):
            for process in reversed(processes):
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
        for handle in handles:
            handle.close()
        print(f"Report: {ROOT / args.report}; status={report['status']}; keep_running={success and args.keep_running}", flush=True)
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
