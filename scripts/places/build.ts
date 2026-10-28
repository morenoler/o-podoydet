import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { OsmElement } from "../../shared/geo";
import type { NearbyPlace, PlaceSource, PlacesDataset } from "../../shared/places";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const attribution = "© OpenStreetMap contributors";
export const bbox: [number, number, number, number] = [129.145, 35.150, 129.180, 35.175];

export function categoriesFor(tags: Record<string, string>): string[] {
  if (tags.disused === "yes" || tags.abandoned === "yes" || tags.access === "private") return [];
  const categories: string[] = [];
  if (tags.amenity === "cafe") categories.push("cafe");
  if (["restaurant", "fast_food"].includes(tags.amenity)) categories.push("restaurant");
  if (tags.shop === "supermarket") categories.push("supermarket");
  if (tags.shop === "convenience") categories.push("convenience");
  if (tags.amenity === "pharmacy") categories.push("pharmacy");
  if ((tags.railway === "station" || tags.railway === "stop") &&
      (tags.station === "subway" || tags.subway === "yes")) categories.push("subway");
  if (tags.leisure === "park") categories.push("park");
  if (["attraction", "museum", "gallery", "aquarium", "viewpoint", "artwork"].includes(tags.tourism)) categories.push("attraction");
  // Named venues remain findable by name, without pretending to be a supported category.
  if (!categories.length && (tags.amenity || tags.shop || tags.tourism) &&
      (tags.name || tags["name:en"] || tags["name:ru"])) categories.push("named_place");
  return categories;
}

export function coordinatesFor(element: OsmElement, nodes: Map<number, OsmElement>): NearbyPlace["coordinates"] | null {
  if (element.type === "node" && Number.isFinite(element.lon) && Number.isFinite(element.lat))
    return [element.lon!, element.lat!];
  if (element.type !== "way" || !element.nodes?.length) return null;
  // The final repeated polygon node must not bias the arithmetic mean.
  const ids = element.nodes[0] === element.nodes.at(-1) ? element.nodes.slice(0, -1) : element.nodes;
  const points = ids.map((id) => nodes.get(id));
  if (!points.length || points.some((point) => !point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat))) return null;
  return [
    points.reduce((sum, point) => sum + point!.lon!, 0) / points.length,
    points.reduce((sum, point) => sum + point!.lat!, 0) / points.length,
  ];
}

function aliases(tags: Record<string, string>) {
  return [...new Set(Object.entries(tags)
    .filter(([key]) => /^(name(?::[\w-]+)?|alt_name(?::[\w-]+)?|int_name|brand|short_name)$/.test(key))
    .flatMap(([, value]) => value.split(";").map((part) => part.trim())).filter(Boolean))];
}

export function placeFor(element: OsmElement, nodes: Map<number, OsmElement>, sourceId: string): NearbyPlace | null {
  const tags = element.tags || {};
  const categories = categoriesFor(tags);
  const coordinates = coordinatesFor(element, nodes);
  if (!categories.length || !coordinates) return null;
  const [lon, lat] = coordinates;
  if (lon < bbox[0] || lat < bbox[1] || lon > bbox[2] || lat > bbox[3]) return null;
  const names = aliases(tags);
  const labels: Record<string, string> = { cafe: "Кафе", restaurant: "Место питания", supermarket: "Супермаркет", convenience: "Продуктовый магазин", pharmacy: "Аптека", subway: "Станция метро", park: "Парк", attraction: "Достопримечательность" };
  return {
    id: `osm:${element.type}:${element.id}`,
    name: tags["name:ru"] || tags["name:en"] || tags.name || `${labels[categories[0]] || "Место"} без названия в OSM`,
    aliases: names,
    categories,
    coordinates: coordinates.map((value) => Number(value.toFixed(7))) as [number, number],
    sourceId,
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    coordinateMethod: element.type === "node" ? "osm_node" : "osm_way_vertex_mean",
    ...(element.type === "way" ? { assumptions: ["Точка усреднена по вершинам контура; это не вход и не ближайшая точка границы."] } : {}),
  };
}

function readCache(path: string) {
  const raw = readFileSync(resolve(root, path));
  return { value: JSON.parse(raw.toString("utf8")), sha256: createHash("sha256").update(raw).digest("hex") };
}

