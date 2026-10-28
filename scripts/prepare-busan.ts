import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Dataset, Hotel, Point } from "../shared/types";
import { sha256, validateOverpass, type OsmElement, type OverpassResponse, type SnapshotManifest } from "./fetch-busan";

export type PlaceKind = "city_center" | "cafe" | "restaurant" | "supermarket" | "convenience" | "pharmacy" | "park" | "subway" | "museum" | "shopping_mall" | "beach" | "train_station";
export interface PlaceCategory { key: PlaceKind; label: string; defaultMaxMeters: number; osmQueries: string[]; aliases: string[] }
export interface NearbyPlace {
  kind: PlaceKind; name: string; meters: number; coordinates: Point;
  sourceUrl: string; obtainedAt: string; sourceDate?: string; expiresAt: string;
  method: "haversine-osm-v1"; status: "supported"; scope: "hotel_surroundings"; osmId: string;
}
interface SourceEvidence {
  sourceUrl: string; obtainedAt: string; sourceDate?: string; expiresAt: string;
  method: "osm"; status: "reported";
}
export interface EnrichedHotel extends Hotel { nearbyPlaces: NearbyPlace[]; sourceEvidence?: SourceEvidence }
export interface CenterDefinition {
  osmId: string; name: string; coordinates: Point;
  definition: string; officialSource: { url: string; title: string; obtainedAt: string; quote: string; sourceDate?: string };
}
export interface RegionalExtractManifest {
  source: { url: string; receivedAt: string; sha256: string; bytes: number; osmBaseDate?: string };
  extract: { path: string; sha256: string; bytes: number; elementsCount: number; bbox: [number, number, number, number]; method: string };
}
const lodgingTypes = new Set(["hotel", "motel", "guest_house", "hostel", "apartment"]);
const expires = (date: string) => new Date(Date.parse(date) + 30 * 86400000).toISOString();
const osmId = (e: OsmElement) => `${e.type}/${e.id}`;
const osmUrl = (e: OsmElement) => `https://www.openstreetmap.org/${osmId(e)}`;

export function coordinates(e: OsmElement): Point | null {
  const lon = e.type === "node" ? e.lon : e.center?.lon;
  const lat = e.type === "node" ? e.lat : e.center?.lat;
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon!) <= 180 && Math.abs(lat!) <= 90 ? [lon!, lat!] : null;
}
export function haversineMeters(from: Point, to: Point): number {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(to[1] - from[1]);
  const dLon = rad(to[0] - from[0]);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from[1])) * Math.cos(rad(to[1])) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
}
/** Audit candidates only: same name and proximity do not prove one business. */
export function duplicateHotelCandidates(hotels: Hotel[], maxMeters = 100): { ids: [string, string]; normalizedName: string; meters: number }[] {
  const groups = new Map<string, Hotel[]>();
  for (const hotel of hotels) {
    const name = hotel.name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (!name || !hotel.coordinates) continue;
    const group = groups.get(name) ?? []; group.push(hotel); groups.set(name, group);
  }
  const candidates: { ids: [string, string]; normalizedName: string; meters: number }[] = [];
  for (const [name, group] of groups) for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) {
    const distance = haversineMeters(group[a].coordinates!, group[b].coordinates!);
    if (distance <= maxMeters) candidates.push({ ids: [group[a].id, group[b].id], normalizedName: name, meters: Math.ceil(distance) });
  }
  return candidates;
}
export function inactive(e: OsmElement): boolean {
  const t = e.tags ?? {};
  return ["disused", "abandoned", "demolished", "ruins", "proposed", "construction"].some(k => t[k] === "yes") || t.opening_hours === "closed" || t.opening_hours === "off";
}

/** Configuration allows simple exact tag conjunctions, not arbitrary code. */
export function matchesSelector(tags: Record<string, string>, selector: string): boolean {
  const terms = [...selector.matchAll(/\[([a-z_:]+)(!?=)([a-z_]+)\]/g)];
  if (!terms.length || terms.map(term => term[0]).join("") !== selector) throw new Error(`Unsupported OSM selector ${selector}`);
  return terms.every(([, key, operator, value]) => operator === "=" ? tags[key] === value : tags[key] !== value);
}

