"""Exercise private owner clarifications over HTTP against an isolated, restartable database.

Uses fictional listings and accounts only. Checks revisions, evidence scopes, admission,
privacy boundaries and fresh searches. Does not contact hotel owners or external models.
Run after the Java build: python -X utf8 scripts/verify-clarifications-integration.py
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import time
import uuid

spec = importlib.util.spec_from_file_location("account_http", Path(__file__).with_name("verify-accounts-integration.py"))
account_http = importlib.util.module_from_spec(spec)
spec.loader.exec_module(account_http)
Browser, require = account_http.Browser, account_http.require

PRIVATE_NOTE = "PRIVATE_CLARIFICATION_NOTE_9c71"
PRIVATE_ANSWER = "PRIVATE_CLARIFICATION_ANSWER_9c71"
PRIVATE_TRIP = "PRIVATE_ORIGINAL_TRIP_9c71"
SEOUL = timezone(timedelta(hours=9))


def key():
    return str(uuid.uuid4())


def query(features=("step_free_access",), mode="explore"):
    start = datetime.now(SEOUL).date() + timedelta(days=7)
    return {"region": "Пусан", "checkIn": start.isoformat(), "checkOut": (start + timedelta(days=2)).isoformat(),
            "adults": 2, "children": 1, "scenarios": [], "text": "", "admissionMode": mode,
            "preferences": [{"feature": feature, "required": True} for feature in features]}


def answer(question, value, **changes):
    value = {"expectedVersion": question["version"], "requestKey": key(), "value": value,
             "text": "Учебное заявление для вымышленного объекта. " + PRIVATE_ANSWER,
             "observedOn": None, "validFrom": None, "validTo": None,
             "validForDays": 30, "supersedes": []}
    value.update(changes)
    return value


def one_match(result, listing_id):
    found = account_http.owner_rows(result, listing_id)
    require(len(found) == 1, "A published unit must appear exactly once")
    return found[0]


def criterion(match, feature="step_free_access"):
    return next(c for c in match["best"]["criteria"] if c["feature"] == feature)


def evidence_status(client, listing_id, feature="step_free_access", mode="explore"):
    result = client.call("/api/search", query((feature,), mode))
    match = one_match(result, listing_id)
    return criterion(match, feature), match


def public_safe(value, private_ids=()):
    raw = json.dumps(value, ensure_ascii=False)
    for secret in (PRIVATE_NOTE, PRIVATE_ANSWER, PRIVATE_TRIP, *private_ids):
        require(secret not in raw, "Private clarification content or identity leaked to a public projection")
    for field in ('"relatedStatements"', '"supersedes"', '"history"'):
        require(field not in raw, "Private revision metadata leaked to public projection")


def wait_run(client, run_id):
    deadline = time.monotonic() + 30
    while True:
        run = client.call("/api/advisor/runs/" + run_id)
        if run["status"] not in ("queued", "running"):
            return run
        require(time.monotonic() < deadline, "Rules advisor did not finish")
        time.sleep(0.1)


def audit(base, restart, report):
    host, guest, guest2, foreign, anonymous = clients = [Browser(base) for _ in range(5)]
    checks = report["checks"]
    report["scope"] = "Private clarification and advisor HTTP regression; fictional units; isolated database"
    user_ids = []
    for client, role, alias in ((host, "host", "host"), (guest, "user", "guest"),
                                (guest2, "user", "other-guest"), (foreign, "host", "other-host")):
        user = client.call("/api/auth/register", {"name": "CLARIFICATION DEMO " + alias,
            "email": alias + "@clarification-smoke.example.test", "password": account_http.PASSWORD, "role": role}, 201)["user"]
        user_ids.append(user["id"])
    form = account_http.listing()
    form.update(title="CLARIFICATION DEMO — вымышленное размещение", status="published", searchProfile={"notes": ""})
    listing_id = host.call("/api/host/listings", form, 201)["id"]
    other_form = {**form, "title": "CLARIFICATION DEMO — другое размещение"}
    other_id = host.call("/api/host/listings", other_form, 201)["id"]
    ask_path = "/api/listings/" + listing_id + "/clarifications"

    def ask(feature="step_free_access", client=guest, trip=None, **changes):
        body = {"feature": feature, "trip": trip or query((feature,)), "note": PRIVATE_NOTE, "requestKey": key()}
        body.update(changes)
        return client.call(ask_path, body, 201), body

    def respond(question, value, **changes):
        body = answer(question, value, **changes)
        return host.call("/api/host/clarifications/" + question["id"] + "/answers", body), body

    anonymous.call("/api/account/clarifications", expected=401)
    guest.call("/api/host/clarifications", expected=403)
    host.call("/api/account/clarifications", expected=403)
    anonymous.call(ask_path, {"feature": "family", "trip": query(), "requestKey": key()}, 401)
    for unsupported in ("area_safety", "clean_air", "low_noise", "beach_walk", "step_free_route", "unknown"):
        guest.call(ask_path, {"feature": unsupported, "trip": query(), "requestKey": key()}, 400)
    checks.append("Authentication, roles and the three-feature owner allowlist enforced")

    initial, selected = evidence_status(anonymous, listing_id)
    require(initial["evidenceStatus"] == "unknown" and selected["best"]["provisional"], "Unknown unit must be preliminary")
    strict, selected_strict = evidence_status(anonymous, listing_id, mode="verified")
    require(selected_strict["best"]["status"] == "excluded", "Strict mode admitted missing owner evidence")
    private_trip = query()
    private_trip["text"] = PRIVATE_TRIP
    question, body = ask(trip=private_trip)
    replay = guest.call(ask_path, body, 201)
    require(replay["id"] == question["id"], "Retry duplicated the private question")
    guest.call(ask_path, {**body, "note": "Different payload"}, 409)
    host_view = next(q for q in host.call("/api/host/clarifications") if q["id"] == question["id"])
    require("trip" not in host_view and PRIVATE_TRIP not in json.dumps(host_view), "Full traveler query exposed to host")
    require(host_view["note"] == PRIVATE_NOTE and host_view["context"]["adults"] == 2, "Explicit note/context missing")
    require(guest2.call("/api/account/clarifications") == [] and foreign.call("/api/host/clarifications") == [], "Foreign dialogue disclosed")
    foreign.call("/api/host/clarifications/" + question["id"] + "/answers", answer(question, True), 404)
    guest.call("/api/host/clarifications/" + question["id"] + "/answers", answer(question, True), 403)
    checks.append("Private ask is idempotent; traveler context is minimized for the host; foreign readers/writers denied")

    answered, answer_body = respond(question, True)
    repeat = host.call("/api/host/clarifications/" + question["id"] + "/answers", answer_body)
    require(repeat["version"] == answered["version"] and len(repeat["history"]) == len(answered["history"]), "Answer retry added a revision")
    host.call("/api/host/clarifications/" + question["id"] + "/answers", {**answer_body, "text": "Changed"}, 409)
    host.call("/api/host/clarifications/" + question["id"] + "/answers", answer(question, False), 409)
    positive, selected = evidence_status(anonymous, listing_id, mode="verified")
    require(positive["evidenceStatus"] == "match" and positive["assumed"] and selected["best"]["status"] == "fits", "Fresh statement failed to update admission")
    require(positive["reportedEvidence"] and all(e["method"] == "owner_response" and e["provenanceStatus"] == "reported"
            and e["scope"] == "listing_unit" for e in positive["reportedEvidence"]), "Owner source qualification lost")
    other, _ = evidence_status(anonymous, other_id)
    require(other["evidenceStatus"] == "unknown", "One listing's answer leaked into another unit")
    detail = anonymous.call("/api/hotels/account-listing:" + listing_id + "/evaluate", query(mode="verified"))
    require(len(detail["best"]["criteria"]) == 8 and detail["best"]["status"] == selected["best"]["status"], "Expanded detail disagrees with search")
    for public_path in ("/api/listings/" + listing_id, "/api/listings/" + listing_id + "/questions"):
        # Listings already expose their publishing host's ID; traveler identities stay private.
        public_safe(anonymous.call(public_path), [question["id"], *user_ids[1:]])
    public_safe(detail, [question["id"], *user_ids])
    checks.append("Structured answer changes only its own unit; public evidence includes provenance without dialogue or identities")

    second, _ = ask(client=guest2)
    opposite, _ = respond(second, False)
    for mode in ("explore", "verified"):
        conflict, match = evidence_status(anonymous, listing_id, mode=mode)
        require(conflict["evidenceStatus"] == "conflict" and match["best"]["status"] == "excluded", "Contradictory statements did not block admission")
    repaired, _ = respond(opposite, True, supersedes=[answered["answer"]["id"]])
    require(evidence_status(anonymous, listing_id)[0]["evidenceStatus"] == "match", "Explicit correction did not resolve conflict")
    cleared, _ = respond(repaired, None)
    require(evidence_status(anonymous, listing_id)[0]["evidenceStatus"] == "unknown", "Unknown revision revived an older positive statement")
    require(len(cleared["history"]) >= 3, "Answer history was overwritten")
    checks.append("Opposite statements conflict in both modes; explicit correction resolves it; unknown revision cannot revive old positive")

    old_day = (datetime.now(SEOUL).date() - timedelta(days=3)).isoformat()
    stale, _ = respond(cleared, True, observedOn=old_day, validForDays=1)
    stale_evidence, stale_match = evidence_status(anonymous, listing_id)
    require(stale_evidence["evidenceStatus"] == "stale" and stale_match["best"]["provisional"], "Expired statement became confirmed")
    tomorrow = (datetime.now(SEOUL).date() + timedelta(days=1)).isoformat()
    host.call("/api/host/clarifications/" + question["id"] + "/answers", answer(answered, True, observedOn=tomorrow), 400)
    fresh, _ = respond(stale, True, validFrom=query()["checkIn"], validTo=query()["checkIn"])
    require(evidence_status(anonymous, listing_id)[0]["evidenceStatus"] in ("unknown", "stale"), "Partial validity covered the entire stay")
    complete, _ = respond(fresh, True, validFrom=query()["checkIn"], validTo=query()["checkOut"])
    require(evidence_status(anonymous, listing_id)[0]["evidenceStatus"] == "match", "Full-date validity not accepted")
    checks.append("Source freshness and full-stay validity enforced; future source date rejected")

    partial, _ = ask(client=guest2)
    one_day = (datetime.fromisoformat(query()["checkIn"]).date() + timedelta(days=1)).isoformat()
    partial_negative, _ = respond(partial, False, validFrom=one_day, validTo=one_day)
    for mode in ("explore", "verified"):
        evidence, match = evidence_status(anonymous, listing_id, mode=mode)
        require(evidence["evidenceStatus"] == "conflict" and match["best"]["status"] == "excluded",
                "A negative statement for one day was ignored during a longer trip")
    partial_unknown, _ = respond(partial_negative, None)
    evidence, match = evidence_status(anonymous, listing_id)
    require(evidence["evidenceStatus"] == "unknown" and match["best"]["provisional"],
            "Another current 'unknown' statement was hidden behind an older positive answer")
    complete, _ = respond(complete, True, supersedes=[partial_unknown["answer"]["id"]])
    require(evidence_status(anonymous, listing_id)[0]["evidenceStatus"] == "match", "Explicitly resolving the unknown did not restore admission")
    checks.append("One-day contraindication blocks a longer stay; unresolved owner uncertainty cannot silently confirm the unit")

    before = guest.call("/api/search", query())
    old_title = form["title"]
    form["title"] += " — обновлён заголовок"
    host.call("/api/host/listings/" + listing_id, form)
    require(evidence_status(anonymous, listing_id)[0]["evidenceStatus"] == "match", "Title edit invalidated physical conditions")
    old_address = form["address"]
    form["address"] += "; другой вход"
    host.call("/api/host/listings/" + listing_id, form)
    require(evidence_status(anonymous, listing_id)[0]["evidenceStatus"] in ("unknown", "stale"), "Changed unit retained old conditions")
    form["address"], form["title"] = old_address, old_title
    host.call("/api/host/listings/" + listing_id, form)
    require(evidence_status(anonymous, listing_id)[0]["evidenceStatus"] in ("unknown", "stale"), "Edit then revert resurrected invalidated conditions")
    # The advisor still uses its exact prior result; a new search sees updated evidence.
    run = guest.call("/api/advisor/runs", {"mode": "rules", "trip": query(), "searchId": before["searchId"]}, 202)
    run_id = run["id"]
    foreign.call("/api/advisor/runs/" + run_id, expected=404)
    anonymous.call("/api/advisor/runs/" + run_id, expected=404)
    guest2.call("/api/advisor/runs/" + run_id + "/cancel", {}, 404)
    completed_run = wait_run(guest, run_id)
    public_safe(completed_run, [question["id"], second["id"], *user_ids])
    checks.append("Cosmetic edits preserve evidence; material edit and revert invalidate it; prior search remains a private snapshot")

    # Different room features must never be assembled across two advertised units.
    family_a, _ = ask("family")
    host.call("/api/host/clarifications/" + family_a["id"] + "/answers",
              answer(family_a, True, text="Только для взрослых, с детьми нельзя."), 400)
    respond(family_a, True)
    courtyard_b = guest.call("/api/listings/" + other_id + "/clarifications", {
        "feature": "courtyard", "trip": query(("courtyard",)), "requestKey": key()}, 201)
    respond(courtyard_b, True)
    paired = anonymous.call("/api/search", query(("family", "courtyard"), "verified"))
    for unit in (listing_id, other_id):
        require(one_match(paired, unit)["best"]["status"] == "excluded", "Conditions were assembled across different units")
    checks.append("A combination of requirements is evaluated within one unit, never across listings")

    # Simultaneous editors see an explicit version conflict, not silent last-write-wins.
    race, _ = ask("family")
    payloads = [answer(race, True), answer(race, False)]
    def concurrent(payload):
        browser = Browser(base)
        for cookie in host.cookies:
            browser.cookies.set_cookie(cookie)
        try:
            return browser.call("/api/host/clarifications/" + race["id"] + "/answers", payload)
        except AssertionError as error:
            require("HTTP 409" in str(error), "Unexpected concurrent request failure")
            return "conflict"
    with ThreadPoolExecutor(max_workers=2) as pool:
        race_results = list(pool.map(concurrent, payloads))
    require(sum(value == "conflict" for value in race_results) == 1, "Concurrent edits did not produce exactly one version conflict")
    checks.append("Concurrent answer edits commit once and return an explicit version conflict")

    own_before = guest.call("/api/account/clarifications")
    restart()
    own_after = guest.call("/api/account/clarifications")
    require(own_after == own_before, "Private dialogue/revisions did not survive restart")
    require(guest2.call("/api/advisor/runs/" + run_id, expected=404), "Foreign run visible after restart")
    require(guest.call("/api/advisor/runs/" + run_id)["id"] == run_id, "Owner lost persistent advisor run")
    guest.call("/api/auth/logout", {})
    guest.call("/api/account/clarifications", expected=401)
    guest.call("/api/advisor/runs/" + run_id, expected=404)
    checks.append("Restart preserves dialogue/history and ownership; logout revokes account and advisor access")
    report.update(httpRequests=sum(c.calls for c in clients) + 2, accounts=4, listings=2,
                  restartedServer=True, concurrencyChecks=1, statusesChecked=["unknown", "match", "conflict", "stale"])


if __name__ == "__main__":
    raise SystemExit(account_http.main(audit, ".local/clarifications-http-report.json",
                                     "Clarifications", "clarifications-http-smoke"))
