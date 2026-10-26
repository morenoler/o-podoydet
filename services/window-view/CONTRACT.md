# Internal module contract

Coordinates are WGS84 `{lat, lon}`; polygon coordinates are `[lat, lon]` pairs.
Bearings are degrees clockwise from true north. Lengths/elevations are metres.
Heights AGL are distinct from elevation above sea level. JSON never contains NaN.

`sources.normalize_osm(payload, origin, radius_m, source)` returns a Scene dict:

- `origin`: `{lat,lon}`; `radius_m`; `buildings`; `targets`; `sources`; `warnings`.
- Buildings: `id` (`osm:way:123`), `name`, `polygons` list of
  `{outer:[[lat,lon],...],holes:[ring,...]}`, `height_m` (nullable),
  `height_range_m` ([low,high] or null), `height_basis` (`osm_height`,
  `estimated_levels`, `unknown`), `min_height_m`, `ground_elevation_m` (nullable),
  `source_ids`, `tags`. Preserve complete rings; do not bridge unrelated members.
- Targets: `id`, `kind` (`sea`, `landmark`, `water`, `park`, `mountain`), `name`,
  `lat`, `lon`, `height_m` (nullable), `elevation_m` (absolute, nullable),
  `source_ids`. Sea targets are samples on the water side of directed coastlines,
  NOT beach points or hotel marketing labels. Limit and label sampling.
- Sources: `id`, `url`, `retrieved_at`, `source_updated_at` (nullable), `license`,
  `method`, plus source-specific metadata.
- Optional `terrain`: `{samples:[{lat,lon,elevation_m}],resolution_m,source_ids}`.

`geometry.assess_target(observer, target, buildings, terrain=None)` returns dict:
`status` (`clear_in_model`, `blocked`, `outside_fov`, `unknown`),
`visible_in_model` (bool or null), `distance_m`, `bearing_deg`,
`elevation_angle_deg` (nullable), `blockers` (id/reason), `uncertainties`.
Observer: `lat`, `lon`, `height_agl_m`, `ground_elevation_m` (nullable),
`bearing_deg`, `horizontal_fov_deg`, `vertical_fov_deg`, `pitch_deg`,
`exclude_building_ids` list. Unknown vertical reference must stay unknown;
known horizontal exclusion is still outside_fov. Terrain gaps remain explicit.
For a target lacking elevation, use terrain sample near target if available;
sea is absolute zero. Height estimates crossing a sightline produce unknown.
Finite targets are point samples (not an assertion about the entire object).
Building target helper may sample footprint facades and roof separately.
Export `project(lat,lon,origin_lat,origin_lon)`, `unproject(x,y,origin_lat,origin_lon)`,
`bearing(lat1,lon1,lat2,lon2)`, `point_in_polygon(point,polygon)` as needed.

`solar.solar_position(instant, lat, lon)` returns `{azimuth_deg,elevation_deg}`
using aware datetime UTC. `solar.solar_events(date_string,lat,lon,utc_offset_minutes)`
returns sunrise/sunset objects `{time_utc,azimuth_deg,elevation_deg}` or null,
`polar_state` and `method`. Civil date uses explicit fixed UTC offset, not guessed
timezone. Sunrise/sunset use the standard -0.833 degree centre threshold.
`geometry.assess_sun(observer,azimuth_deg,elevation_deg,buildings,terrain=None)`
uses directional ray occlusion; result shape parallels assess_target.

Sources module public client: `OpenDataClient(cache_dir, allow_network=False)`;
`fetch_scene(lat,lon,radius_m=1200)` returns normalized Scene. Endpoints are fixed
public Overpass/Open-Meteo URLs; caller cannot supply a fetch URL. Cache reads
verify hashes. Upstream partial/error payloads must not be treated as empty maps.
All collection must have explicit network permission in CLI/server config.
Elevation enrichment can be a separate root-owned module.
