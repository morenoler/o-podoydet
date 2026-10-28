import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildPlaces, categoriesFor, coordinatesFor, placeFor } from "../scripts/places/build";
import type { OsmElement } from "../shared/geo";

test("place categories do not mistake a convenience store, surface rail or private venue for a requested facility", () => {
  assert.deepEqual(categoriesFor({ shop: "convenience" }), ["convenience"]);
  assert.deepEqual(categoriesFor({ shop: "supermarket" }), ["supermarket"]);
  assert.deepEqual(categoriesFor({ railway: "station" }), []);
  assert.deepEqual(categoriesFor({ railway: "station", station: "subway" }), ["subway"]);
  assert.deepEqual(categoriesFor({ amenity: "cafe", access: "private", name: "Private cafe" }), []);
  assert.deepEqual(categoriesFor({ amenity: "cafe", disused: "yes" }), []);
});

test("way point uses complete geometry and never fills missing vertices", () => {
  const nodes = new Map<number, OsmElement>([
    [1, { type: "node", id: 1, lon: 129.15, lat: 35.16 }],
    [2, { type: "node", id: 2, lon: 129.16, lat: 35.16 }],
    [3, { type: "node", id: 3, lon: 129.16, lat: 35.17 }],
  ]);
  const way: OsmElement = { type: "way", id: 99, nodes: [1, 2, 3, 1], tags: { leisure: "park", name: "Synthetic park" } };
  const point = coordinatesFor(way, nodes)!;
  assert(Math.abs(point[0] - (129.15 + 129.16 + 129.16) / 3) < 1e-9);
  const place = placeFor(way, nodes, "test-fixture")!;
  assert.equal(place.coordinateMethod, "osm_way_vertex_mean");
  assert.match(place.assumptions![0], /не вход/);
  nodes.delete(2);
  assert.equal(coordinatesFor(way, nodes), null);
  assert.equal(placeFor(way, nodes, "test-fixture"), null);
});

test("outside-bounds and unresolved relations do not become place coordinates", () => {
  assert.equal(placeFor({ type: "node", id: 1, lon: 0, lat: 0, tags: { amenity: "cafe" } }, new Map(), "synthetic"), null);
  assert.equal(coordinatesFor({ type: "relation", id: 1, tags: { leisure: "park" } }, new Map()), null);
});

test("offline public dataset is reproducible and every place links to hashed evidence", () => {
  const dataset = buildPlaces();
  assert.deepEqual(dataset, JSON.parse(readFileSync("data/places/busan-places.json", "utf8")));
  assert(dataset.places.length > 100);
  assert.equal(dataset.coverage.complete, false);
  assert.equal(dataset.sourceDate, null);
  const sources = new Set(dataset.sources.map((source) => source.id));
  assert.equal(new Set(dataset.places.map((place) => place.id)).size, dataset.places.length);
  for (const place of dataset.places) {
    assert(sources.has(place.sourceId));
    assert(place.coordinates.every(Number.isFinite));
    assert.match(place.sourceUrl, /^https:\/\/www\.openstreetmap\.org\/(node|way)\/\d+$/);
  }
  for (const source of dataset.sources) {
    const cached = readFileSync(source.cachePath);
    const bytes = source.evidenceKind === "cached_osm_response" ? cached : JSON.parse(cached.toString("utf8")).body;
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
    assert.equal(source.sourceDate, null);
  }
  for (const scope of ["city", "district"]) {
    const anchor = dataset.places.find((place) => place.centerScope === scope)!;
    assert(anchor);
    assert(anchor.assumptions?.length);
    assert.equal(anchor.categories.length, 0);
  }
});
