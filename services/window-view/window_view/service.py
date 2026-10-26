"""Public view assessment: room geometry, explicit floor, hotel fallback."""
from copy import deepcopy
from datetime import datetime, timezone
import math

from . import __version__
from .elevation import distance, nearest_elevation, reconcile_elevations
from .geometry import assess_target, assess_sun, point_in_polygon
from .solar import solar_events
from .validation import validate_request, validate_source, validate_window, ValidationError

DIRECTIONS = [(0, "N"), (45, "NE"), (90, "E"), (135, "SE"),
              (180, "S"), (225, "SW"), (270, "W"), (315, "NW")]
KINDS = ("sea", "neighbor_building", "landmark", "water", "park", "mountain")


def _height(request, subject):
    floor = request["floor"]
    ground = request.get("ground_floor_number", 1)
    eye = request.get("eye_height_m", 1.6)
    assumed = []
    if "eye_height_m" not in request:
        assumed.append("eye_height_m=1.6 above the floor; window sill and seated viewing position unknown")
    step = request.get("floor_height_m")
    basis = "request_supplied"
    if step is None:
        try:
            levels = float((subject or {}).get("tags", {}).get("building:levels", ""))
            height = (subject or {}).get("height_m")
            derived = height / levels if height and levels > 0 else None
        except (ValueError, TypeError):
            derived = None
        if derived and 2 <= derived <= 6:
            step, basis = derived, "estimated_from_building_height_and_levels"
            assumed.append("Equal storeys estimated from total building height; roof and nonstandard storeys are not resolved")
        else:
            step, basis = 3.0, "assumed_3m_storey"
            assumed.append("No usable storey height; assumed 3 m, sensitivity range 2.5–3.5 m")
    n = floor - ground
    height = n * step + eye
    interval = [height, height] if basis == "request_supplied" else [max(0.3, n * max(2, step - 0.5) + eye), n * (step + 0.5) + eye]
    return {"floor": floor, "ground_floor_number": ground, "floor_height_m": round(step, 3),
            "eye_height_m": eye, "height_agl_m": round(height, 3),
            "height_range_m": [round(v, 3) for v in interval], "basis": basis, "assumptions": assumed}


def _subject(scene, hotel):
    exact = [b for b in scene["buildings"] if b["id"] == hotel["id"]]
    if exact:
        return exact[0]
    contained = [b for b in scene["buildings"] if any(point_in_polygon([hotel["lat"], hotel["lon"]], p) for p in b["polygons"])]
    return contained[0] if len(contained) == 1 else None


