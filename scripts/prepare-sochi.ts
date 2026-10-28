import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Dataset, Hotel, NearbyPlace, Point } from "../shared/types";
import { sha256, validateOverpass, type OsmElement, type OverpassResponse, type SnapshotManifest } from "./fetch-busan";
import { SOCHI_BOUNDARY, boundaryQuery } from "./fetch-sochi";
import { coordinates, duplicateHotelCandidates, haversineMeters, inactive, matchesSelector, type PlaceCategory } from "./prepare-busan";

const expiry = (date: string) => new Date(Date.parse(date) + 30 * 86400000).toISOString();
const identity = (e: OsmElement) => `${e.type}/${e.id}`;
const lodgingTypes = ["hotel", "motel", "guest_house", "hostel", "apartment"] as const;
const nameOf = (e: OsmElement) => (e.tags?.["name:ru"] || e.tags?.name || e.tags?.["name:en"] || "").trim();
const nonNames = /^(?:гостиница|отель|гостевой дом|апартаменты|хостел|hotel|hostel|guest house|apartment|без названия)$/i;
const inBounds = (p: Point, b: Dataset["bbox"]) => p[0] >= b[0] && p[1] >= b[1] && p[0] <= b[2] && p[1] <= b[3];

/** Representative OSM coordinates, never an entrance or a pedestrian route. */
export function nearbyForSochi(hotel: Hotel, places: OsmElement[], categories: PlaceCategory[], receivedAt: string): NearbyPlace[] {
  if (!hotel.coordinates) return [];
  return categories.flatMap(category => {
    const matches = places.filter(e => e.type !== "count" && !inactive(e) && coordinates(e)
      && !["private", "no"].includes(e.tags?.access ?? "")
      && category.osmQueries.some(q => matchesSelector(e.tags ?? {}, q)))
      .map(e => ({ e, point: coordinates(e)!, meters: haversineMeters(hotel.coordinates!, coordinates(e)!) }))
      .sort((a, b) => a.meters - b.meters || identity(a.e).localeCompare(identity(b.e)));
    if (!matches.length) return [];
    const { e, point, meters } = matches[0];
    return [{ kind: category.key, name: nameOf(e) || `${category.label} · OSM ${identity(e)}`,
      meters: Math.ceil(meters), coordinates: point, sourceUrl: `https://www.openstreetmap.org/${identity(e)}`,
      osmId: identity(e), obtainedAt: receivedAt, ...(e.timestamp ? { sourceDate: e.timestamp } : {}),
      expiresAt: expiry(receivedAt), method: "haversine-osm-v1", status: "supported", scope: "hotel_surroundings" }];
  });
}

