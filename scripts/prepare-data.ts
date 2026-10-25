import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
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

export interface Snapshot {
  elements: OsmElement[];
  fetchedAt: string;
  regionKey: string;
  bbox: string;
  sourceDate?: string;
  osm3s?: { timestamp_osm_base: string };
}
export function prepareDataset(raw: Snapshot, previous?: Dataset): Dataset {
  if (
    raw.regionKey !== "busan-haeundae" ||
    raw.bbox !== "35.150,129.145,35.175,129.180"
  ) {
    throw new Error(
      "Expected a real Busan / Haeundae snapshot; run npm run data:fetch.",
    );
  }
  const label = (element: OsmElement) =>
    element.tags?.["name:ru"] ||
    element.tags?.["name:en"] ||
    element.tags?.name;
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
  const sourceDate =
    raw.sourceDate || raw.osm3s?.timestamp_osm_base || raw.fetchedAt;
  const noiseObjects = raw.elements.filter(
    (e) =>
      e.tags?.railway === "rail" ||
      ["primary", "secondary", "tertiary"].includes(e.tags?.highway || "") ||
      ["bar", "pub", "nightclub"].includes(e.tags?.amenity || ""),
  );
  const candidates = raw.elements.filter(
    (e) =>
      ["hotel", "guest_house", "motel", "hostel", "apartment"].includes(
        e.tags?.tourism || "",
      ) &&
      label(e) &&
      pointOf(e),
  );
  // Retain established IDs when a POI and its building describe the same property.
  const existing = new Map((previous?.hotels || []).map((h) => [h.id, h]));
  candidates.sort(
    (a, b) =>
      Number(existing.has(`${b.type}-${b.id}`)) -
      Number(existing.has(`${a.type}-${a.id}`)),
  );
  const hotels: Hotel[] = [];
  const facts: Fact[] = [];
  // Rebuilding a snapshot must not refresh the age of its evidence.
  const now = raw.fetchedAt,
    expiresAt = new Date(Date.parse(sourceDate) + 30 * 86400000).toISOString();
  for (const e of candidates) {
    const coordinates = pointOf(e)!;
    // Editing API map tiles may return complete ways extending beyond the query.
    if (
      coordinates[0] < 129.145 ||
      coordinates[0] > 129.18 ||
      coordinates[1] < 35.15 ||
      coordinates[1] > 35.175
    )
      continue;
    const id = `${e.type}-${e.id}`;
    const prior = existing.get(id);
    if (
      hotels.some(
        (h) =>
          h.name.trim().toLocaleLowerCase() ===
            label(e)!.trim().toLocaleLowerCase() &&
          h.coordinates !== null && distance(h.coordinates, coordinates) < 150,
      )
    )
      continue;
    const n = nearest(graph, coordinates, 100);
    const calculated = n ? shortestPath(graph, n.id, targets) : null;
    // A snapped hotel already on an approximate beach node has no measurable path;
    // do not turn this into the misleading claim "0 metres to the beach".
    const path =
      calculated &&
      calculated.coordinates.length >= 2 &&
      calculated.meters <= 2500
        ? calculated
        : null;
    const beach = path ? beachNodes.get(path.end)! : null;
    const sameBeachTargets = new Set(
      [...beachNodes].filter(([, b]) => b.id === beach?.id).map(([id]) => id),
    );
    const alternative =
      path?.steps && n
        ? shortestPath(graph, n.id, sameBeachTargets, true)
        : null;
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
              label(o) ||
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
          list.findIndex(
            (x) => x.name === item.name && x.kind === item.kind,
          ) === i,
      )
      .slice(0, 5);
    const hotel: Hotel = {
      id,
      name: label(e)!,
      lodgingType: e.tags!.tourism as Hotel["lodgingType"],
      address:
        [e.tags?.["addr:street"], e.tags?.["addr:housenumber"]]
          .filter(Boolean)
          .join(", ") || "Пусан, Хэундэ",
      coordinates,
      osmUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      rooms: prior?.rooms || [
        {
          id: `${id}-court`,
          name: "Семейный во двор",
          capacity: 4,
          demo: true,
        },
        {
          id: `${id}-street`,
          name: "Стандарт на улицу",
          capacity: 2,
          demo: true,
        },
      ],
      route:
        path && beach
          ? {
              ...path,
              beachName:
                label(beach) || "Пляж — название участка не указано в OSM",
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
            }
          : null,
      noise,
    };
    hotels.push(hotel);
    if (path)
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
    if (prior) {
      // Rebuilding must not rewrite the existing demonstration categories or age.
      facts.push(
        ...(previous?.facts || []).filter(
          (f) => f.hotelId === id && f.method !== "geo",
        ),
      );
      continue;
    }
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
  }
  if (hotels.length < 5)
    throw new Error(
      `Only ${hotels.length} named accommodation objects; inspect region.`,
    );
  // Join adjacent coastline ways by their actual OSM endpoints. Rendering separate
  // fragments as independently closed water polygons would paint over land.
  const coastParts = raw.elements
    .filter((e) => e.tags?.natural === "coastline" && e.geometry?.length)
    .map((e) => e.geometry!.map((p) => [p.lon, p.lat] as Point));
  const coastlines: Point[][] = [];
  const samePoint = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
  while (coastParts.length) {
    let chain = coastParts.shift()!;
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < coastParts.length; i++) {
        const part = coastParts[i];
        if (samePoint(chain[chain.length - 1], part[0]))
          chain = [...chain, ...part.slice(1)];
        else if (samePoint(part[part.length - 1], chain[0]))
          chain = [...part, ...chain.slice(1)];
        else continue;
        coastParts.splice(i, 1);
        extended = true;
        break;
      }
    }
    coastlines.push(chain);
  }
  const dataset: Dataset = {
    region: "Пусан",
    fetchedAt: raw.fetchedAt,
    sourceDate,
    attribution: "© OpenStreetMap contributors · ODbL 1.0",
    bbox: [129.145, 35.15, 129.18, 35.175],
    hotels,
    facts,
    map: [
      ...raw.elements
        .filter(
          (e) =>
            e.geometry?.length &&
            (e.tags?.highway || e.tags?.natural) &&
            e.tags?.natural !== "coastline",
        )
        .map((e) => ({
          coordinates: e.geometry!.map((p) => [p.lon, p.lat] as Point),
          kind: e.tags?.natural || e.tags?.highway || "road",
        })),
      ...coastlines.map((coordinates) => ({ coordinates, kind: "coastline" })),
    ],
  };
  return dataset;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const raw = JSON.parse(
    await readFile("data/osm-busan-haeundae-snapshot.json", "utf8"),
  ) as Snapshot;
  let previous: Dataset | undefined;
  try {
    previous = JSON.parse(await readFile("data/demo.json", "utf8")) as Dataset;
  } catch {
    /* first build */
  }
  const dataset = prepareDataset(raw, previous);
  await writeFile("data/demo.json", JSON.stringify(dataset));
  console.log(
    JSON.stringify(
      {
        hotels: dataset.hotels.length,
        facts: dataset.facts.length,
        withRoute: dataset.hotels.filter((h) => h.route).length,
        withoutRoute: dataset.hotels.filter((h) => !h.route).length,
        routesWithSteps: dataset.hotels.filter((h) => h.route?.steps).length,
      },
      null,
      2,
    ),
  );
}
