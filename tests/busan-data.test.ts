import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Dataset, Hotel } from "../shared/types";
import { sha256, validateOverpass, type OsmElement, type OverpassResponse, type SnapshotManifest } from "../scripts/fetch-busan";
import { buildNearbyPlaces, coordinates, haversineMeters, inactive, matchesSelector, prepareBusanDataset, loadBusanSnapshots, loadRegionalPlaces, duplicateHotelCandidates, samePlaceVersion, type CenterDefinition, type PlaceCategory, type RegionalExtractManifest } from "../scripts/prepare-busan";

const receivedAt = "2026-10-27T12:00:00.000Z";
const source = (elements: OsmElement[]): OverpassResponse => ({ osm3s: { timestamp_osm_base: "2026-10-27T10:00:00Z" }, elements: [...elements, { type: "count", tags: { nodes: `${elements.filter(e => e.type === "node").length}`, ways: `${elements.filter(e => e.type === "way").length}`, relations: `${elements.filter(e => e.type === "relation").length}`, total: `${elements.length}` } }] });
const hotel: Hotel = { id: "node-1", name: "Synthetic test hotel", address: "Test only", coordinates: [129, 35], osmUrl: "https://www.openstreetmap.org/node/1", rooms: [], route: null, noise: [] };
const categories: PlaceCategory[] = [
  { key: "cafe", label: "кафе", defaultMaxMeters: 500, osmQueries: ["[amenity=cafe]"], aliases: ["кафе"] },
  { key: "city_center", label: "центр", defaultMaxMeters: 1500, osmQueries: [], aliases: ["центр"] },
];
const center: CenterDefinition = { osmId: "node/8", coordinates: [129.001, 35.001], name: "Test anchor", definition: "Synthetic test fixture only", officialSource: { url: "https://example.org", title: "Test", obtainedAt: receivedAt, quote: "Test fixture" } };
const cafe: OsmElement = { type: "node", id: 2, lon: 129.0001, lat: 35, tags: { amenity: "cafe", name: "Test cafe" } };
const centerElement: OsmElement = { type: "node", id: 8, lon: 129.001, lat: 35.001, tags: { railway: "station", station: "subway" } };

test("Overpass rejects partial HTTP-success responses, truncated counters and duplicate IDs", () => {
  const valid = source([cafe]);
  assert.equal(validateOverpass(valid).elements.length, 2);
  assert.throws(() => validateOverpass({ ...valid, remark: "runtime error: Query timed out" }), /incomplete/);
  assert.throws(() => validateOverpass({ ...valid, elements: [cafe] }), /counter/);
  assert.throws(() => validateOverpass(source([cafe, cafe])), /duplicate/);
  const wrong = source([cafe]); wrong.elements.at(-1)!.tags!.total = "2";
  assert.throws(() => validateOverpass(wrong), /count mismatch/);
});

test("coordinate extraction never fabricates nodes or centers and Haversine handles zero/antipodes", () => {
  assert.equal(coordinates({ type: "way", id: 10 }), null);
  assert.equal(coordinates({ ...cafe, lat: 95 }), null);
  assert.deepEqual(coordinates({ type: "way", id: 10, center: { lat: 35, lon: 129 } }), [129, 35]);
  assert.equal(haversineMeters([129, 35], [129, 35]), 0);
  assert.ok(Math.abs(haversineMeters([0, 0], [1, 0]) - 111195.08) < 1);
  assert.ok(Number.isFinite(haversineMeters([0, 0], [180, 0])));
});

test("nearest place excludes explicit inactive/private tags and keeps provenance limits", () => {
  const closerPrivate = { ...cafe, id: 3, lon: 129, tags: { amenity: "cafe", access: "private" } };
  const closed = { ...cafe, id: 4, lon: 129, tags: { amenity: "cafe", disused: "yes" } };
  const result = buildNearbyPlaces(hotel, [cafe, closerPrivate, closed, centerElement], categories, receivedAt, center);
  assert.equal(result.length, 2);
  assert.equal(result[0].osmId, "node/2");
  assert.equal(result[0].sourceUrl, "https://www.openstreetmap.org/node/2");
  assert.equal(result[0].meters, Math.ceil(haversineMeters(hotel.coordinates!, coordinates(cafe)!)));
  assert.equal(result[0].method, "haversine-osm-v1");
  assert.equal(result[0].scope, "hotel_surroundings");
  assert.equal(result[0].sourceDate, undefined);
  assert.equal(result[0].expiresAt, "2026-11-26T12:00:00.000Z");
  assert.equal(result[1].name, center.name);
});

