import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { sha256, validateOverpass, type OsmElement, type OverpassResponse, type SnapshotManifest } from "../scripts/fetch-busan";
import { SOCHI_BOUNDARY, boundaryQuery, lodgingQuery, placesQuery } from "../scripts/fetch-sochi";
import { loadSochiSnapshot, loadPreservedSochi, preservedSochiDataset, nearbyForSochi, prepareSochiDataset } from "../scripts/prepare-sochi";
import type { PlaceCategory } from "../scripts/prepare-busan";

const obtainedAt = "2026-10-27T12:00:00.000Z";
const source = (elements: OsmElement[]): OverpassResponse => ({ osm3s: { timestamp_osm_base: obtainedAt }, elements: [...elements,
  { type: "count", tags: Object.fromEntries(["node", "way", "relation"].map(type => [`${type}s`, `${elements.filter(e => e.type === type).length}`]).concat([["total", `${elements.length}`]])) }] });
const boundary = source([{ type: "relation", id: SOCHI_BOUNDARY, tags: { name: "городской округ Сочи", admin_level: "6" }, bounds: { minlon: 39, maxlon: 41, minlat: 43, maxlat: 44.5 } }]);
const manifest = { boundaryRelationId: SOCHI_BOUNDARY, entries: { lodgings: { receivedAt: obtainedAt, osmBaseDate: obtainedAt }, places: { receivedAt: obtainedAt } } } as unknown as SnapshotManifest;
const hotel: OsmElement = { type: "node", id: 101, lon: 39.73, lat: 43.58, tags: { tourism: "hotel", name: "Synthetic hotel", "name:ru": "Тестовая гостиница", "addr:street": "Тестовая", "addr:housenumber": "1" } };
const categories: PlaceCategory[] = [{ key: "cafe", label: "кафе", defaultMaxMeters: 500, osmQueries: ["[amenity=cafe]"], aliases: [] }];

test("small synthetic selection preserves unknown rooms and source dates; excludes unresolved identities and lifecycle records", () => {
  const result = prepareSochiDataset(boundary, source([hotel,
    { ...hotel, id: 102, tags: { tourism: "hotel" } },
    { ...hotel, id: 103, tags: { tourism: "hotel", name: "Отель" } },
    { ...hotel, id: 104, tags: { ...hotel.tags, disused: "yes" } },
    { ...hotel, id: 105, lon: 999 },
  ]), undefined, manifest, categories);
  assert.equal(result.hotels.length, 1);
  assert.equal(result.coverage.counts.excludedRecords, 4);
  const h = result.hotels[0];
  assert.equal(h.name, "Тестовая гостиница");
  assert.deepEqual(h.rooms, []);
  assert.equal(h.route, null);
  assert.equal(h.pricePerNight, undefined);
  assert.equal(h.sourceEvidence?.sourceDate, undefined);
  assert.equal(h.sourceEvidence?.status, "reported");
  assert.equal(h.sourceEvidence?.expiresAt, "2026-11-26T12:00:00.000Z");
  assert.deepEqual(result.facts, []);
});

test("nearby calculation excludes private and closed places, rounds up, and never claims a walking route", () => {
  const h = prepareSochiDataset(boundary, source([hotel]), undefined, manifest, []).hotels[0];
  const cafe: OsmElement = { type: "node", id: 201, lon: 39.731, lat: 43.58, tags: { amenity: "cafe", name: "Тестовое кафе" } };
  const nearest = nearbyForSochi(h, [cafe, { ...cafe, id: 202, lon: 39.7301, tags: { ...cafe.tags, access: "private" } },
    { ...cafe, id: 203, lon: 39.7302, tags: { ...cafe.tags, opening_hours: "closed" } }], categories, obtainedAt);
  assert.equal(nearest.length, 1);
  assert.equal(nearest[0].osmId, "node/201");
  assert.equal(nearest[0].meters, 81);
  assert.equal(nearest[0].scope, "hotel_surroundings");
  assert.equal(nearest[0].method, "haversine-osm-v1");
  assert.equal(h.route, null);
});

