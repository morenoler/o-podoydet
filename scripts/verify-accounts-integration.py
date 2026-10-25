"""Actual HTTP account/listing audit in an isolated SQLite database and upload folder.

Requires a built Java JAR. Run: python -X utf8 scripts/verify-accounts-integration.py
Uses only fictional accounts, a clearly marked test listing, and generated PNG pixels.
No external messages, model calls, bookings or production databases are involved.
The local server is restarted to verify persistence, then always stopped.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPCookieProcessor
import zlib

ROOT = Path(__file__).resolve().parents[1]
PASSWORD = "fictional-http-smoke-password-2026"
PRIVATE = "PRIVATE_HTTP_OWNER_PROFILE_81c7"
METADATA = b"PRIVATE_HTTP_PNG_METADATA_81c7"
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Browser:
    def __init__(self, base):
        self.base = base
        self.cookies = CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookies))
        self.calls = 0

    def call(self, path, body=None, expected=200, mime="application/json"):
        data = body if isinstance(body, bytes) else (
            json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None)
        headers = {"Origin": self.base}
        if data is not None:
            headers["Content-Type"] = mime
        try:
            response = self.opener.open(Request(self.base + path, data=data, headers=headers), timeout=30)
        except HTTPError as error:
            response = error
        with response:
            raw, status, content_type = response.read(), response.status, response.headers.get("Content-Type", "")
        self.calls += 1
        value = json.loads(raw) if "json" in content_type else raw
        require(status == expected, f"{path}: HTTP {status}, expected {expected}: {str(value)[:200]}")
        return value


def png(color):
    def chunk(name, data):
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data))
    pixels = b"".join(b"\0" + bytes(color) * 3 for _ in range(2))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 3, 2, 8, 2, 0, 0, 0))
            + chunk(b"tEXt", b"Comment\0" + METADATA) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b""))


def pixels_match(raw, color):
    """Read returned PNG pixels, including PNG filters, without a third-party decoder."""
    require(raw.startswith(b"\x89PNG\r\n\x1a\n") and METADATA not in raw, "PNG or metadata sanitation failed")
    offset, compressed, channels = 8, b"", 0
    while offset < len(raw):
        length = struct.unpack(">I", raw[offset:offset + 4])[0]
        kind, data = raw[offset + 4:offset + 8], raw[offset + 8:offset + 8 + length]
        if kind == b"IHDR":
            width, height, depth, mode, compression, filtering, interlace = struct.unpack(">IIBBBBB", data)
            require((width, height, depth, interlace) == (3, 2, 8, 0) and mode in (2, 6), "Unexpected PNG dimensions/format")
            channels = 4 if mode == 6 else 3
        if kind == b"IDAT":
            compressed += data
        offset += length + 12
    decoded = zlib.decompress(compressed)
    stride, previous, output = 3 * channels, [0] * (3 * channels), []
    for y in range(2):
        start = y * (stride + 1)
        method, row = decoded[start], list(decoded[start + 1:start + 1 + stride])
        for x in range(stride):
            left, above, diagonal = row[x - channels] if x >= channels else 0, previous[x], previous[x - channels] if x >= channels else 0
            if method == 1:
                predictor = left
            elif method == 2:
                predictor = above
            elif method == 3:
                predictor = (left + above) // 2
            elif method == 4:
                estimate = left + above - diagonal
                distances = [abs(estimate - left), abs(estimate - above), abs(estimate - diagonal)]
                predictor = (left, above, diagonal)[distances.index(min(distances))]
            else:
                require(method == 0, "Unsupported PNG filter")
                predictor = 0
            row[x] = (row[x] + predictor) & 255
        output.extend(tuple(row[x:x + channels]) for x in range(0, stride, channels))
        previous = row
    require(all(pixel[:3] == color and (len(pixel) == 3 or pixel[3] == 255) for pixel in output),
            "Decoded uploaded pixels differ from original fixture")


def listing():
    return {"title": "HTTP DEMO — вымышленное объявление", "description": "Вымышленный тестовый номер. Объекта не существует; не бронировать.",
        "city": "Пусан", "address": "Учебный адрес; объект не существует", "roomType": "Тестовая комната",
        "capacity": 4, "pricePerNight": 100000, "amenities": [], "status": "draft", "photos": [],
        "floor": 5, "windowDirections": ["south", "east"],
        "searchProfile": {"notes": "Предусмотрено семейное размещение. Все окна выходят во двор. " + PRIVATE}}


def search_trip():
    start = (datetime.now(timezone(timedelta(hours=9))) + timedelta(days=30)).date()
    return {"region": "Пусан", "checkIn": start.isoformat(), "checkOut": (start + timedelta(days=2)).isoformat(),
            "adults": 2, "children": 1, "scenarios": [], "text": "Этаж не выше 5. Окна на юг",
            "preferences": [{"feature": "family", "required": True}, {"feature": "courtyard", "required": True}]}


def owner_rows(search, listing_id):
    return [row for group in ("results", "excluded") for row in search[group]
            if row["hotel"].get("accountListingId") == listing_id]


def check_no_private(value):
    raw = json.dumps(value, ensure_ascii=False)
    require(PRIVATE not in raw and '"searchProfile"' not in raw and '"notes"' not in raw,
            "Private owner profile leaked to guest/search output")


def audit(base, restart, report):
    host, guest, foreign, anonymous = [Browser(base) for _ in range(4)]
    checks = report["checks"]
    for client, role, alias in ((host, "host", "host"), (guest, "user", "traveler"), (foreign, "host", "other-owner")):
        account = client.call("/api/auth/register", {"name": "HTTP DEMO " + alias,
            "email": alias + "@http-smoke.example.test", "password": PASSWORD, "role": role}, 201)
        require(account["user"]["role"] == role and client.call("/api/auth/me")["user"]["id"] == account["user"]["id"],
                "Registration or session roundtrip failed")
    anonymous.call("/api/host/listings", expected=401)
    guest.call("/api/host/listings", expected=403)
    checks.append("Three fictional accounts; anonymous and wrong-role access denied")
    form = listing()
    saved = host.call("/api/host/listings", form, 201)
    listing_id = saved["id"]
    require(saved["floor"] == 5 and saved["windowDirections"] == ["south", "east"], "Floor or directions lost")
    query = search_trip()
    require(not owner_rows(anonymous.call("/api/search", query), listing_id), "Draft leaked into search")
    anonymous.call("/api/listings/" + listing_id, expected=404)
    foreign.call("/api/host/listings/" + listing_id, expected=404)
    foreign.call("/api/host/listings/" + listing_id, form, expected=404)
    checks.append("Draft hidden from public listing and search; foreign owner cannot read or edit it")
    colors = ((0, 255, 170), (240, 40, 120))
    photos = []
    for color in colors:
        source = png(color)
        anonymous.call("/api/host/photos", source, 401, "image/png")
        uploaded = host.call("/api/host/photos", source, 201, "image/png")
        photos.append(uploaded["url"])
        pixels_match(host.call(uploaded["url"]), color)
        anonymous.call(uploaded["url"], expected=404)
        foreign.call(uploaded["url"], expected=404)
    malicious = listing()
    malicious["photos"] = [photos[0]]
    foreign.call("/api/host/listings", malicious, expected=400)
    checks.append("Two PNG uploads preserve decoded pixels, strip metadata and enforce ownership")
    form.update(photos=photos, status="published")
    host.call("/api/host/listings/" + listing_id, form)
    public = anonymous.call("/api/listings/" + listing_id)
    require(public["floor"] == 5 and public["windowDirections"] == ["south", "east"], "Public geometry lost")
    check_no_private(public)
    for url, color in zip(photos, colors):
        pixels_match(anonymous.call(url), color)
    results = anonymous.call("/api/search", query)
    match = owner_rows(results, listing_id)
    require(len(match) == 1 and match[0]["best"]["status"] == "fits", "Published owner listing not admitted from explicit reported facts")
    require(all(c["assumed"] and c["evidenceStatus"] == "match" for c in match[0]["best"]["criteria"]),
            "Owner assertions lost their source qualification")
    require(len(match[0]["ownerCriteria"]) == 2 and all(c["status"] == "match" for c in match[0]["ownerCriteria"]),
            "Floor and direction constraints did not survive search extension")
    check_no_private(results)
    checks.append("Published listing and photos are public; search uses explicit owner facts without exposing private notes")
    form["photos"] = list(reversed(photos))
    host.call("/api/host/listings/" + listing_id, form)
    restart()
    require(host.call("/api/auth/me")["user"] is not None, "Session did not survive restart")
    persisted = anonymous.call("/api/listings/" + listing_id)
    require(persisted["photos"] == list(reversed(photos)), "Photo order did not survive restart")
    for url, color in zip(photos, colors):
        pixels_match(anonymous.call(url), color)
    form["photos"] = [photos[1]]
    host.call("/api/host/listings/" + listing_id, form)
    require(anonymous.call("/api/listings/" + listing_id)["photos"] == [photos[1]], "Photo removal not saved")
    anonymous.call(photos[0], expected=404)
    pixels_match(host.call(photos[0]), colors[0])
    checks.append("Restart preserves sessions, listings, pixels and photo order; removed photo stops being public")
    question_path = "/api/listings/" + listing_id + "/questions"
    anonymous.call(question_path, {"text": "Учебный вопрос"}, 401)
    question = guest.call(question_path, {"text": "Учебный вопрос: этаж действительно пятый?"}, 201)
    answer_path = "/api/host/questions/" + question["id"] + "/answer"
    foreign.call(answer_path, {"answer": "Чужой ответ"}, 404)
    host.call(answer_path, {"answer": "Учебный ответ владельца: в фикстуре указан пятый этаж."})
    answered = guest.call("/api/account/questions")
    require(any(q["id"] == question["id"] and "Учебный ответ" in (q.get("answer") or "") for q in answered), "Answer not visible to asking traveler")
    checks.append("Traveler question and owner answer persist; anonymous/foreign-owner actions rejected")
    booking_body = {"checkIn": query["checkIn"], "checkOut": query["checkOut"], "guests": 3, "note": "Учебная заявка; реального объекта нет"}
    booking_path = "/api/listings/" + listing_id + "/bookings"
    anonymous.call(booking_path, booking_body, 401)
    booking = guest.call(booking_path, booking_body, 201)
    require(booking["status"] == "pending" and booking["totalPrice"] == 200000, "Booking request snapshot incorrect")
    status_path = "/api/host/bookings/" + booking["id"] + "/status"
    foreign.call(status_path, {"status": "confirmed"}, 404)
    host.call(status_path, {"status": "confirmed"})
    history = guest.call("/api/account/bookings")
    require(any(b["id"] == booking["id"] and b["status"] == "confirmed" for b in history), "Confirmed request missing in traveler history")
    form["pricePerNight"] = 150000
    host.call("/api/host/listings/" + listing_id, form)
    historical = next(b for b in guest.call("/api/account/bookings") if b["id"] == booking["id"])
    require(historical["pricePerNight"] == 100000 and historical["totalPrice"] == 200000, "Listing edit changed historic booking price")
    host.call(status_path, {"status": "completed"}, 409)
    guest.call("/api/account/bookings/" + booking["id"] + "/cancel", {})
    require(next(b for b in host.call("/api/host/bookings") if b["id"] == booking["id"])["status"] == "cancelled", "Cancellation not reflected in owner history")
    checks.append("Local request confirmed and cancelled; price snapshot preserved; premature completion and foreign owner denied")
    guest.call("/api/auth/logout", {})
    require(guest.call("/api/auth/me")["user"] is None, "Logout did not revoke session")
    guest.call("/api/account/bookings", expected=401)
    checks.append("Logout revokes traveler session")
    report.update(httpRequests=sum(c.calls for c in (host, guest, foreign, anonymous)), uploadedImages=2,
                  pixelsPerImage=6, decodedPngChecks=7, restartedServer=True,
                  accounts=3, listings=1, questions=1, bookingRequests=1)


def main(audit_function=audit, default_report="docs/ACCOUNTS_HTTP_REPORT.json",
         audit_name="Accounts", isolated_directory="accounts-http-smoke"):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8083)
    parser.add_argument("--report", default=default_report)
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    work = ROOT / ".local" / isolated_directory / stamp
    work.mkdir(parents=True)
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "status": "running", "isDemo": True,
              "scope": "Local HTTP, fictional accounts/listing and generated PNGs; isolated database and uploads", "checks": []}
    child, log = None, None
    def stop():
        nonlocal child
        if child and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
        child = None
    try:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", args.port))
        jar_source = ROOT / "backend/target/o-podoydet-backend.jar"
        require(jar_source.is_file(), "Build Java backend first")
        jar = work / "backend.jar"
        shutil.copyfile(jar_source, jar)
        source = ROOT / "data/verified-hotels.json"
        report["inputSha256"] = {"jar": sha(jar), "catalog": sha(source)}
        java_binary = "java.exe" if os.name == "nt" else "java"
        jdks = sorted(p for p in (ROOT / ".local/tools").glob("jdk-21*") if p.is_dir())
        java_home = os.environ.get("JAVA_HOME")
        java = str(Path(java_home) / "bin" / java_binary) if java_home else (str(jdks[0] / "bin" / java_binary) if jdks else "java")
        tmp = work / "tmp"
        tmp.mkdir()
        env = {**os.environ, "PORT": str(args.port), "DB_PATH": str(work / "accounts.sqlite3"),
               "UPLOADS_PATH": str(work / "uploads"), "DATA_PATH": str(source), "DIST_PATH": str(ROOT / "dist"),
               "ACCOUNT_MODE": "true", "LAB_MODE": "false", "LLM_API_KEY": "", "ADVISOR_LOCAL_MODEL": "",
               "SESSION_COOKIE_SECURE": "false", "FRONTEND_ORIGIN": "", "JAVA_TOOL_OPTIONS": "-Djava.io.tmpdir=" + str(tmp)}
        log = (work / "server.log").open("ab")
        base = f"http://127.0.0.1:{args.port}"
        def start():
            nonlocal child
            child = subprocess.Popen([java, "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-jar", str(jar)],
                cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, creationflags=FLAGS)
            deadline = time.monotonic() + 30
            while True:
                try:
                    health = Browser(base).call("/api/health")
                    require(health["accountsEnabled"], "Accounts module is disabled")
                    return
                except (URLError, TimeoutError):
                    require(child.poll() is None and time.monotonic() < deadline, "Server startup failed; inspect isolated log")
                    time.sleep(0.15)
        def restart():
            stop()
            start()
        start()
        print(f"{audit_name} HTTP audit: {base}; isolated files {work}", flush=True)
        audit_function(base, restart, report)
        require(sha(source) == report["inputSha256"]["catalog"], "Source catalog changed during audit")
        report["status"] = "passed"
    except Exception as error:
        report.update(status="failed", error=str(error))
        print("FAILED: " + str(error), flush=True)
    finally:
        stop()
        if log:
            log.close()
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        report["serverStopped"] = True
        output = ROOT / args.report
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{report['status']}: {len(report['checks'])} stages; report {output}", flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