export function prepareSochiDataset(boundary: OverpassResponse, lodgings: OverpassResponse,
  places: OverpassResponse | undefined, manifest: SnapshotManifest, categories: PlaceCategory[], stage: "pilot" | "expanded" = "expanded") {
  const key = "lodgings";
  const entry = manifest.entries[key];
  const relation = boundary.elements.find(e => e.type === "relation" && e.id === SOCHI_BOUNDARY);
  if (manifest.boundaryRelationId !== SOCHI_BOUNDARY || !relation
      || relation.tags?.admin_level !== "6" || !relation.tags?.name?.includes("Сочи")) throw new Error("Sochi boundary identity missing");
  if (!entry || !Number.isFinite(Date.parse(entry.receivedAt))) throw new Error("Lodging provenance missing");
  // Display extent is derived from saved representatives. Area membership comes
  // from the Overpass area query, not an invented rectangular city boundary.
  const points = lodgings.elements.map(coordinates).filter((p): p is Point => p !== null);
  if (!points.length) throw new Error("No valid lodging coordinates");
  const bbox: Dataset["bbox"] = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
  const exclusions: { osmId: string; reason: string }[] = [];
  const hotels: Hotel[] = [];
  for (const e of lodgings.elements) {
    if (e.type === "count") continue;
    const point = coordinates(e), t = e.tags ?? {}, name = nameOf(e);
    if (!lodgingTypes.includes(t.tourism as typeof lodgingTypes[number])) throw new Error(`Unexpected lodging type ${identity(e)}`);
    let reason: string | undefined;
    if (inactive(e)) reason = "inactive lifecycle tag";
    else if (!point || !inBounds(point, bbox)) reason = "missing/out-of-bounds representative coordinates";
    else if (!name || nonNames.test(name)) reason = "missing or generic name; identity unresolved";
    if (reason) { exclusions.push({ osmId: identity(e), reason }); continue; }
    const hotel: Hotel = {
      id: `${e.type}-${e.id}`, name, lodgingType: t.tourism as Hotel["lodgingType"],
      address: ["Сочи", t["addr:suburb"] || t["addr:district"], t["addr:street"] || t["addr:place"], t["addr:housenumber"]].filter(Boolean).join(", "),
      coordinates: point!, osmUrl: `https://www.openstreetmap.org/${identity(e)}`,
      rooms: [], route: null, noise: [], hasCollectedRoomCategories: false,
      sourceEvidence: { sourceUrl: `https://www.openstreetmap.org/${identity(e)}`, obtainedAt: entry.receivedAt,
        ...(e.timestamp ? { sourceDate: e.timestamp } : {}), expiresAt: expiry(entry.receivedAt), method: "osm", status: "reported" },
      dataNotes: ["Запись OpenStreetMap в границах городского округа Сочи; действующая работа на месте не проверена.",
        "Точка на карте не подтверждает вход. Категории, вместимость, цены, наличие, доступность и тишина неизвестны.",
        "Расстояния до мест рассчитаны по прямой между точками/центрами объектов OSM; путь, часы работы и доступ к воде не проверены."],
    };
    hotel.nearbyPlaces = places ? nearbyForSochi(hotel, places.elements, categories, manifest.entries.places.receivedAt) : [];
    hotels.push(hotel);
  }
  if (!hotels.length) throw new Error("No named eligible Sochi lodgings");
  hotels.sort((a, b) => a.id.localeCompare(b.id, "en"));
  const eligibleRecords = hotels.length;
  if (stage === "pilot") hotels.splice(5);
  return {
    evidencePolicy: "verified-only" as const, region: "Сочи", fetchedAt: entry.receivedAt,
    // This date is the OSM database snapshot date, NOT the update/check date of each hotel.
    sourceDate: entry.osmBaseDate ?? "", attribution: "© OpenStreetMap contributors · ODbL-1.0",
    bbox, hotels, facts: [], map: [],
    coverage: { stage, boundaryRelationId: SOCHI_BOUNDARY, sourceUrl: `https://www.openstreetmap.org/relation/${SOCHI_BOUNDARY}`,
      area: "Городской округ Сочи по административной границе OSM; Сириус не включён в запрос этой территории.",
      sourceMethod: "Overpass area selection; named active tourism records; node positions or way/relation bbox centers",
      bboxSemantics: "Display extent of saved lodging representative coordinates, not the administrative boundary polygon",
      recordScope: "hotel_identity_and_representative_location", algorithm: "sochi-catalog-v1",
      sourceDateSemantics: "Dataset.sourceDate is the database snapshot date; absent hotel sourceEvidence.sourceDate means unknown element update date.",
      distanceAlgorithm: "haversine-osm-v1", distanceModel: "Great-circle distance, radius 6371008.8 m, rounded up; no walking graph.",
      requestedLodgingTypes: [...lodgingTypes], obtainedAt: entry.receivedAt, expiresAt: expiry(entry.receivedAt),
      unknownFields: ["physical_rooms", "room_categories", "capacity", "price", "date_availability", "hotel_entrance", "walking_route", "step_free_access", "room_noise", "city_center_reference"],
      counts: { sourceLodgingRecords: lodgings.elements.filter(e => e.type !== "count").length, eligibleRecords, catalogRecords: hotels.length, excludedRecords: exclusions.length,
        namedHotelRecords: hotels.filter(h => h.lodgingType === "hotel").length, sourcePlaces: places ? places.elements.filter(e => e.type !== "count").length : 0,
        roomCategories: 0, calculatedWalkingRoutes: 0, prices: 0, fieldVerifiedHotels: 0 },
      exclusions,
      limitations: ["OSM records are not independently verified operating businesses; completeness against the real market is unknown.",
        "Different OSM IDs may represent the same business. Duplicate candidates are reported, not merged without evidence.",
        "Nearby coverage excludes unmapped places and places outside the source collection area; nearest means nearest in this saved set.",
        "No selected city-center reference or subway evidence; missing evidence does not imply absence.",
        "The pilot includes the first five eligible records by sorted OSM ID; it is not a representative field sample."],
    },
  };
}