def prepare(request, scene, observations=None):
    validate_request(request)
    hotel = request["hotel"]
    offset = distance(hotel, scene["origin"])
    available_radius = scene["radius_m"] - offset
    if available_radius < 150:
        raise ValidationError("Hotel lies outside the usable scene coverage; fetch a scene centred on this hotel")
    subject = _subject(scene, hotel)
    height = _height(request, subject)
    conflicts = []
    try:
        levels = int((subject or {}).get("tags", {}).get("building:levels", ""))
        if request["floor"] - request.get("ground_floor_number", 1) >= levels and levels > 0:
            conflicts.append("requested_floor_exceeds_mapped_levels")
    except (ValueError, TypeError):
        pass
    if subject and subject.get("height_m") is not None and height["height_range_m"][0] > subject["height_m"]:
        conflicts.append("requested_observer_above_mapped_roof")
    room = request.get("room")
    window = (room or {}).get("window")
    room_source = (room or {}).get("source")
    basis = "request_supplied_not_independently_verified"
    if room and not window:
        records = [r for r in (observations or {}).get("rooms", [])
                   if r.get("hotel_id") == hotel["id"] and r.get("room_id") == room["id"]
                   and r.get("scope") == "physical_room" and r.get("floor") == request["floor"]]
        # Multiple candidates may conflict; never pick the first silently.
        if len(records) == 1:
            try:
                validate_source(records[0].get("source"))
                validate_window(records[0].get("window"))
                window, room_source = records[0]["window"], records[0]["source"]
                basis = "public_room_observation_reported"
            except ValidationError:
                conflicts.append("invalid_public_room_observation")
        elif len(records) > 1:
            conflicts.append("multiple_public_room_observations_require_review")
    complete = bool(window and {"lat", "lon", "bearing_deg"} <= window.keys())
    if complete and distance(hotel, window) > min(250, available_radius / 2):
        raise ValidationError("Window is too far from the selected hotel point")
    window_in_subject = bool(subject and complete and any(point_in_polygon([window["lat"], window["lon"]], p) for p in subject["polygons"]))
    if complete and subject and not window_in_subject:
        conflicts.append("window_outside_identified_building")
    terrain = scene.get("terrain", {})
    def observer(point, direction, label):
        elevation = terrain.get("flat_elevation_m")
        if elevation is None:
            elevation = nearest_elevation(point, terrain.get("samples", []), 70)
        ground_conflict = bool(subject and subject.get("ground_elevation_conflict"))
        if ground_conflict:
            elevation = None
        return {"id": label, "lat": point["lat"], "lon": point["lon"],
                "ground_elevation_m": elevation, "height_agl_m": height["height_agl_m"],
                "ground_elevation_conflict": ground_conflict,
                "height_range_m": height["height_range_m"], "bearing_deg": direction,
                "horizontal_fov_deg": (window or {}).get("horizontal_fov_deg", 90) if complete else 45,
                "vertical_fov_deg": (window or {}).get("vertical_fov_deg", 90) if complete else 90,
                "pitch_deg": (window or {}).get("pitch_deg", 0) if complete else 0,
                "exclude_building_ids": [subject["id"]] if subject and (not complete or window_in_subject) else []}
    if complete:
        observers = [observer(window, window["bearing_deg"], "requested_window")]
    else:
        observers = [observer(hotel, angle, label) for angle, label in DIRECTIONS]
    # JSON integer-valued numbers (e.g. 540.0) satisfy the API schema.
    events = solar_events(request["date"], hotel["lat"], hotel["lon"], int(request["utc_offset_minutes"]))
    max_radius = min(request.get("radius_m", 1200), available_radius)
    if complete:
        max_radius = min(max_radius, scene["radius_m"] - distance(window, scene["origin"]))
    candidates = [t for t in scene["targets"] if distance(window if complete else hotel, t) <= max_radius]
    # Balanced deterministic sample keeps coastline/landmarks from crowding out one another.
    selected = []
    for kind in KINDS:
        selected.extend(sorted((t for t in candidates if t["kind"] == kind), key=lambda t: (distance(hotel, t), t["id"]))[:8])
    for building in sorted(scene["buildings"], key=lambda b: b["id"]):
        if subject and building["id"] == subject["id"]:
            continue
        if not building["polygons"]:
            continue
        ring = building["polygons"][0]["outer"][:-1]
        if not ring:
            continue
        # A supplied window can be on a different side of the hotel point.
        # Select the roof sample relative to the actual observer; using the
        # hotel point can select a far-side corner behind the target's wall.
        target_origin = window if complete else hotel
        point = min(ring, key=lambda p: distance(target_origin, {"lat": p[0], "lon": p[1]}))
        if distance(window if complete else hotel, {"lat": point[0], "lon": point[1]}) > min(500, max_radius):
            continue
        selected.append({"id": "roof:" + building["id"], "kind": "neighbor_building",
                         "name": building.get("name") or building["id"], "lat": point[0], "lon": point[1],
                         "height_m": building.get("height_m"),
                         "ground_elevation_conflict": bool(building.get("ground_elevation_conflict")),
                         "elevation_m": (building["ground_elevation_m"] + building["height_m"])
                         if building.get("ground_elevation_m") is not None and building.get("height_m") is not None else None,
                         "source_ids": building["source_ids"], "target_building_id": building["id"],
                         "sample_kind": "nearest_roof_corner"})
    selected = sorted(selected, key=lambda t: (KINDS.index(t["kind"]), distance(hotel, t), t["id"]))
    building_targets = [t for t in selected if t["kind"] == "neighbor_building"][:12]
    selected = [t for t in selected if t["kind"] != "neighbor_building"] + building_targets
    resolution = {"requested_room_id": room.get("id") if room else None,
                  "scope": "room_window" if complete else "hotel_floor_scenarios",
                  "basis": basis if complete else "room_geometry_unavailable" if room else "hotel_requested",
                  "room_view_confirmed": False, "input_source": room_source,
                  "floor": height, "subject_building_id": subject["id"] if subject else None,
                  "conflicts": conflicts,
                  "window_direction_known": complete, "window_position_known": complete,
                  "evaluated_radius_m": round(max_radius, 1)}
    return resolution, observers, selected, events


