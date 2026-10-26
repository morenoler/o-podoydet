"""Offline expanded acceptance against all real catalog accommodation identities.

Exercises floor scenarios, not verified rooms. Fails on invariants; writes a
compact evidence/coverage report without storing megabytes of repeated sources.
"""
import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import time
from unittest.mock import patch

from window_view.api import Application, ROOT, read_json


def init_worker(scene_id):
    global app, scene
    scene = Application().scene(scene_id)
    app = Application(scenes={scene_id: scene})


def verify_hotel(item):
    region, hotel = item
    rows = []
    for floor, day in [(3, "2026-03-20"), (8, "2026-06-21"), (17, "2026-12-21")]:
        request = {**region["request_defaults"], "hotel": hotel["hotel"], "floor": floor, "date": day}
        with patch("window_view.sources.OpenDataClient.fetch_scene", side_effect=AssertionError("offline only")), patch("window_view.elevation.urlopen", side_effect=AssertionError("offline only")):
            result = app.run(request)
        assert not result["is_demo"] and not result["actual_visibility_confirmed"]
        resolution = result["room_resolution"]
        assert resolution["floor"]["floor"] == floor
        assert resolution["scope"] == "hotel_floor_scenarios"
        assert not resolution["room_view_confirmed"]
        assert 150 <= resolution["evaluated_radius_m"] <= request["radius_m"]
        assert len(result["assessments"]) == 8
        source_ids = {s["id"] for s in result["sources"]}
        statuses = Counter()
        for assessment in result["assessments"]:
            sea = assessment["categories"]["sea"]
            if sea["sample_count"] == 0:
                assert sea["status"] == "unknown" and sea["visible_in_model"] is None
                assert sea["reason"] == "no_targets_in_open_data_within_radius"
            for target in assessment["targets"]:
                assert set(target["source_ids"]) <= source_ids
                status = target["status"]
                assert status in {"clear_in_model", "blocked", "outside_fov", "unknown"}
                assert target["visible_in_model"] is ({"clear_in_model": True, "blocked": False, "outside_fov": False, "unknown": None}[status])
                statuses[status] += 1
                # Incomplete real footprints cannot support a clear ray claim.
                if not scene["completeness"]["geometry_complete"]:
                    assert status != "clear_in_model"
            for key in ("sunrise", "sunset"):
                event = assessment["sun"][key]
                assert event is not None
                local = datetime.fromisoformat(event["time_utc"].replace("Z", "+00:00")).astimezone(timezone(timedelta(hours=9)))
                assert local.date().isoformat() == day
                assert not event["actual_first_or_last_visible_time_computed"]
        json.dumps(result, allow_nan=False)
        rows.append({"catalog_id": hotel["catalog_id"], "floor": floor, "date": day,
                     "sea_sample_count": result["assessments"][0]["categories"]["sea"]["sample_count"],
                     "subject_building_id": resolution["subject_building_id"],
                     "evaluated_radius_m": resolution["evaluated_radius_m"],
                     "conflicts": resolution["conflicts"], "statuses": dict(statuses)})
    return rows


def verify(output, workers=1):
    started = time.monotonic()
    region = read_json(ROOT / "data/regions.json")["busan-haeundae"]
    jobs = [(region, hotel) for hotel in region["hotels"]]
    rows, totals = [], Counter()
    with ProcessPoolExecutor(max_workers=workers, initializer=init_worker, initargs=(region["scene_id"],)) as pool:
        for hotel, checked in zip(region["hotels"], pool.map(verify_hotel, jobs)):
            rows.extend(checked)
            for row in checked:
                totals.update(row["statuses"])
            print(f"checked {len(rows):3d}/{len(region['hotels'])*3}: {hotel['hotel']['name']}", flush=True)
    report = {"region": "Busan / Haeundae", "checked_at": datetime.now(timezone.utc).isoformat(),
              "workers": workers, "hotel_count": len(region["hotels"]), "request_count": len(rows),
              "floor_date_pairs": [[3, "2026-03-20"], [8, "2026-06-21"], [17, "2026-12-21"]],
              "assertions_passed": True, "offline": True, "field_verified_rooms": 0,
              "elapsed_seconds": round(time.monotonic() - started, 2), "target_statuses": dict(totals),
              "scene_sha256": read_json(ROOT / "data/scenes.json")[region["scene_id"]]["sha256"],
              "limitations": ["Model consistency/coverage check, not measured view accuracy.",
                              "Test floors are scenarios, not confirmed guest-room floors or availability.",
                              "Three paired floor/date cases per hotel, not a full Cartesian product."], "cases": rows}
    Path(output).write_bytes((json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode())
    print(json.dumps({k: v for k, v in report.items() if k != "cases"}, ensure_ascii=False, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(ROOT / "data/busan-quality.json"))
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=1)
    args = parser.parse_args()
    verify(args.output, args.workers)