/** Load the pre-existing 24 October snapshot without altering its bytes/dates.
 * Its final counter is for highway ways, so it must NOT use validateOverpass's
 * all-elements completion claim. Normalized arrays below are local derivatives.
 */
export async function loadPreservedSochi(root = "data/sochi") {
  const provenance = JSON.parse(await readFile(`${root}/preserved-manifest.json`, "utf8"));
  const meta = provenance.originalMetadata;
  const bytes = await readFile(`${root}/${provenance.path}`);
  const savedMeta = JSON.parse(await readFile(`${root}/${provenance.originalMetadataPath}`, "utf8"));
  if (JSON.stringify(meta) !== JSON.stringify(savedMeta) || sha256(bytes) !== meta.sha256 || bytes.byteLength !== meta.bytes)
    throw new Error("Preserved Sochi source SHA-256/size/provenance mismatch");
  const raw = JSON.parse(bytes.toString("utf8")) as OverpassResponse;
  if (!Array.isArray(raw.elements) || raw.remark || raw.osm3s.timestamp_osm_base !== meta.osm_base_timestamp)
    throw new Error("Invalid preserved Sochi response");
  const seen = new Set<string>();
  for (const e of raw.elements.filter(e => e.type !== "count")) {
    if (!["node", "way", "relation"].includes(e.type) || !Number.isSafeInteger(e.id) || (e.id ?? 0) <= 0 || seen.has(identity(e)))
      throw new Error("Invalid/duplicate preserved identity");
    seen.add(identity(e));
    if (e.tags?.tourism !== "hotel" && e.tags?.natural !== "beach") throw new Error("Unexpected preserved element category");
  }
  if (raw.elements.filter(e => e.type === "count").length !== 1 || raw.elements.at(-1)?.type !== "count")
    throw new Error("Missing original pedestrian-way counter");
  const lodgings: OverpassResponse = { osm3s: raw.osm3s, elements: raw.elements.filter(e => e.tags?.tourism === "hotel") };
  const places: OverpassResponse = { osm3s: raw.osm3s, elements: raw.elements.filter(e => e.tags?.natural === "beach") };
  // Keep arrays count-free and pass their actual size into coverage below.
  const m = { boundaryRelationId: SOCHI_BOUNDARY, entries: {
    lodgings: { receivedAt: meta.retrieved_at, osmBaseDate: meta.osm_base_timestamp },
    places: { receivedAt: meta.retrieved_at, osmBaseDate: meta.osm_base_timestamp },
  } } as unknown as SnapshotManifest;
  const boundaryManifest: SnapshotManifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  const boundary = await loadSochiSnapshot(root, boundaryManifest, "boundary", boundaryQuery);
  return { provenance, lodgings, places, manifest: m, boundary };
}

