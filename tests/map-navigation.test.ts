import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Dataset, Hotel, Point } from "../shared/types";
import { groupMapHotels, hotelCountLabel, isMapPoint, latLng, MAP_MARKER_GAP, MAP_MARKER_SIZE, resultMapPoints, selectedMapPoints, validPath, visibleMapHotels } from "../src/features/map/mapData";
import { tileLoadMonitor } from "../src/features/map/tileLoadMonitor";

function hotel(id: string, longitude = 129.16): Hotel {
  return { id, name: id, address: "Busan", coordinates: [longitude, 35.16], osmUrl: "", rooms: [], route: null, noise: [] };
}
const dataset = { hotels: Array.from({ length: 96 }, (_, index) => hotel(String(index), 129.12 + index / 10000)) } as Dataset;

test("map includes all 96 results without turning unknown or synthetic coordinates into real markers", () => {
  const points = visibleMapHotels(dataset);
  assert.equal(points.length, 96);
  assert.deepEqual(latLng(points[0].coordinates!), [35.16, 129.12]);
  const bad = [{ ...hotel("missing"), coordinates: null }, { ...hotel("demo"), synthetic: true },
    { ...hotel("invalid"), coordinates: [Infinity, 35] as [number, number] }];
  assert.deepEqual(visibleMapHotels(dataset, undefined, [...points, ...bad]), points);
  assert.deepEqual(visibleMapHotels(dataset, undefined, []), []);
  assert.equal(isMapPoint([35, 129]), false);
});

test("initial focus uses actual visible result coordinates while retaining the entire map catalogue", () => {
  const original = structuredClone(dataset);
  const points = resultMapPoints(dataset, dataset.hotels, [hotel("not-in-results"),
    { ...dataset.hotels[5], coordinates: [0, 0] }, dataset.hotels[5], dataset.hotels[8]]);
  assert.deepEqual(points, [dataset.hotels[5].coordinates, dataset.hotels[8].coordinates]);
  assert.equal(visibleMapHotels(dataset).length, 96);
  assert.deepEqual(dataset, original);
  assert.deepEqual(resultMapPoints(dataset, dataset.hotels, []), dataset.hotels.map((item) => item.coordinates));
});

test("large regional catalogues open at city scale without applying a geographic filter", () => {
  for (const region of ["Пусан", "Сочи"] as const) {
    const center: Point = region === "Сочи" ? [39.72, 43.58] : [129.0756, 35.1796];
    const regional = { ...dataset, region, hotels: dataset.hotels.map((hotel) => ({ ...hotel,
      coordinates: [center[0] + Number(hotel.id) / 100_000, center[1]] as Point })) };
    const bounds = resultMapPoints(regional, regional.hotels);
    assert.equal(bounds.length, 2);
    assert.ok(bounds[1][0] - bounds[0][0] < 0.08);
    assert.ok(bounds[1][1] - bounds[0][1] < 0.06);
    assert.equal(visibleMapHotels(regional).length, 96);
    assert.ok(region === "Сочи" ? bounds[0][0] > 39 && bounds[1][0] < 40 : bounds[0][0] > 129);
  }
});

test("a beach-only catalogue opens at its real results instead of the empty administrative centre", () => {
  const saved = JSON.parse(readFileSync(new URL("../data/verified-hotels.json", import.meta.url), "utf8")) as Dataset;
  const points = resultMapPoints(saved, visibleMapHotels(saved));
  assert.deepEqual(points, visibleMapHotels(saved).map((hotel) => hotel.coordinates));
});

test("hotel count labels use Russian number forms", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 11, 12, 14, 21, 22, 101, 112].map(hotelCountLabel),
    ["1 отель", "2 отеля", "3 отеля", "4 отеля", "5 отелей", "11 отелей", "12 отелей", "14 отелей", "21 отель", "22 отеля", "101 отель", "112 отелей"]);
});

test("coincident hotels remain separately selectable without shifting their physical coordinates", () => {
  const a = hotel("a"), b = hotel("b"), close = hotel("close", 129.16000001);
  const groups = groupMapHotels([a, b, close]);
  assert.deepEqual(groups.map((group) => group.map((item) => item.id)), [["a", "b"], ["close"]]);
  assert.deepEqual(a.coordinates, [129.16, 35.16]);
  assert.deepEqual(b.coordinates, [129.16, 35.16]);
});

function mercator(zoom: number) {
  return ([longitude, latitude]: Point): Point => {
    const scale = 256 * 2 ** zoom;
    const sin = Math.sin(latitude * Math.PI / 180);
    return [scale * (longitude + 180) / 360,
      scale * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI))];
  };
}

function assertDisjointTouchBoxes(groups: Hotel[][], project: (point: Point) => Point) {
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      const left = project(groups[a][0].coordinates!);
      const right = project(groups[b][0].coordinates!);
      assert.ok(Math.max(Math.abs(left[0] - right[0]), Math.abs(left[1] - right[1])) >= MAP_MARKER_SIZE + MAP_MARKER_GAP,
        `Touch boxes overlap: ${groups[a][0].id} and ${groups[b][0].id}`);
    }
  }
}

