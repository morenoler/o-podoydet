import { readFile, writeFile } from "node:fs/promises";
import {
  buildGraph,
  nearest,
  pointOf,
  distance,
  shortestPath,
  closestPointOnLine,
  type OsmElement,
} from "../shared/geo";
import type { Dataset, Fact, Hotel, Point } from "../shared/types";

const raw = JSON.parse(await readFile("data/osm-snapshot.json", "utf8")) as {
  elements: OsmElement[];
  fetchedAt: string;
  osm3s?: { timestamp_osm_base: string };
};
const graph = buildGraph(raw.elements);
const beaches = raw.elements.filter(
  (e) => e.tags?.natural === "beach" && e.geometry?.length,
);
// Candidate endpoints must already lie on the pedestrian graph near a beach boundary.
// Proximity does not establish a surveyed entrance: all routes remain approximate.
const beachNodes = new Map<number, OsmElement>();
for (const beach of beaches)
  for (const p of beach.geometry!) {
    const n = nearest(graph, [p.lon, p.lat], 35);
    if (n) beachNodes.set(n.id, beach);
  }
if (!beachNodes.size)
  throw new Error(
    "No beach approach nodes in snapshot; inspect coverage before continuing.",
  );
const targets = new Set(beachNodes.keys());
const sourceDate = raw.osm3s?.timestamp_osm_base || raw.fetchedAt;
const noiseObjects = raw.elements.filter(
  (e) =>
    e.tags?.railway === "rail" ||
    ["primary", "secondary", "tertiary"].includes(e.tags?.highway || "") ||
    ["bar", "pub", "nightclub"].includes(e.tags?.amenity || ""),
);
const candidates = raw.elements.filter(
  (e) =>
    ["hotel", "guest_house"].includes(e.tags?.tourism || "") &&
    e.tags?.name &&
    pointOf(e),
);
const hotels: Hotel[] = [];
const facts: Fact[] = [];
// Rebuilding a snapshot must not refresh the age of its evidence.
const now = raw.fetchedAt,
  expiresAt = new Date(Date.parse(sourceDate) + 30 * 86400000).toISOString();