export async function preservedSochiDataset(stage: "pilot" | "expanded" = "expanded", root = "data/sochi") {
  const loaded = await loadPreservedSochi(root);
  const categories: PlaceCategory[] = JSON.parse(await readFile(`${root}/place-categories.json`, "utf8"));
  const selection: { pilotSize: number; excludedIdentityConflicts: { id: string; reason: string; sourcePaths: string[] }[] } = JSON.parse(await readFile(`${root}/selection.json`, "utf8"));
  const result = prepareSochiDataset(loaded.boundary, loaded.lodgings,
    stage === "pilot" ? undefined : loaded.places, loaded.manifest, categories, "expanded");
  for (const conflict of selection.excludedIdentityConflicts) {
    const index = result.hotels.findIndex(h => h.id === conflict.id);
    if (index < 0) throw new Error(`Unresolved identity exclusion no longer matches source: ${conflict.id}`);
    result.hotels.splice(index, 1);
    result.coverage.exclusions.push({ osmId: conflict.id.replace("-", "/"), reason: conflict.reason });
  }
  result.coverage.stage = stage;
  result.coverage.counts.eligibleRecords = result.hotels.length;
  result.coverage.counts.excludedRecords = result.coverage.exclusions.length;
  if (stage === "pilot") result.hotels.splice(selection.pilotSize);
  result.coverage.counts.catalogRecords = result.hotels.length;
  result.coverage.counts.namedHotelRecords = result.hotels.length;
  const { coverage } = result;
  coverage.area = "Центральная прибрежная часть Сочи; ограниченный bbox сохранённого снимка, не весь городской округ";
  coverage.sourceMethod = "Preserved 2026-10-24 bbox snapshot; original SHA-256 checked; named OSM hotel records";
  coverage.counts.sourceLodgingRecords = loaded.lodgings.elements.length;
  coverage.counts.sourcePlaces = stage === "pilot" ? 0 : loaded.places.elements.length;
  coverage.requestedLodgingTypes = ["hotel"];
  coverage.unknownFields.push("citywide_coverage", "non_beach_nearby_places");
  coverage.limitations.unshift(loaded.provenance.completeness,
    "Citywide collection failed with HTTP 502/504/timeouts. This release uses the preserved central snapshot, not a complete Sochi catalog.");
  return { ...result, provenance: loaded.provenance, collectionScope: loaded.provenance.scope, selection };
}

export async function loadSochiSnapshot(root: string, manifest: SnapshotManifest, key: string, query: string): Promise<OverpassResponse> {
  const entry = manifest.entries[key];
  if (!entry || entry.query !== query || entry.httpStatus !== 200 || !entry.contentType.includes("json")) throw new Error(`Missing or incompatible ${key} manifest entry`);
  const bytes = await readFile(`${root}/${entry.path}`);
  if (sha256(bytes) !== entry.sha256 || bytes.byteLength !== entry.bytes) throw new Error(`${key} SHA-256/size mismatch`);
  const raw = validateOverpass(JSON.parse(bytes.toString("utf8")));
  if (raw.elements.length - 1 !== entry.count || raw.osm3s.timestamp_osm_base !== entry.osmBaseDate) throw new Error(`${key} metadata mismatch`);
  return raw;
}

export async function prepareSochi(args = process.argv.slice(2)): Promise<void> {
  const root = "data/sochi", stage = args.includes("--pilot") ? "pilot" : "expanded";
  const categories: PlaceCategory[] = JSON.parse(await readFile(`${root}/place-categories.json`, "utf8"));
  const dataset = await preservedSochiDataset(stage, root);
  const duplicates = duplicateHotelCandidates(dataset.hotels);
  const report = { ...dataset.coverage, lodgingTypeCounts: Object.fromEntries(lodgingTypes.map(kind => [kind, dataset.hotels.filter(h => h.lodgingType === kind).length])),
    byNearbyKind: Object.fromEntries(categories.map(c => [c.key, { defaultMaxMeters: c.defaultMaxMeters,
      recordsWithEvidence: dataset.hotels.filter(h => h.nearbyPlaces?.some(p => p.kind === c.key)).length,
      recordsWithinDefaultRadius: dataset.hotels.filter(h => h.nearbyPlaces?.some(p => p.kind === c.key && p.meters <= c.defaultMaxMeters)).length }])),
    duplicateAudit: { method: "NFKC/lowercase letters+digits same name within 100 m; candidates retained, not merged", candidatePairs: duplicates.length, candidates: duplicates },
    snapshotIntegrity: "Preserved source SHA-256, byte length, original metadata and element structure checked offline; its final counter measures pedestrian ways, not completeness of hotel/beach records",
  };
  await writeFile(`${root}/${stage === "pilot" ? "pilot" : "verified-hotels"}.json`, JSON.stringify(dataset));
  await writeFile(`${root}/${stage === "pilot" ? "pilot-quality" : "quality"}.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(dataset.coverage.counts));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  prepareSochi().catch(error => { console.error(error); process.exitCode = 1; });
