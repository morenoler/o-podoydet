import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildGraph,
  shortestPath,
  closestPointOnLine,
  distance,
  type OsmElement,
} from "../shared/geo";
import type { Dataset, Point } from "../shared/types";

const points: Record<number, { lon: number; lat: number }> = {
  1: { lon: 39, lat: 43 },
  2: { lon: 39.001, lat: 43 },
  3: { lon: 39.002, lat: 43 },
  4: { lon: 39.001, lat: 43.001 },
  5: { lon: 39.001, lat: 43 },
  6: { lon: 39.002, lat: 43.001 },
};
const way = (
  id: number,
  nodes: number[],
  tags: Record<string, string> = {},
): OsmElement => ({
  type: "way",
  id,
  nodes,
  geometry: nodes.map((n) => points[n]),
  tags: { highway: "footway", ...tags },
});

test("shortest route chooses connected path and step-free alternative is longer", () => {
  const graph = buildGraph([
    way(10, [1, 2, 3], { highway: "steps" }),
    way(20, [1, 4, 3]),
  ]);
  const direct = shortestPath(graph, 1, new Set([3]))!;
  const alternative = shortestPath(graph, 1, new Set([3]), true)!;
  assert.deepEqual(direct.wayIds, [10]);
  assert.equal(direct.steps, 1);
  assert.deepEqual(alternative.wayIds, [20]);
  assert.equal(alternative.steps, 0);
  assert.ok(alternative.meters > direct.meters);
});

test("geometric coincidence does not create a connection without shared OSM node id", () => {
  const graph = buildGraph([way(10, [1, 2]), way(20, [5, 3])]);
  assert.equal(shortestPath(graph, 1, new Set([3])), null);
});

test("a locked barrier breaks the graph, explicit pedestrian permission overrides general private access", () => {
  const locked = buildGraph([
    way(10, [1, 2, 3]),
    { type: "node", id: 2, tags: { barrier: "gate", locked: "yes" } },
  ]);
  assert.equal(shortestPath(locked, 1, new Set([3])), null);
  const permitted = buildGraph([
    way(10, [1, 2, 3], { access: "private", foot: "yes" }),
  ]);
  assert.ok(shortestPath(permitted, 1, new Set([3])));
  const privatePath = buildGraph([way(10, [1, 2, 3], { access: "private" })]);
  assert.equal(shortestPath(privatePath, 1, new Set([3])), null);
});

test("pedestrian direction restrictions apply while car one-way does not restrict walkers", () => {
  const graph = buildGraph([way(10, [1, 2, 3], { "oneway:foot": "yes" })]);
  assert.ok(shortestPath(graph, 1, new Set([3])));
  assert.equal(shortestPath(graph, 3, new Set([1])), null);
  const road = buildGraph([
    way(10, [1, 2, 3], { highway: "residential", oneway: "yes" }),
  ]);
  assert.ok(shortestPath(road, 3, new Set([1])));
});

test("single steps on nodes are excluded from an alternative", () => {
  const graph = buildGraph([
    way(10, [1, 2, 3]),
    { type: "node", id: 2, tags: { barrier: "step" } },
  ]);
  assert.equal(shortestPath(graph, 1, new Set([3]))!.steps, 1);
  assert.equal(shortestPath(graph, 1, new Set([3]), true), null);
});

test("noise distance uses road segment, not its distant endpoints", () => {
  const point: [number, number] = [39.001, 43.0001];
  const closest = closestPointOnLine(point, [
    [39, 43],
    [39.002, 43],
  ])!;
  assert.ok(Math.abs(closest[0] - 39.001) < 1e-8);
  assert.ok(distance(point, closest) < 12);
});

test("saved real routes consist only of connected graph edges; alternatives contain no mapped steps", () => {
  const raw = JSON.parse(readFileSync("data/osm-snapshot.json", "utf8")) as {
    elements: OsmElement[];
  };
  const dataset = JSON.parse(readFileSync("data/demo.json", "utf8")) as Dataset;
  const graph = buildGraph(raw.elements);
  const pointKey = (p: Point) => p.join(",");
  const edgeKey = (a: Point, b: Point) => pointKey(a) + ">" + pointKey(b);
  const connected = new Set<string>(),
    stepFree = new Set<string>();
  for (const [from, edges] of graph.edges)
    for (const e of edges) {
      const key = edgeKey(graph.points.get(from)!, graph.points.get(e.to)!);
      connected.add(key);
      if (!e.steps) stepFree.add(key);
    }
  assert.equal(dataset.hotels.length, 24);
  for (const h of dataset.hotels) {
    assert.ok(h.osmUrl.startsWith("https://www.openstreetmap.org/"));
    assert.ok(h.route && h.route.meters > 0);
    const paths = [
      { ...h.route!, avoidSteps: false },
      ...(h.route!.noStepsAlternative
        ? [{ ...h.route!.noStepsAlternative, avoidSteps: true }]
        : []),
    ];
    for (const path of paths) {
      let measured = 0;
      for (let i = 1; i < path.coordinates.length; i++) {
        const a = path.coordinates[i - 1],
          b = path.coordinates[i];
        assert.ok(
          (path.avoidSteps ? stepFree : connected).has(edgeKey(a, b)),
          h.name + " contains a nonexistent edge",
        );
        measured += distance(a, b);
      }
      assert.ok(
        Math.abs(path.meters - measured) <= 0.51,
        h.name + " has an inconsistent route length",
      );
    }
  }
  assert.ok(
    dataset.facts.filter((f) => f.method === "geo").every((f) => !f.demo),
  );
  assert.ok(
    dataset.facts.filter((f) => f.method === "demo").every((f) => f.demo),
  );
});