def _sensitivity(function, observer, *args):
    base = function(observer, *args)
    low, high = observer["height_range_m"]
    if low != high:
        ends = [function({**observer, "height_agl_m": h}, *args) for h in (low, high)]
        safely_outside = (base["status"] == "outside_fov" and
                          (function is assess_sun or base.get("elevation_angle_deg") is None))
        if not safely_outside or any(result["status"] != base["status"] for result in ends):
            base["nominal_status"] = base["status"]
            base["status"], base["visible_in_model"] = "unknown", None
            base.setdefault("uncertainties", []).append("observer_height_is_estimated; sampled_endpoints_do_not_prove_the_whole_interval")
        base["height_sensitivity_statuses"] = [r["status"] for r in ends]
    return base


def _summary(results, kind):
    subset = [r for r in results if r["kind"] == kind]
    statuses = [r["status"] for r in subset]
    # The scene is sampled. Even all sampled points blocked does not prove that
    # the whole sea, park, facade or landmark is invisible.
    return {"status": "potential_view_in_model" if "clear_in_model" in statuses else "unknown",
            "visible_in_model": True if "clear_in_model" in statuses else None,
            "sample_count": len(subset), "clear_sample_count": statuses.count("clear_in_model"),
            "blocked_sample_count": statuses.count("blocked"),
            "outside_fov_sample_count": statuses.count("outside_fov"),
            "unknown_sample_count": statuses.count("unknown"),
            "reason": "sampled_points_only" if subset else "no_targets_in_open_data_within_radius"}


def _coverage_guard(result, scene):
    missing_geometry = scene.get("completeness", {}).get("geometry_complete") is False
    no_footprints = not scene["buildings"] and not scene.get("is_demo")
    if result["status"] == "clear_in_model" and (missing_geometry or no_footprints):
        result["status"], result["visible_in_model"] = "unknown", None
        result.setdefault("uncertainties", []).append("incomplete_mapped_obstacle_geometry" if missing_geometry else "no_building_coverage")
    return result