export function buildPlaces(): PlacesDataset {
  const sources: PlaceSource[] = [];
  const elements = new Map<string, { element: OsmElement; sourceId: string }>();
  const nodes = new Map<number, OsmElement>();
  for (let index = 1; index <= 4; index++) {
    const cachePath = `data/osm-busan-haeundae-api-tile-${index}.json`;
    const { value, sha256 } = readCache(cachePath);
    if (!Array.isArray(value.elements) || !value.sourceUrl || !value.fetchedAt) throw new Error(`Incomplete cache metadata: ${cachePath}`);
    const id = `osm-haeundae-tile-${index}`;
    sources.push({ id, url: value.sourceUrl, request: { method: "GET", url: value.sourceUrl }, sha256,
      obtainedAt: value.fetchedAt, sourceDate: null, cachePath, attribution, license: "ODbL-1.0", evidenceKind: "cached_osm_response" });
    for (const element of value.elements as OsmElement[]) {
      elements.set(`${element.type}:${element.id}`, { element, sourceId: id });
      if (element.type === "node") nodes.set(element.id, element);
    }
  }
  const places = [...elements.values()].map(({ element, sourceId }) => placeFor(element, nodes, sourceId)).filter((p): p is NearbyPlace => !!p);
  const haeundae = places.find((place) => place.id === "osm:node:5208472150");
  if (!haeundae) throw new Error("Haeundae station source missing");
  places.push({ ...haeundae, id: "center:haeundae", name: "Хэундэ: ориентир центра района у станции метро", aliases: ["Хэундэ", "Haeundae", "해운대"], categories: [], centerScope: "district",
    assumptions: ["Ориентир приложения — станция Хэундэ. Это явно выбранная точка, а не официальная граница центра района."] });
  for (const id of ["seomyeon-geocode", "seomyeon-tourism"]) {
    const cachePath = `data/places/${id}.cache.json`;
    const { value } = readCache(cachePath);
    if (createHash("sha256").update(value.body).digest("hex") !== value.sha256) throw new Error(`Cache checksum mismatch: ${id}`);
    sources.push({ id, url: value.url, request: value.request, sha256: value.sha256, obtainedAt: value.obtainedAt, sourceDate: null, cachePath,
      attribution: id === "seomyeon-geocode" ? attribution : "Visit Busan — Busan Tourism Organization",
      ...(id === "seomyeon-geocode" ? { license: "ODbL-1.0" } : {}),
      evidenceKind: id === "seomyeon-geocode" ? "geocoder_response" : "search_excerpt" });
    if (id === "seomyeon-geocode") {
      const candidates = JSON.parse(value.body);
      const station = candidates.find((p: { osm_type: string; osm_id: number; category: string }) => p.osm_type === "node" && p.osm_id === 5782717001 && p.category === "railway");
      if (!station || !Number.isFinite(Number(station.lon)) || !Number.isFinite(Number(station.lat))) throw new Error("Seomyeon source identity changed; review it before rebuilding");
      places.push({ id: "center:seomyeon", name: "Сомён: ориентир делового центра у станции метро", aliases: ["Сомён", "Сомен", "Сеомён", "Сеомен", "Seomyeon", "서면"], categories: [],
        coordinates: [Number(station.lon), Number(station.lat)], sourceId: id, supportingSourceIds: ["seomyeon-tourism"], sourceUrl: "https://www.openstreetmap.org/node/5782717001",
        coordinateMethod: "nominatim_point", centerScope: "city", assumptions: ["Сомён выбран как ориентир делового центра по описанию Visit Busan. Это не географический центр и не административная граница.", "Координата относится к станции метро; расстояние до неё не является маршрутом или временем в пути."] });
    }
  }
  return {
    schemaVersion: 1, region: "Пусан", retrievedAt: sources.map((source) => source.obtainedAt).sort().at(-1)!, sourceDate: null, attribution,
    sources, coverage: { bbox, complete: false, description: "Выборка отмеченных в OSM мест в Хэундэ. Сомён включён только как отдельный ориентир; его окружение не выгружено." },
    places: places.sort((a, b) => a.id.localeCompare(b.id)),
    assumptions: [
      "Набор не исчерпывающий: отсутствие объекта в OSM не доказывает его отсутствие на местности.",
      "В исходном кэше не сохранены даты редактирования объектов OSM; sourceDate неизвестна, obtainedAt — только дата получения.",
      "Геометрическое расстояние считается от точки отеля, а не от конкретного номера. Пеший маршрут, доступность, часы работы и услуги не подтверждены.",
      "Центр неоднозначен: Сомён — выбранный ориентир делового центра Пусана, станция Хэундэ — ориентир центра района. Пользователь должен видеть это различие.",
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataset = buildPlaces();
  writeFileSync(resolve(root, "data/places/busan-places.json"), JSON.stringify(dataset, null, 2) + "\n");
  console.log(`Prepared ${dataset.places.length} public places, ${dataset.sources.length} source records; network not used.`);
}