test("missing coordinates, private account listings and synthetic hotels produce no nearby claims", () => {
  for (const subject of [{ ...hotel, coordinates: null }, { ...hotel, synthetic: true }, { ...hotel, accountListingId: "private" }])
    assert.deepEqual(buildNearbyPlaces(subject, [cafe], categories, receivedAt, center), []);
  assert.equal(inactive({ ...cafe, tags: { abandoned: "yes" } }), true);
  assert.equal(matchesSelector({ railway: "station" }, "[railway=station][station!=subway][subway!=yes]"), true);
  assert.equal(matchesSelector({ railway: "station", station: "subway" }, "[railway=station][station!=subway]"), false);
  assert.throws(() => matchesSelector({}, "console.log(1)"), /Unsupported/);
});

test("duplicate business audit flags same-name near points without merging records", () => {
  const sample: Hotel[] = [hotel, { ...hotel, id: "way-2", name: "SYNTHETIC—TEST HOTEL", coordinates: [129.0001, 35] }, { ...hotel, id: "node-3", coordinates: [129.01, 35] }];
  const found = duplicateHotelCandidates(sample);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].ids, [hotel.id, "way-2"]);
  assert.equal(sample.length, 3);
  assert.equal(duplicateHotelCandidates(sample, 1).length, 0);
});

test("OSM bbox-center half-digit rounding is not a conflict; changed tags or geometry are", () => {
  const a: OsmElement = { type: "way", id: 10, center: { lon: 129.06441205, lat: 35.1554843 }, tags: { amenity: "cafe" } };
  const rounded = { ...a, center: { ...a.center!, lon: 129.064412 } };
  assert.equal(samePlaceVersion(a, rounded), true);
  assert.equal(samePlaceVersion(a, { ...rounded, tags: { amenity: "restaurant" } }), false);
  assert.equal(samePlaceVersion(a, { ...a, center: { ...a.center!, lon: 129.0644122 } }), false);
  assert.equal(samePlaceVersion(cafe, { ...cafe, lon: cafe.lon! + 0.00000001 }), false);
});

test("regional PBF derivative preserves per-object source date and rejects damaged files or invalid extent", async () => {
  const root = await mkdtemp(join(tmpdir(), "o-podoydet-busan-test-"));
  const bytes = Buffer.from(JSON.stringify({ elements: [{ ...cafe, timestamp: "2023-01-02T00:00:00Z" }] }));
  const path = join(root, "fixture.json");
  try {
    await writeFile(path, bytes);
    const manifest: RegionalExtractManifest = { source: { url: "https://example.org/test-only.pbf", receivedAt, sha256: "a".repeat(64), bytes: 100 }, extract: { path: "fixture.json", sha256: sha256(bytes), bytes: bytes.length, elementsCount: 1, bbox: [128, 34, 130, 36], method: "synthetic-fixture" } };
    const loaded = await loadRegionalPlaces(root, manifest);
    assert.equal(loaded.elements[0].timestamp, "2023-01-02T00:00:00Z");
    assert.equal(loaded.elements[0].obtainedAt, receivedAt);
    await assert.rejects(loadRegionalPlaces(root, { ...manifest, extract: { ...manifest.extract, sha256: "0".repeat(64) } }), /checksum/);
    await assert.rejects(loadRegionalPlaces(root, { ...manifest, extract: { ...manifest.extract, elementsCount: 2 } }), /count/);
    await assert.rejects(loadRegionalPlaces(root, { ...manifest, extract: { ...manifest.extract, bbox: [128, 34, 128.5, 35] } }), /out-of-extent/);
  } finally { await unlink(path); await rmdir(root); }
});