export function samePlaceVersion(a: OsmElement, b: OsmElement): boolean {
  const pa = coordinates(a), pb = coordinates(b);
  if (osmId(a) !== osmId(b) || !pa || !pb) return false;
  // OSM coordinates have 1e-7-degree precision. A way bbox midpoint may have an
  // extra half digit, while Overpass rounds its `center` output back to 7 digits.
  const centerRounding = a.type === "node" ? 0 : 0.00000005001;
  const tags = (e: OsmElement) => JSON.stringify(Object.entries(e.tags ?? {}).sort(([ka], [kb]) => ka.localeCompare(kb)));
  return pa.every((coordinate, i) => Math.abs(coordinate - pb[i]) <= centerRounding) && tags(a) === tags(b);
}

function indexPlaces(elements: OsmElement[], categories: PlaceCategory[], center: CenterDefinition): Map<PlaceKind, OsmElement[]> {
  const index = new Map<PlaceKind, OsmElement[]>();
  for (const category of categories) {
    const candidates = elements.filter(e => {
      const t = e.tags ?? {};
      return e.type !== "count" && !inactive(e) && t.access !== "private" && t.access !== "no" && coordinates(e)
        && (category.key === "city_center" ? osmId(e) === center.osmId : category.osmQueries.some(q => matchesSelector(t, q)));
    });
    index.set(category.key, candidates);
  }
  return index;
}

export function buildNearbyPlaces(hotel: Hotel, elements: OsmElement[], categories: PlaceCategory[], obtainedAt: string, center: CenterDefinition, index = indexPlaces(elements, categories, center)): NearbyPlace[] {
  if (!hotel.coordinates || hotel.synthetic || hotel.accountListingId) return [];
  const result: NearbyPlace[] = [];
  for (const category of categories) {
    let nearest: { e: OsmElement; point: Point; distance: number } | undefined;
    for (const e of index.get(category.key) ?? []) {
      const point = coordinates(e)!;
      const distance = haversineMeters(hotel.coordinates, point);
      if (!nearest || distance < nearest.distance || (distance === nearest.distance && osmId(e) < osmId(nearest.e))) nearest = { e, point, distance };
    }
    if (!nearest) continue;
    const { e, point, distance } = nearest;
    const observationDate = e.obtainedAt ?? obtainedAt;
    result.push({
      kind: category.key,
      name: category.key === "city_center" ? center.name : e.tags?.["name:en"] || e.tags?.name || e.tags?.brand || `${category.label} · OSM ${osmId(e)}`,
      // Round up so a point just outside the user threshold never passes due to rounding.
      meters: Math.ceil(distance), coordinates: point, sourceUrl: osmUrl(e), obtainedAt: observationDate,
      ...(e.timestamp ? { sourceDate: e.timestamp } : {}), expiresAt: expires(observationDate),
      method: "haversine-osm-v1", status: "supported", scope: "hotel_surroundings", osmId: osmId(e),
    });
  }
  return result;
}

