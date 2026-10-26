"""Geometric solar positions using the NOAA/Meeus equations.

Primary formulas: https://gml.noaa.gov/grad/solcalc/main.js
This deliberately has no refraction/weather/terrain correction. Sunrise/set
are *standard* centre -0.833 degree events, not proof that the disk is visible.
The model is approximate; a 0.1 degree angular tolerance is used against
the independent SPA reference in tests, not a certified accuracy bound.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
import math

METHOD = "noaa_meeus_v1"
SOURCE_URL = "https://gml.noaa.gov/grad/solcalc/main.js"


def _coordinates(lat, lon):
    for value, limit, name in ((lat, 90, "latitude"), (lon, 180, "longitude")):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > limit:
            raise ValueError(f"invalid {name}")


def solar_position(instant: datetime, lat: float, lon: float) -> dict:
    """Return true-north azimuth and geometric centre elevation, in degrees."""
    _coordinates(lat, lon)
    if not isinstance(instant, datetime) or instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("instant must be a timezone-aware datetime")
    instant = instant.astimezone(timezone.utc)
    hour = instant.hour + instant.minute / 60 + (instant.second + instant.microsecond / 1e6) / 3600
    # Julian century from the Unix epoch, avoiding calendar approximations.
    century = (instant.timestamp() / 86400 + 2440587.5 - 2451545.0) / 36525
    mean_long = (280.46646 + century * (36000.76983 + century * 0.0003032)) % 360
    anomaly = math.radians(357.52911 + century * (35999.05029 - 0.0001537 * century))
    eccentricity = 0.016708634 - century * (0.000042037 + 0.0000001267 * century)
    centre = (math.sin(anomaly) * (1.914602 - century * (0.004817 + 0.000014 * century))
              + math.sin(2 * anomaly) * (0.019993 - 0.000101 * century) + math.sin(3 * anomaly) * 0.000289)
    omega = math.radians(125.04 - 1934.136 * century)
    apparent_long = math.radians(mean_long + centre - 0.00569 - 0.00478 * math.sin(omega))
    seconds = 21.448 - century * (46.8150 + century * (0.00059 - century * 0.001813))
    obliquity = math.radians(23 + (26 + seconds / 60) / 60 + 0.00256 * math.cos(omega))
    decl = math.asin(math.sin(obliquity) * math.sin(apparent_long))
    y = math.tan(obliquity / 2) ** 2
    longitude = math.radians(mean_long)
    eqtime = 4 * math.degrees(y * math.sin(2 * longitude) - 2 * eccentricity * math.sin(anomaly)
                             + 4 * eccentricity * y * math.sin(anomaly) * math.cos(2 * longitude)
                             - 0.5 * y * y * math.sin(4 * longitude)
                             - 1.25 * eccentricity * eccentricity * math.sin(2 * anomaly))
    hour_angle = math.radians(((hour * 60 + eqtime + 4 * lon) % 1440) / 4 - 180)
    latitude = math.radians(lat)
    sinelev = math.sin(latitude) * math.sin(decl) + math.cos(latitude) * math.cos(decl) * math.cos(hour_angle)
    elevation = math.degrees(math.asin(max(-1.0, min(1.0, sinelev))))
    azimuth = (math.degrees(math.atan2(math.sin(hour_angle),
                                     math.cos(hour_angle) * math.sin(latitude) - math.tan(decl) * math.cos(latitude))) + 180) % 360
    return {"azimuth_deg": azimuth, "elevation_deg": elevation}


def solar_events(date_string: str, lat: float, lon: float, utc_offset_minutes: int) -> dict:
    """Find events inside one local civil date with an explicit fixed UTC offset.

    A two-minute bounded scan is refined by bisection to <1 second. This is
    numerical precision only: atmospheric and approximate ephemeris errors
    are larger. Daily extrema are refined to capture narrow polar daylight intervals.
    Exact tangencies are reported as unresolved rather than polar night.
    """
    _coordinates(lat, lon)
    if isinstance(utc_offset_minutes, bool) or not isinstance(utc_offset_minutes, int) or abs(utc_offset_minutes) > 840:
        raise ValueError("utc_offset_minutes must be an integer from -840 to 840")
    local_date = date.fromisoformat(date_string)
    start = datetime.combine(local_date, time(), timezone(timedelta(minutes=utc_offset_minutes))).astimezone(timezone.utc)
    # Two-minute scan; solar extrema are refined below to handle grazing events.
    step = timedelta(minutes=2)
    times = [start + i * step for i in range(721)]
    def altitude(t):
        return solar_position(t, lat, lon)["elevation_deg"] + 0.833
    values = [altitude(t) for t in times]
    # Insert precise daily extrema so narrow polar-day/night crossings cannot
    # disappear between samples. A bounded ternary refinement suffices for a
    # smooth solar day between neighbouring coarse samples.
    extra = []
    for i in range(1, len(times) - 1):
        if (values[i] > values[i - 1] and values[i] > values[i + 1]) or (values[i] < values[i - 1] and values[i] < values[i + 1]):
            maximize = values[i] > values[i - 1]
            lo, hi = times[i - 1], times[i + 1]
            for _ in range(30):
                a, b = lo + (hi - lo) / 3, hi - (hi - lo) / 3
                if (altitude(a) < altitude(b)) == maximize:
                    lo = a
                else:
                    hi = b
            extra.append(lo + (hi - lo) / 2)
    times = sorted(times + extra)
    values = [altitude(t) for t in times]
    rises, sets = [], []
    for left, right, va, vb in zip(times, times[1:], values, values[1:]):
        if (va < 0 <= vb) or (va > 0 >= vb):
            rising = va < vb
            for _ in range(30):
                mid = left + (right - left) / 2
                if (altitude(mid) < 0) == rising:
                    left = mid
                else:
                    right = mid
            event_time = left + (right - left) / 2
            if event_time >= start + timedelta(days=1):
                continue
            position = solar_position(event_time, lat, lon)
            event = {"time_utc": event_time.isoformat(timespec="seconds").replace("+00:00", "Z"), **position}
            (rises if rising else sets).append(event)
    minimum, maximum = min(values), max(values)
    polar = "normal"
    if not rises and not sets:
        polar = "polar_day" if minimum > 1e-5 else "polar_night" if maximum < -1e-5 else "grazing_unresolved"
    elif not rises or not sets:
        polar = "transition"
    return {"sunrise": rises[0] if rises else None, "sunset": sets[0] if sets else None,
            "polar_state": polar, "method": METHOD, "source_url": SOURCE_URL,
            "date": local_date.isoformat(), "utc_offset_minutes": utc_offset_minutes,
            "threshold_deg": -0.833, "limitations": ["approximate_ephemeris", "standard_refraction_assumption", "terrain_and_clouds_not_in_event_time"]}