for (const e of candidates) {
  const coordinates = pointOf(e)!;
  if (
    hotels.some(
      (h) =>
        h.name === e.tags!.name || distance(h.coordinates, coordinates) < 12,
    )
  )
    continue;
  const n = nearest(graph, coordinates, 100);
  const path = n ? shortestPath(graph, n.id, targets) : null;
  // A snapped hotel already on an approximate beach node has no measurable path;
  // do not turn this into the misleading claim "0 metres to the beach".
  if (!path || path.coordinates.length < 2 || path.meters > 2500) continue;
  const beach = beachNodes.get(path.end)!;
  const sameBeachTargets = new Set(
    [...beachNodes].filter(([, b]) => b.id === beach.id).map(([id]) => id),
  );
  const alternative =
    path.steps && n ? shortestPath(graph, n.id, sameBeachTargets, true) : null;
  const id = `${e.type}-${e.id}`;
  const noise = noiseObjects
    .flatMap((o) => {
      const pts: Point[] =
        o.geometry?.map((p) => [p.lon, p.lat]) ||
        (pointOf(o) ? [pointOf(o)!] : []);
      if (!pts.length) return [];
      const closest = closestPointOnLine(coordinates, pts)!;
      const meters = Math.round(distance(coordinates, closest));
      if (meters > 350) return [];
      return [
        {
          name:
            o.tags?.name ||
            (o.tags?.railway
              ? "Железная дорога"
              : o.tags?.highway
                ? "Автомобильная дорога"
                : "Заведение"),
          kind: o.tags?.railway
            ? "rail"
            : o.tags?.highway
              ? "road"
              : "nightlife",
          meters,
          osmUrl: `https://www.openstreetmap.org/${o.type}/${o.id}`,
          coordinates: closest,
        },
      ];
    })
    .sort((a, b) => a.meters - b.meters)
    .filter(
      (item, i, list) =>
        list.findIndex((x) => x.name === item.name && x.kind === item.kind) ===
        i,
    )
    .slice(0, 5);
  const hotel: Hotel = {
    id,
    name: e.tags!.name,
    address:
      [e.tags?.["addr:street"], e.tags?.["addr:housenumber"]]
        .filter(Boolean)
        .join(", ") || "Адлер, прибрежный район",
    coordinates,
    osmUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
    rooms: [
      { id: `${id}-court`, name: "Семейный во двор", capacity: 4, demo: true },
      {
        id: `${id}-street`,
        name: "Стандарт на улицу",
        capacity: 2,
        demo: true,
      },
    ],
    route: {
      ...path,
      beachName: beach.tags?.name || "Пляж",
      beachId: beach.id,
      connectionMeters: Math.round(n!.meters),
      approximate: true,
      ...(alternative
        ? {
            noStepsAlternative: {
              meters: alternative.meters,
              coordinates: alternative.coordinates,
            },
          }
        : {}),
    },
    noise,
  };
  hotels.push(hotel);
  facts.push({
    id: `${id}-route`,
    hotelId: id,
    feature: "beach_walk",
    value: path.meters,
    source: "OpenStreetMap, локальный пешеходный граф",
    sourceUrl: hotel.osmUrl,
    quote: `${path.meters} м по графу. Привязка точки отеля к сети: ${Math.round(n!.meters)} м. Вход и подход к пляжу не обследованы; соединительные участки не включены в длину.`,
    method: "geo",
    confidence: "medium",
    confidenceReason: "Рассчитано по сети OSM; точки входа приближённые.",
    obtainedAt: raw.fetchedAt,
    sourceDate,
    expiresAt,
    demo: false,
  });
  // A route without mapped steps is not proof of complete step-free access.
  // Conversely, absence of an alternative in this extract is not proof that none exists.
  // Keep step_free_route unknown; observed steps remain available in hotel.route.
  for (const [j, room] of hotel.rooms.entries()) {
    for (const [feature, value, quote] of [
      [
        "courtyard",
        j === 0,
        j === 0
          ? "Все окна этой категории выходят во двор."
          : "Окна этой категории выходят на улицу.",
      ],
      [
        "family",
        j === 0,
        j === 0
          ? "Категория предусмотрена для семейного размещения до четырёх гостей."
          : "Категория не предусмотрена для семейного размещения.",
      ],
    ] as const)
      facts.push({
        id: `${room.id}-${feature}`,
        hotelId: id,
        roomId: room.id,
        feature,
        value,
        source: "Сценарий демонстрации — не сведения реального отельера",
        quote,
        method: "demo",
        confidence: "low",
        confidenceReason:
          "Вымышленная категория для проверки алгоритма. Требует реального подтверждения.",
        obtainedAt: now,
        expiresAt,
        demo: true,
      });
    // Every third hotel has known demo obstacles; other hotels can be clarified interactively.
    if (hotels.length % 3 === 0)
      facts.push({
        id: `${room.id}-access`,
        hotelId: id,
        roomId: room.id,
        feature: "step_free_access",
        value: false,
        source: "Сценарий демонстрации — не сведения реального отельера",
        quote: "Перед входом три ступени, пандуса нет.",
        method: "demo",
        confidence: "low",
        confidenceReason:
          "Вымышленный ответ для проверки исключения неподходящих вариантов.",
        obtainedAt: now,
        expiresAt,
        demo: true,
      });
  }
  if (hotels.length === 24) break;
}
if (hotels.length < 5)
  throw new Error(`Only ${hotels.length} routable hotels; inspect region.`);
const dataset: Dataset = {
  region: "Адлер",
  fetchedAt: raw.fetchedAt,
  sourceDate,
  attribution: "© OpenStreetMap contributors · ODbL 1.0",
  bbox: [39.907, 43.417, 39.951, 43.452],
  hotels,
  facts,
  map: raw.elements
    .filter((e) => e.geometry?.length && (e.tags?.highway || e.tags?.natural))
    .map((e) => ({
      coordinates: e.geometry!.map((p) => [p.lon, p.lat]),
      kind: e.tags?.natural || e.tags?.highway || "road",
    })),
};
await writeFile("data/demo.json", JSON.stringify(dataset));
console.log(
  JSON.stringify(
    {
      hotels: hotels.length,
      facts: facts.length,
      graphNodes: graph.points.size,
      beachApproaches: beachNodes.size,
      beaches: beaches.map((b) => b.tags?.name),
      routesWithSteps: hotels.filter((h) => h.route?.steps).length,
    },
    null,
    2,
  ),
);
