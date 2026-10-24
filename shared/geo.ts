import type { Point } from "./types";
export interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}
export interface Edge {
  to: number;
  length: number;
  wayId: number;
  steps: boolean;
}
export interface Graph {
  points: Map<number, Point>;
  edges: Map<number, Edge[]>;
}
export function distance(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad,
    dLon = (b[0] - a[0]) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
export function pointOf(e: OsmElement): Point | null {
  if (e.lon !== undefined && e.lat !== undefined) return [e.lon, e.lat];
  if (!e.geometry?.length) return null;
  return [
    e.geometry.reduce((s, p) => s + p.lon, 0) / e.geometry.length,
    e.geometry.reduce((s, p) => s + p.lat, 0) / e.geometry.length,
  ];
}
// Local equirectangular projection is sufficient for this bounded urban extract.
export function closestPointOnLine(point: Point, line: Point[]): Point | null {
  if (!line.length) return null;
  let best = line[0],
    bestMeters = distance(point, best);
  const scale = Math.cos((point[1] * Math.PI) / 180);
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i];
    const dx = (b[0] - a[0]) * scale,
      dy = b[1] - a[1];
    const length2 = dx * dx + dy * dy;
    const t = length2
      ? Math.max(
          0,
          Math.min(
            1,
            ((point[0] - a[0]) * scale * dx + (point[1] - a[1]) * dy) / length2,
          ),
        )
      : 0;
    const candidate: Point = [
      a[0] + t * (b[0] - a[0]),
      a[1] + t * (b[1] - a[1]),
    ];
    const meters = distance(point, candidate);
    if (meters < bestMeters) {
      best = candidate;
      bestMeters = meters;
    }
  }
  return best;
}
export function buildGraph(elements: OsmElement[]): Graph {
  const points = new Map<number, Point>(),
    edges = new Map<number, Edge[]>();
  const allowedFoot = (tags: Record<string, string>) =>
    ["yes", "designated", "permissive"].includes(tags.foot || "");
  const inaccessible = (tags: Record<string, string>) =>
    ["no", "private", "use_sidepath"].includes(tags.foot || "") ||
    (["no", "private"].includes(tags.access || "") && !allowedFoot(tags));
  const barriers = new Set(
    elements
      .filter(
        (e) =>
          e.type === "node" &&
          (inaccessible(e.tags || {}) ||
            ["wall", "fence", "locked_gate"].includes(e.tags?.barrier || "") ||
            e.tags?.locked === "yes"),
      )
      .map((e) => e.id),
  );
  const stepNodes = new Set(
    elements
      .filter(
        (e) =>
          e.type === "node" &&
          (e.tags?.barrier === "step" || e.tags?.highway === "steps"),
      )
      .map((e) => e.id),
  );
  for (const way of elements) {
    const t = way.tags || {};
    if (!t.highway || !way.nodes || !way.geometry) continue;
    if (
      [
        "motorway",
        "motorway_link",
        "trunk",
        "trunk_link",
        "construction",
        "proposed",
      ].includes(t.highway) ||
      t.area === "yes" ||
      inaccessible(t) ||
      (t.highway === "cycleway" && !allowedFoot(t))
    )
      continue;
    for (let i = 1; i < way.nodes.length; i++) {
      const a = way.nodes[i - 1],
        b = way.nodes[i],
        p = way.geometry[i - 1],
        q = way.geometry[i];
      if (!p || !q || barriers.has(a) || barriers.has(b)) continue;
      const pa: Point = [p.lon, p.lat],
        pb: Point = [q.lon, q.lat];
      points.set(a, pa);
      points.set(b, pb);
      const data = {
        length: distance(pa, pb),
        wayId: way.id,
        steps: t.highway === "steps" || stepNodes.has(a) || stepNodes.has(b),
      };
      if (t["oneway:foot"] !== "-1")
        edges.set(a, [...(edges.get(a) || []), { to: b, ...data }]);
      if (t["oneway:foot"] !== "yes")
        edges.set(b, [...(edges.get(b) || []), { to: a, ...data }]);
    }
  }
  return { points, edges };
}
export function nearest(
  graph: Graph,
  point: Point,
  maxMeters = 100,
): { id: number; meters: number } | null {
  let best: { id: number; meters: number } | null = null;
  for (const [id, p] of graph.points) {
    const meters = distance(p, point);
    if (meters <= maxMeters && (!best || meters < best.meters))
      best = { id, meters };
  }
  return best;
}
export function shortestPath(
  graph: Graph,
  start: number,
  targets: Set<number>,
  avoidSteps = false,
) {
  if (!graph.points.has(start)) return null;
  const distances = new Map<number, number>([[start, 0]]),
    previous = new Map<number, { from: number; edge: Edge }>();
  // Binary heap keeps repeated route calculations fast on the bounded regional graph.
  const heap: [number, number][] = [];
  const push = (v: [number, number]) => {
    heap.push(v);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= v[0]) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = v;
  };
  const pop = () => {
    const root = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let c = i * 2 + 1;
        if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
        if (heap[c][0] >= last[0]) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = last;
    }
    return root;
  };
  push([0, start]);
  let end: number | undefined;
  while (heap.length) {
    const [d, id] = pop();
    if (d !== distances.get(id)) continue;
    if (targets.has(id)) {
      end = id;
      break;
    }
    for (const edge of graph.edges.get(id) || []) {
      if (avoidSteps && edge.steps) continue;
      const next = d + edge.length;
      if (next < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, next);
        previous.set(edge.to, { from: id, edge });
        push([next, edge.to]);
      }
    }
  }
  if (end === undefined) return null;
  const ids = [end],
    used: Edge[] = [];
  let cursor = end;
  while (cursor !== start) {
    const item = previous.get(cursor);
    if (!item) return null;
    used.push(item.edge);
    cursor = item.from;
    ids.push(cursor);
  }
  return {
    end,
    meters: Math.round(distances.get(end)!),
    coordinates: ids.reverse().map((id) => graph.points.get(id)!),
    wayIds: [...new Set(used.map((e) => e.wayId))],
    steps: new Set(used.filter((e) => e.steps).map((e) => e.wayId)).size,
  };
}