export function prepareBusanDataset(base: Dataset, lodgings: OverpassResponse, places: OverpassResponse, boundary: OverpassResponse, manifest: SnapshotManifest, categories: PlaceCategory[], center: CenterDefinition, regional?: RegionalExtractManifest) {
  const lodgingDate = manifest.entries.lodgings.receivedAt;
  const placeEntries = regional ? [] : manifest.collections?.places.map(key => manifest.entries[key]) ?? [manifest.entries.places];
  const placeDate = regional?.source.receivedAt ?? placeEntries.map(e => e.receivedAt).sort().at(-1)!;
  const placeBaseDate = regional?.source.osmBaseDate ?? placeEntries.map(e => e.osmBaseDate).filter((d): d is string => Boolean(d)).sort()[0];
  const lodgingElements = lodgings.elements.filter(e => e.type !== "count");
  const byId = new Map(lodgingElements.map(e => [`${e.type}-${e.id}`, e]));
  const exclusions: { osmId: string; reason: string }[] = [];
  const retainedOldIds = new Set(base.hotels.map(h => h.id));
  const sourceEvidence = (element: OsmElement): SourceEvidence => ({ sourceUrl: osmUrl(element), obtainedAt: lodgingDate, ...(element.timestamp ? { sourceDate: element.timestamp } : {}), expiresAt: expires(lodgingDate), method: "osm", status: "reported" });
  const placeIndex = indexPlaces(places.elements, categories, center);
  const hotels: EnrichedHotel[] = base.hotels.map(hotel => {
    const current = byId.get(hotel.id);
    // Old official categories, routes, facts and all original dates remain byte-for-byte values.
    return { ...hotel, ...(current && !inactive(current) ? { sourceEvidence: sourceEvidence(current) } : {}), nearbyPlaces: buildNearbyPlaces(hotel, places.elements, categories, placeDate, center, placeIndex) };
  });
  for (const element of lodgingElements) {
    const id = `${element.type}-${element.id}`;
    if (retainedOldIds.has(id)) continue;
    if (inactive(element)) { exclusions.push({ osmId: osmId(element), reason: "inactive lifecycle tag" }); continue; }
    const point = coordinates(element);
    if (!point) { exclusions.push({ osmId: osmId(element), reason: "no valid representative coordinates" }); continue; }
    const t = element.tags ?? {};
    if (!lodgingTypes.has(t.tourism ?? "")) throw new Error(`Unexpected lodging category at ${id}`);
    const street = t["addr:street"] || t["addr:place"];
    const address = ["Пусан", t["addr:suburb"] || t["addr:district"], street, t["addr:housenumber"]].filter(Boolean).join(", ");
    const hotel: Hotel = {
      id, name: t["name:en"] || t.name || t.brand || `Объект размещения · OSM ${osmId(element)}`,
      lodgingType: t.tourism as Hotel["lodgingType"], address, coordinates: point, osmUrl: osmUrl(element),
      rooms: [], route: null, noise: [],
      dataNotes: ["Объект размещения отмечен в OpenStreetMap; работа и существование на месте не проверены.", "Категории, цены, вместимость и доступность номеров не собраны.", "Расстояния до мест — по прямой между картографическими точками; входы и пешеходный путь не проверены."],
    };
    hotels.push({ ...hotel, sourceEvidence: sourceEvidence(element), nearbyPlaces: buildNearbyPlaces(hotel, places.elements, categories, placeDate, center, placeIndex) });
  }
  const relation = boundary.elements.find(e => e.type === "relation" && e.id === manifest.boundaryRelationId);
  if (!relation?.bounds) throw new Error("Busan boundary bounds missing");
  if (!places.elements.some(e => osmId(e) === center.osmId && coordinates(e)?.every((n, i) => n === center.coordinates[i]))) throw new Error("Center anchor must match saved OSM coordinates and identity");
  const bbox: Dataset["bbox"] = [relation.bounds.minlon, relation.bounds.minlat, relation.bounds.maxlon, relation.bounds.maxlat];
  const result = {
    ...base, bbox, hotels,
    // These legacy fields describe the retained base snapshot only, not refreshed official evidence.
    coverage: {
      area: "Busan Metropolitan City administrative boundary", boundaryRelationId: manifest.boundaryRelationId,
      sourceUrl: `https://www.openstreetmap.org/relation/${manifest.boundaryRelationId}`,
      lodgingSnapshotObtainedAt: lodgingDate, placesSnapshotObtainedAt: placeDate,
      placesScope: manifest.placesScope,
      ...(regional ? { regionalPlaceSource: regional } : {}),
      lodgingOsmBaseDate: manifest.entries.lodgings.osmBaseDate, placesOsmBaseDate: placeBaseDate,
      lodgingTypes: [...lodgingTypes], completeness: "Matching mapped OSM objects returned within the administrative boundary; not all real accommodation businesses.",
      originalGeographyScope: "The retained walking graph and noise observations cover the original Haeundae snapshot only.",
      distanceAlgorithm: "haversine-osm-v1", distanceModel: "Great-circle distance, Earth radius 6371008.8 m, representative OSM points, rounded up; not a walking route.",
      centerDefinition: center,
      conflictingPlacesExcluded: places.conflicts ?? [],
      precisionEquivalentPlaces: places.precisionEquivalentPlaces ?? [],
      counts: { originalHotels: base.hotels.length, fetchedLodgings: lodgingElements.length, overlapByOsmId: lodgingElements.filter(e => retainedOldIds.has(`${e.type}-${e.id}`)).length, addedHotels: hotels.length - base.hotels.length, totalHotels: hotels.length, fetchedPlaces: regional?.extract.elementsCount ?? places.elements.length - 1, nonConflictingPlaces: places.elements.length - 1, eligiblePlaces: new Set([...placeIndex.values()].flat().map(osmId)).size, excludedNewLodgings: exclusions.length, fieldVerifiedHotels: 0, fieldVerifiedNearbyPlaces: 0 },
      exclusions,
    },
  };
  return result;
}