test("citywide merge preserves original facts, categories and dates, adding no fictitious rooms or routes", () => {
  const base: Dataset = { region: "Пусан", fetchedAt: "2025-01-01T00:00:00Z", sourceDate: "2024-01-01T00:00:00Z", attribution: "© OpenStreetMap contributors", bbox: [128, 34, 130, 36], hotels: [hotel], facts: [], map: [], evidencePolicy: "verified-only" };
  const boundary = source([{ type: "relation", id: 99, bounds: { minlat: 34, minlon: 128, maxlat: 36, maxlon: 130 } }]);
  const lodgings = source([{ type: "node", id: 1, lat: 35, lon: 129, tags: { tourism: "hotel" } }, { type: "node", id: 5, lat: 35.01, lon: 129.01, tags: { tourism: "hostel", name: "Test hostel" } }]);
  const fixtureEntry: SnapshotManifest["entries"][string] = {
    path: "test-only.json", query: "synthetic fixture", url: "https://example.org", method: "GET", receivedAt,
    httpStatus: 200, contentType: "application/json", sha256: "not-a-real-response", bytes: 0, count: 0,
    validation: "http-json-no-remark-count-checked",
  };
  const manifest: SnapshotManifest = { schemaVersion: 1, endpoint: "https://example.org", license: "ODbL-1.0", attribution: "Synthetic test fixtures", boundaryRelationId: 99, entries: { lodgings: fixtureEntry, places: fixtureEntry } };
  const output = prepareBusanDataset(base, lodgings, source([cafe, centerElement]), boundary, manifest, categories, center);
  assert.equal(output.hotels.length, 2);
  assert.deepEqual(output.bbox, [128, 34, 130, 36]);
  assert.deepEqual(output.hotels[0].rooms, hotel.rooms);
  assert.deepEqual(output.hotels[0].route, hotel.route);
  assert.deepEqual(output.facts, base.facts);
  assert.equal(output.fetchedAt, base.fetchedAt);
  assert.equal(output.sourceDate, base.sourceDate);
  assert.deepEqual(output.hotels[1].rooms, []);
  assert.equal(output.hotels[1].route, null);
  assert.equal(output.hotels[1].sourceEvidence?.sourceDate, undefined);
  assert.equal(output.coverage.counts.fieldVerifiedHotels, 0);
  assert.equal(output.coverage.counts.overlapByOsmId, 1);
  assert.throws(() => prepareBusanDataset(base, lodgings, source([cafe]), boundary, manifest, categories, center), /Center anchor/);
});

test("saved citywide corpus has verified response bytes, unique IDs and preserves all original evidence", async () => {
  const manifest: SnapshotManifest = JSON.parse(readFileSync("data/busan/manifest.json", "utf8"));
  const snapshots = await loadBusanSnapshots("data/busan", manifest);
  for (const key of Object.keys(manifest.entries)) {
    const entry = manifest.entries[key];
    const bytes = readFileSync(`data/busan/${entry.path}`);
    assert.equal(sha256(bytes), entry.sha256);
    assert.equal(bytes.byteLength, entry.bytes);
    assert.equal(validateOverpass(JSON.parse(bytes.toString("utf8"))).elements.length - 1, entry.count);
  }
  const base: Dataset = JSON.parse(readFileSync("data/verified-hotels.json", "utf8"));
  const saved = JSON.parse(readFileSync("data/busan/verified-hotels.json", "utf8"));
  const cats = JSON.parse(readFileSync("data/busan/place-categories.json", "utf8"));
  const anchor = JSON.parse(readFileSync("data/busan/city-center.json", "utf8"));
  const regional = manifest.regionalPlacesManifest ? JSON.parse(readFileSync(`data/busan/${manifest.regionalPlacesManifest}`, "utf8")) : undefined;
  const rebuilt = prepareBusanDataset(base, snapshots.lodgings, snapshots.places, snapshots.boundary, manifest, cats, anchor, regional);
  assert.deepEqual(rebuilt, saved);
  assert.ok(saved.hotels.length > base.hotels.length);
  assert.equal(new Set(saved.hotels.map((h: Hotel) => h.id)).size, saved.hotels.length);
  for (const h of saved.hotels as Hotel[]) {
    if (!h.coordinates) continue;
    const [lon, lat] = h.coordinates;
    assert.ok(lon >= saved.bbox[0] && lon <= saved.bbox[2] && lat >= saved.bbox[1] && lat <= saved.bbox[3], `Map bbox must contain ${h.id}`);
  }
  assert.deepEqual(saved.facts, base.facts);
  for (const old of base.hotels) {
    const current = saved.hotels.find((h: Hotel) => h.id === old.id);
    for (const key of Object.keys(old) as (keyof Hotel)[]) assert.deepEqual(current[key], old[key], `${old.id}: ${key}`);
  }
  for (const added of saved.hotels.filter((h: Hotel) => !base.hotels.some(b => b.id === h.id))) {
    assert.deepEqual(added.rooms, []);
    assert.equal(added.route, null);
    assert.equal(added.pricePerNight, undefined);
  }
});