def estimate(request, scene, observations=None):
    scene = deepcopy(scene)
    reconcile_elevations(scene)
    resolution, observers, targets, events = prepare(request, scene, observations)
    scene.setdefault("terrain", {})["radius_m"] = resolution["evaluated_radius_m"]
    scene["terrain"]["coverage_radius_m"] = resolution["evaluated_radius_m"]
    assessments = []
    for observer in observers:
        results = []
        for target in targets:
            # The target's footprint can itself obscure a far-side/concave
            # roof corner. Geometry ignores endpoint contact, so the whole
            # target prism must remain in the intervening-obstacle trace.
            result = _sensitivity(assess_target, observer, target, scene["buildings"], scene.get("terrain"))
            if target.get("target_building_id") and target.get("height_m") is None and result["status"] != "outside_fov":
                result["status"], result["visible_in_model"], result["elevation_angle_deg"] = "unknown", None, None
                result.setdefault("uncertainties", []).append("roof_height_unknown")
            _coverage_guard(result, scene)
            if resolution["conflicts"]:
                result["status"], result["visible_in_model"] = "unknown", None
                result.setdefault("uncertainties", []).extend(resolution["conflicts"])
            results.append({"id": target["id"], "name": target.get("name"), "kind": target["kind"],
                            "source_ids": target["source_ids"], "sample_kind": target.get("sample_kind", "point"), **result})
        sun = {}
        for key in ("sunrise", "sunset"):
            event = events.get(key)
            sun[key] = None if not event else {**event,
                "visibility": _coverage_guard(_sensitivity(assess_sun, observer, event["azimuth_deg"], 0.0, scene["buildings"], scene.get("terrain")), scene),
                "sightline": "approximate apparent upper limb at nominal horizon event; fixed refraction assumption",
                "evaluated_elevation_deg": 0.0,
                "actual_first_or_last_visible_time_computed": False}
            if sun[key] and resolution["conflicts"]:
                sun[key]["visibility"]["status"], sun[key]["visibility"]["visible_in_model"] = "unknown", None
                sun[key]["visibility"].setdefault("uncertainties", []).extend(resolution["conflicts"])
        assessments.append({"observer": observer, "categories": {kind: _summary(results, kind) for kind in KINDS},
                            "targets": results, "sun": {**sun, "polar_state": events.get("polar_state"), "method": events.get("method")}})
    public_claims = [r for r in (observations or {}).get("claims", []) if r.get("hotel_id") == request["hotel"]["id"]]
    warnings = list(scene.get("warnings", [])) + resolution["floor"]["assumptions"]
    if resolution["scope"] == "hotel_floor_scenarios":
        warnings.append("Directional scenarios use the hotel representative point at the requested floor, not actual windows. They cannot establish a view for the requested room.")
    warnings.extend([
        "Visibility is a 2.5D geometric estimate, not a photograph or independent room verification.",
        "Subject building is excluded: its own wings, balconies, window recesses, curtains and glazing are not modelled.",
        "Trees, temporary construction, haze, clouds and weather are not fully modelled. Clear sky is an assumption.",
        "OSM completeness is unknown; unmapped obstacles and objects beyond the evaluated radius may change the result.",
        "Coastline water-side samples do not quantify the percentage of sea visible through a window.",
        "Sunrise/sunset are nominal astronomical events; a blocked horizon may delay first sight of the sun or advance its disappearance.",
    ])
    return {"schema_version": "1.0", "service_version": __version__,
            "generated_at": datetime.now(timezone.utc).isoformat(), "hotel": request["hotel"],
            "date": request["date"], "utc_offset_minutes": request["utc_offset_minutes"],
            "is_demo": bool(scene.get("is_demo", False)), "actual_visibility_confirmed": False,
            "room_resolution": resolution, "assessments": assessments,
            "published_claims": public_claims, "sources": scene["sources"],
            "coverage": {"buildings": len(scene["buildings"]),
                         "buildings_with_tagged_height": sum(b.get("height_basis") == "osm_height" for b in scene["buildings"]),
                         "buildings_with_estimated_height": sum(b.get("height_basis") == "estimated_levels" for b in scene["buildings"]),
                         "buildings_with_unknown_height": sum(b.get("height_basis") == "unknown" for b in scene["buildings"]),
                         "buildings_with_ground_conflict": sum(bool(b.get("ground_elevation_conflict")) for b in scene["buildings"]),
                         "synthetic_buildings": len(scene["buildings"]) if scene.get("is_demo") else 0,
                         "candidate_targets": len(scene["targets"]), "evaluated_targets_per_observer": len(targets),
                         "terrain_samples": len(scene.get("terrain", {}).get("samples", [])),
                         "field_verified": False},
            "limitations": list(dict.fromkeys(warnings)),
            "attribution": "© OpenStreetMap contributors (ODbL); elevation when present: Open-Meteo / Copernicus GLO-90; solar equations: NOAA"}