/** Validate filtered primitives from a separately preserved regional PBF extract. */
export async function loadRegionalPlaces(root: string, manifest: RegionalExtractManifest): Promise<OverpassResponse> {
  if (!Number.isFinite(Date.parse(manifest.source.receivedAt)) || !/^https:\/\//.test(manifest.source.url)
    || !/^[a-f0-9]{64}$/.test(manifest.source.sha256) || !Number.isSafeInteger(manifest.source.bytes) || manifest.source.bytes <= 0)
    throw new Error("Invalid regional source provenance");
  const bytes = await readFile(`${root}/${manifest.extract.path}`);
  if (bytes.byteLength !== manifest.extract.bytes || sha256(bytes) !== manifest.extract.sha256) throw new Error("Regional POI extract checksum/size mismatch");
  const raw = JSON.parse(bytes.toString("utf8")) as { elements?: OsmElement[] };
  if (!Array.isArray(raw.elements) || raw.elements.length !== manifest.extract.elementsCount) throw new Error("Regional POI extract count mismatch");
  const [west, south, east, north] = manifest.extract.bbox;
  if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) throw new Error("Invalid regional extent");
  for (const element of raw.elements) {
    const point = coordinates(element);
    if (!point || point[0] < west || point[0] > east || point[1] < south || point[1] > north) throw new Error(`Invalid or out-of-extent regional point ${osmId(element)}`);
  }
  const elements = raw.elements.map(e => ({ ...e, obtainedAt: manifest.source.receivedAt }));
  const counter: OsmElement = { type: "count", tags: Object.fromEntries(["node", "way", "relation"].map(type => [`${type}s`, `${elements.filter(e => e.type === type).length}`]).concat([["total", `${elements.length}`]])) };
  return validateOverpass({ osm3s: { timestamp_osm_base: manifest.source.osmBaseDate }, elements: [...elements, counter] });
}

export async function loadBusanSnapshots(root: string, manifest: SnapshotManifest): Promise<Record<string, OverpassResponse>> {
  const snapshots: Record<string, OverpassResponse> = {};
  const placeKeys = manifest.regionalPlacesManifest ? [] : manifest.collections?.places ?? ["places"];
  for (const key of ["boundary", "lodgings", ...placeKeys]) {
    const entry = manifest.entries[key];
    if (!entry) throw new Error(`Missing ${key} manifest entry; explicitly run fetch-busan.ts --fetch first`);
    const bytes = await readFile(`${root}/${entry.path}`);
    if (sha256(bytes) !== entry.sha256) throw new Error(`SHA-256 mismatch for ${key}`);
    snapshots[key] = validateOverpass(JSON.parse(bytes.toString("utf8")));
  }
  if (manifest.regionalPlacesManifest) {
    const regional: RegionalExtractManifest = JSON.parse(await readFile(`${root}/${manifest.regionalPlacesManifest}`, "utf8"));
    snapshots.places = await loadRegionalPlaces(root, regional);
    const candidates = new Map(snapshots.places.elements.filter(e => e.type !== "count").map(e => [osmId(e), e]));
    const conflicts: NonNullable<OverpassResponse["conflicts"]> = [];
    const precisionEquivalentPlaces: string[] = [];
    for (const [key, entry] of Object.entries(manifest.entries)) {
      if (!key.startsWith("places-")) continue;
      const bytes = await readFile(`${root}/${entry.path}`);
      if (sha256(bytes) !== entry.sha256) throw new Error(`SHA-256 mismatch for supplemental ${key}`);
      const supplemental = validateOverpass(JSON.parse(bytes.toString("utf8")));
      for (const element of supplemental.elements) {
        const current = candidates.get(osmId(element));
        if (current && !samePlaceVersion(current, element)) {
          conflicts.push({ osmId: osmId(element), reason: "OSM tags or representative coordinates disagree between saved snapshots; excluded until reviewed", comparedSourcePaths: [regional.extract.path, entry.path] });
          candidates.delete(osmId(element));
        } else if (current && JSON.stringify(coordinates(current)) !== JSON.stringify(coordinates(element))) {
          precisionEquivalentPlaces.push(osmId(element));
        }
      }
    }
    if (conflicts.length) {
      const elements = [...candidates.values()];
      const counter: OsmElement = { type: "count", tags: Object.fromEntries(["node", "way", "relation"].map(type => [`${type}s`, `${elements.filter(e => e.type === type).length}`]).concat([["total", `${elements.length}`]])) };
      snapshots.places = { ...snapshots.places, elements: [...elements, counter], conflicts };
    }
    snapshots.places.precisionEquivalentPlaces = precisionEquivalentPlaces;
  } else if (manifest.collections?.places) {
    const merged = new Map<string, OsmElement>();
    for (const key of placeKeys) for (const element of snapshots[key].elements) {
      if (element.type === "count") continue;
      const previous = merged.get(osmId(element));
      if (previous) {
        const { obtainedAt: _date, ...sourceElement } = previous;
        if (JSON.stringify(sourceElement) !== JSON.stringify(element)) throw new Error(`Conflicting versions across POI responses: ${osmId(element)}`);
      } else merged.set(osmId(element), { ...element, obtainedAt: manifest.entries[key].receivedAt });
    }
    const elements = [...merged.values()];
    const counter: OsmElement = { type: "count", tags: Object.fromEntries(["node", "way", "relation"].map(type => [`${type}s`, `${elements.filter(e => e.type === type).length}`]).concat([["total", `${elements.length}`]])) };
    snapshots.places = { osm3s: {}, elements: [...elements, counter] };
  }
  return snapshots;
}