test("saved Sochi corpus reproduces exactly with checked source bytes and no invented categories", async () => {
  const root = "data/sochi", m: SnapshotManifest = JSON.parse(readFileSync(`${root}/manifest.json`, "utf8"));
  await loadSochiSnapshot(root, m, "boundary", boundaryQuery);
  const { lodgings, places } = await loadPreservedSochi(root);
  assert.deepEqual(await preservedSochiDataset("pilot"), JSON.parse(readFileSync(`${root}/pilot.json`, "utf8")));
  const rebuilt = await preservedSochiDataset();
  assert.deepEqual(rebuilt, JSON.parse(readFileSync(`${root}/verified-hotels.json`, "utf8")));
  assert.ok(rebuilt.hotels.length >= 50);
  assert.ok(!rebuilt.hotels.some(h => h.id === "relation-9273776"), "Unresolved current hotel identity must not be admitted");
  assert.equal(rebuilt.coverage.counts.sourceLodgingRecords, rebuilt.coverage.counts.catalogRecords + rebuilt.coverage.counts.excludedRecords);
  for (const conflict of rebuilt.selection.excludedIdentityConflicts) {
    assert.ok(conflict.sourcePaths.every(path => existsSync(`${root}/${path}`)), "Identity decisions must link to saved sources");
  }
  assert.equal(new Set(rebuilt.hotels.map(h => h.id)).size, rebuilt.hotels.length);
  const rawById = new Map(lodgings.elements.map(e => [`${e.type}-${e.id}`, e]));
  for (const h of rebuilt.hotels) {
    assert.ok(rawById.has(h.id));
    assert.equal(h.osmUrl, `https://www.openstreetmap.org/${h.id.replace("-", "/")}`);
    assert.deepEqual(h.rooms, []);
    assert.equal(h.route, null);
    assert.equal(h.pricePerNight, undefined);
    assert.equal(h.synthetic, undefined);
    assert.ok(h.sourceEvidence?.obtainedAt);
    assert.equal(h.sourceEvidence?.sourceDate, rawById.get(h.id)?.timestamp);
    assert.ok(h.nearbyPlaces?.every(p => p.sourceDate === places.elements.find(e => `${e.type}/${e.id}` === p.osmId)?.timestamp));
  }
  for (const entry of Object.values(m.entries)) {
    const bytes = readFileSync(`${root}/${entry.path}`);
    assert.equal(sha256(bytes), entry.sha256);
    assert.equal(validateOverpass(JSON.parse(bytes.toString())).elements.length - 1, entry.count);
  }
});

test("official identity sample hashes excerpts only and never turns a website report into field verification", () => {
  const review = JSON.parse(readFileSync("data/sochi/official-review.json", "utf8"));
  assert.equal(review.recordCount, review.hotels.length);
  assert.equal(review.quality.fieldCheckCount, 0);
  for (const s of review.sources) {
    assert.equal(sha256(s.excerpt), s.excerptSha256);
    assert.equal(s.fullResponseCached, false);
    assert.equal(s.sourceDate, null);
  }
  for (const h of review.hotels) {
    assert.equal(h.status, "reported");
    assert.equal(h.scope, "hotel_identity");
    assert.equal(h.sourceDate, null);
    assert.ok(review.sources.some((s: { id: string }) => s.id === h.sourceId));
  }
});

test("identity review is tied to saved sources and keeps unmatched records and conflicts explicit", () => {
  const root = "data/sochi";
  const review = JSON.parse(readFileSync(`${root}/identity-review.json`, "utf8"));
  const official = JSON.parse(readFileSync(`${root}/official-review.json`, "utf8"));
  const catalog = JSON.parse(readFileSync(`${root}/verified-hotels.json`, "utf8"));
  const raw = JSON.parse(readFileSync(`${root}/${review.inputs.osm.path}`, "utf8"));
  assert.equal(sha256(readFileSync(`${root}/${review.inputs.official.path}`)), review.inputs.official.sha256);
  assert.equal(sha256(readFileSync(`${root}/${review.inputs.osm.path}`)), review.inputs.osm.sha256);
  const ids = new Set<string>(catalog.hotels.map((h: { id: string }) => h.id));
  assert.equal(sha256([...ids].sort().join("\n") + "\n"), review.inputs.osm.catalogIdSetSha256);
  assert.equal(review.coverage.activeCatalogRecordDenominator, ids.size);
  assert.equal(review.coverage.officialDenominator, official.hotels.length);
  const statusCounts: Record<string, number> = {};
  const compared = new Set<string>();
  for (const record of review.records) {
    statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1;
    const source = official.hotels.find((h: { id: string }) => h.id === record.officialHotelId);
    assert.ok(source, "Every comparison must reference a saved official record");
    assert.equal(record.officialSource.status, "reported");
    assert.equal(record.officialSource.url, source.officialUrl);
    for (const comparison of record.comparisons) {
      const osm = raw.elements.find((e: { type: string; id: number }) => `${e.type}-${e.id}` === comparison.osmId);
      assert.ok(osm, "Every OSM comparison must exist in the saved snapshot");
      assert.equal(comparison.osmSource.sourceDate, osm.timestamp);
      assert.equal(comparison.activeCatalogRecord, ids.has(comparison.osmId));
      assert.equal(comparison.identityAsserted, comparison.status === "matched");
      assert.equal(comparison.fieldCheck, "not_performed");
      for (const [tag, value] of Object.entries(comparison.osmSource.tags)) assert.equal(osm.tags[tag], value);
      compared.add(comparison.osmId);
    }
  }
  assert.deepEqual(statusCounts, review.coverage.officialStatusCounts);
  assert.equal(compared.size, review.coverage.comparedNamedRawRecordCount);
  assert.deepEqual([...ids].filter(id => !compared.has(id)).sort(), review.activeCatalogRecordIdsWithoutOfficialComparison.slice().sort());
  assert.equal(review.coverage.fieldCheckCount, 0);
  assert.equal(review.coverage.uniqueBusinessCount, null);
});