test("nearby distinct coordinates share a named choice at overview zoom and separate safely when zoomed in", () => {
  const nearby = [hotel("금호장", 129.16), hotel("Popcorn Hostel", 129.1604), hotel("other", 129.164)];
  const before = structuredClone(nearby);
  const overview = groupMapHotels(nearby, mercator(14));
  assert.deepEqual(overview.map((group) => group.map((item) => item.id)), [["금호장", "Popcorn Hostel", "other"]]);
  const detail = groupMapHotels(nearby, mercator(19));
  assert.equal(detail.length, 3);
  for (const zoom of [12, 13, 14, 15, 16, 17, 18, 19]) {
    const groups = groupMapHotels(nearby, mercator(zoom));
    assertDisjointTouchBoxes(groups, mercator(zoom));
    assert.deepEqual(groups.flat().map((item) => item.id).sort(), nearby.map((item) => item.id).sort());
  }
  assert.deepEqual(nearby, before, "grouping must never alter real coordinates");
});

test("chained nearby points cannot pull group anchors together or leave overlapping touch boxes", () => {
  const positions: Point[] = [[0, 0], [40, 0], [80, 0], [119, 40], [0, 47], [48, 48], [95, 95]];
  const values = positions.map((_, index) => hotel(String(index), 129 + index / 1000));
  const project = (coordinates: Point) => positions[values.findIndex((item) => item.coordinates![0] === coordinates[0])];
  const groups = groupMapHotels(values, project);
  assertDisjointTouchBoxes(groups, project);
  assert.equal(new Set(groups.flat().map((item) => item.id)).size, values.length);
  assert.equal(groups.flat().length, values.length);
});

test("all saved Busan hotels retain unique accessible choices and disjoint hitboxes at every supported zoom", () => {
  const saved = JSON.parse(readFileSync(new URL("../data/verified-hotels.json", import.meta.url), "utf8")) as Dataset;
  const all = visibleMapHotels(saved);
  assert.equal(all.length, 96);
  const expected = all.map((item) => item.id).sort();
  for (let zoom = 8; zoom <= 19; zoom++) {
    const raw = mercator(zoom);
    // Leaflet rounds projected pixels; panning translates all anchors equally.
    const project = (point: Point): Point => raw(point).map(Math.round) as Point;
    for (const order of [all, [...all].reverse()]) {
      const groups = groupMapHotels(order, project);
      assertDisjointTouchBoxes(groups, project);
      assert.deepEqual(groups.flat().map((item) => item.id).sort(), expected);
    }
  }
});

test("selected bounds include curved route extrema and the alternative, not only endpoints", () => {
  const value = hotel("route");
  value.route = { meters: 500, coordinates: [[129.16, 35.16], [129.2, 35.2], [129.17, 35.15]], wayIds: [], steps: 1,
    beachName: "Haeundae", beachId: 1, connectionMeters: 20, approximate: true,
    noStepsAlternative: { meters: 700, coordinates: [[129.16, 35.16], [129.1, 35.12], [129.17, 35.15]] } };
  assert.ok(selectedMapPoints(value).some(([lng, lat]) => lng === 129.2 && lat === 35.2));
  assert.ok(selectedMapPoints(value).some(([lng, lat]) => lng === 129.1 && lat === 35.12));
  assert.deepEqual(selectedMapPoints({ ...value, synthetic: true }), []);
  assert.deepEqual(validPath([[129.16, 35.16], [NaN, 35.2], [129.17, 35.15]]), []);
});

test("a tile error falls back once and cannot fire again after disposal", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const failures: string[] = [];
  const monitor = tileLoadMonitor((message) => failures.push(message), 100);
  monitor.loading(); monitor.error(); monitor.error();
  t.mock.timers.tick(101);
  assert.equal(failures.length, 1);
  monitor.dispose(); monitor.loading(); monitor.error();
  t.mock.timers.tick(101);
  assert.equal(failures.length, 1);
});

test("completed and disposed tile loads cancel timeouts; a new stalled viewport still falls back", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const failures: string[] = [];
  const monitor = tileLoadMonitor((message) => failures.push(message), 100);
  monitor.loading(); monitor.loaded(); t.mock.timers.tick(101);
  assert.equal(failures.length, 0);
  monitor.loading(); t.mock.timers.tick(101);
  assert.equal(failures.length, 1);
  const disposed = tileLoadMonitor((message) => failures.push(message), 100);
  disposed.loading(); disposed.dispose(); t.mock.timers.tick(101);
  assert.equal(failures.length, 1);
});

test("one failed tile keeps a partially loaded map visible and reports the missing area", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const failures: string[] = [], partial: boolean[] = [];
  const monitor = tileLoadMonitor((message) => failures.push(message), 100, value => partial.push(value));
  monitor.loading(); monitor.tileError(); monitor.tileLoaded(); monitor.loaded();
  t.mock.timers.tick(101);
  assert.deepEqual(failures, []);
  assert.deepEqual(partial, [true]);
  monitor.loading(); monitor.tileLoaded(); monitor.loaded();
  assert.deepEqual(partial, [true, false], "a healthy viewport clears the partial warning");
  monitor.dispose(); monitor.tileError(); monitor.loaded();
  assert.deepEqual(partial, [true, false]);
});

test("all-error tile batches fall back once, while a partially stalled batch remains usable", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const failures: string[] = [], partial: boolean[] = [];
  const failed = tileLoadMonitor(message => failures.push(message), 100);
  failed.loading(); failed.tileError(); failed.tileError(); failed.loaded(); failed.loaded();
  t.mock.timers.tick(101);
  assert.equal(failures.length, 1);
  const stalled = tileLoadMonitor(message => failures.push(message), 100, value => partial.push(value));
  stalled.loading(); stalled.tileLoaded(); t.mock.timers.tick(101);
  assert.equal(failures.length, 1);
  assert.deepEqual(partial, [true]);
  stalled.loaded();
  assert.deepEqual(partial, [true, false]);
  stalled.dispose();
});