export async function prepareBusan(): Promise<void> {
  const root = "data/busan";
  const manifest: SnapshotManifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  const snapshots = await loadBusanSnapshots(root, manifest);
  const base: Dataset = JSON.parse(await readFile("data/verified-hotels.json", "utf8"));
  const categories: PlaceCategory[] = JSON.parse(await readFile(`${root}/place-categories.json`, "utf8"));
  const center: CenterDefinition = JSON.parse(await readFile(`${root}/city-center.json`, "utf8"));
  const regional: RegionalExtractManifest | undefined = manifest.regionalPlacesManifest ? JSON.parse(await readFile(`${root}/${manifest.regionalPlacesManifest}`, "utf8")) : undefined;
  const dataset = prepareBusanDataset(base, snapshots.lodgings, snapshots.places, snapshots.boundary, manifest, categories, center, regional);
  await writeFile(`${root}/verified-hotels.json`, JSON.stringify(dataset));
  const byKind = Object.fromEntries(categories.map(c => [c.key, {
    hotelRecords: dataset.hotels.filter(h => h.nearbyPlaces.some(p => p.kind === c.key)).length,
    withinDefaultRadius: dataset.hotels.filter(h => h.nearbyPlaces.some(p => p.kind === c.key && p.meters <= c.defaultMaxMeters)).length,
    defaultMaxMeters: c.defaultMaxMeters,
  }]));
  const duplicateCandidates = duplicateHotelCandidates(dataset.hotels);
  await writeFile(`${root}/quality.json`, `${JSON.stringify({ ...dataset.coverage, byKind, lodgingTypeCounts: Object.fromEntries([...lodgingTypes].map(type => [type, dataset.hotels.filter(h => h.lodgingType === type).length])), duplicateAudit: { method: "Same NFKC lowercase letter/digit-only name within 100 m; candidates retained, not automatically merged. No translation or identity verification.", candidatePairs: duplicateCandidates.length, candidates: duplicateCandidates }, unknownRoomHotels: dataset.hotels.filter(h => !h.rooms.some(r => r.evidenceStatus === "verified")).length, hotelsWithOfficialCategories: dataset.hotels.filter(h => h.rooms.some(r => r.evidenceStatus === "verified")).length, officialCategoryCount: dataset.hotels.reduce((n, h) => n + h.rooms.filter(r => r.evidenceStatus === "verified").length, 0), unnamedNewLodgings: dataset.hotels.filter(h => h.name.startsWith("Объект размещения ·")).length }, null, 2)}\n`);
  console.log(JSON.stringify(dataset.coverage.counts));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  prepareBusan().catch(error => { console.error(error); process.exitCode = 1; });
