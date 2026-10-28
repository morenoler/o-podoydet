import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface OsmElement {
  type: "node" | "way" | "relation" | "count";
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags?: Record<string, string>;
  timestamp?: string;
  /** Added only to the offline merge; exact responses remain unmodified. */
  obtainedAt?: string;
}
export interface OverpassResponse {
  elements: OsmElement[];
  remark?: string;
  osm3s: { timestamp_osm_base?: string; timestamp_areas_base?: string; copyright?: string };
  /** Derived quality annotations, never written over an exact HTTP response. */
  conflicts?: { osmId: string; reason: string; comparedSourcePaths: string[] }[];
  precisionEquivalentPlaces?: string[];
}
export interface SnapshotManifest {
  schemaVersion: 1;
  endpoint: string;
  license: "ODbL-1.0";
  attribution: string;
  boundaryRelationId: number;
  collections?: { places: string[] };
  /** Optional offline regional PBF derivative; kept distinct from HTTP responses. */
  regionalPlacesManifest?: string;
  placesScope?: { kind: "boundary-bounding-box" | "bounded-subset"; bbox: [number, number, number, number]; bboxOrder: "west,south,east,north"; includesNeighboringMunicipalities: boolean; requestedCategories?: string[] };
  entries: Record<string, {
    path: string; query: string; url: string; method: "GET" | "POST"; receivedAt: string;
    httpStatus: number; contentType: string; sha256: string; bytes: number;
    osmBaseDate?: string; areaBaseDate?: string; count: number;
    validation: "http-json-no-remark-count-checked";
  }>;
}
export const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

/** A successful HTTP status alone does not establish a complete Overpass response. */
export function validateOverpass(value: unknown): OverpassResponse {
  const raw = value as OverpassResponse;
  if (!raw || !Array.isArray(raw.elements) || !raw.osm3s || raw.remark)
    throw new Error(`Invalid or incomplete Overpass response${raw?.remark ? `: ${raw.remark}` : ""}`);
  const counters = raw.elements.filter(e => e.type === "count");
  if (counters.length !== 1 || raw.elements.at(-1)?.type !== "count") throw new Error("Missing final completion counter");
  const elements = raw.elements.filter(e => e.type !== "count");
  if (Number(counters[0].tags?.total) !== elements.length) throw new Error("Overpass count mismatch");
  const seen = new Set<string>();
  for (const element of elements) {
    const key = `${element.type}/${element.id}`;
    if (!["node", "way", "relation"].includes(element.type) || !Number.isSafeInteger(element.id) || (element.id ?? 0) <= 0 || seen.has(key))
      throw new Error("Invalid or duplicate OSM identity");
    seen.add(key);
  }
  for (const type of ["node", "way", "relation"] as const) {
    if (Number(counters[0].tags?.[`${type}s`]) !== elements.filter(e => e.type === type).length)
      throw new Error(`Overpass ${type} count mismatch`);
  }
  return raw;
}

const boundaryQuery = '[out:json][timeout:45];rel["boundary"="administrative"]["ISO3166-2"="KR-26"];out tags bb;out count;';
export function lodgingQuery(relation: number): string {
  return `[out:json][timeout:90];rel(${relation});map_to_area->.busan;nwr(area.busan)[tourism~"^(hotel|motel|guest_house|hostel|apartment)$"];out body center;out count;`;
}
export function placeGroups(categories: { osmQueries: string[] }[]): Map<string, Set<string>> {
  const selectors = [...new Set(categories.flatMap(c => c.osmQueries))];
  // Query a small superset grouped by the first positive tag, then apply every
  // exact conjunction offline. E.g. all stations cover both train and subway.
  const groups = new Map<string, Set<string>>();
  for (const selector of selectors) {
    const match = /^\[([a-z_:]+)=([a-z_]+)\]/.exec(selector);
    if (!match) throw new Error(`Unsupported collection selector ${selector}`);
    const values = groups.get(match[1]) ?? new Set<string>();
    values.add(match[2]); groups.set(match[1], values);
  }
  return groups;
}
export function placesQuery(relation: number, categories: { osmQueries: string[] }[]): string {
  const grouped = [...placeGroups(categories)].map(([key, values]) => `nwr(area.busan)[${key}~"^(${[...values].join("|")})$"];`);
  return `[out:json][timeout:90];rel(${relation});map_to_area->.busan;(${grouped.join("")});out body center;out count;`;
}

/** Explicit collection only; default cache never refreshes or changes source bytes. */
export async function fetchBusan(args = process.argv.slice(2)): Promise<void> {
  if (!args.includes("--fetch")) throw new Error("Network collection is explicit: add --fetch. Offline build: scripts/prepare-busan.ts");
  const endpointArg = args.find(a => a.startsWith("--endpoint="));
  const post = args.includes("--post");
  const endpoint = endpointArg?.slice("--endpoint=".length) ?? "https://overpass-api.de/api/interpreter";
  if (!endpoint.startsWith("https://")) throw new Error("HTTPS endpoint required");
  const root = "data/busan";
  const manifestPath = `${root}/manifest.json`;
  await mkdir(`${root}/raw`, { recursive: true });
  let manifest: SnapshotManifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    manifest = { schemaVersion: 1, endpoint, license: "ODbL-1.0", attribution: "© OpenStreetMap contributors", boundaryRelationId: 0, entries: {} };
  }
  if (args.includes("--refresh")) throw new Error("Refresh must use a new snapshot directory and a reviewed manifest, never overwrite this saved snapshot");
  async function step(key: string, query: string): Promise<OverpassResponse> {
    const cached = manifest.entries[key];
    if (cached) {
      if (cached.query !== query) throw new Error(`Query changed for cached ${key}; preserve old snapshot and review a new version`);
      const bytes = await readFile(`${root}/${cached.path}`);
      if (sha256(bytes) !== cached.sha256) throw new Error(`SHA-256 mismatch for ${key}`);
      const raw = validateOverpass(JSON.parse(bytes.toString("utf8")));
      console.log(`${key}: ${cached.count} objects (unchanged cache)`);
      return raw;
    }
    const url = post ? endpoint : `${endpoint}?data=${encodeURIComponent(query)}`;
    console.log(`Fetching ${key} sequentially from ${new URL(endpoint).hostname}`);
    const response = await fetch(url, {
      method: post ? "POST" : "GET",
      ...(post ? { body: new URLSearchParams({ data: query }) } : {}),
      headers: { Accept: "application/json", "User-Agent": "O-Podoydet/0.3 (one-off educational Busan snapshot; https://github.com/morenoler/o-podoydet)" },
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`${key}: HTTP ${response.status}; stopped, no automatic retry or endpoint rotation`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) throw new Error(`${key}: unexpected Content-Type ${contentType}`);
    const maxBytes = 20 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("Response exceeds 20 MiB cap");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Response body missing");
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new Error("Response exceeds 20 MiB cap"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    const raw = validateOverpass(JSON.parse(bytes.toString("utf8")));
    const receivedAt = new Date().toISOString();
    const hash = sha256(bytes);
    const path = `raw/${key}-${hash.slice(0, 16)}.json`;
    await writeFile(`${root}/${path}`, bytes, { flag: "wx" });
    manifest.entries[key] = {
      path, query, url, method: post ? "POST" : "GET", receivedAt, httpStatus: response.status,
      contentType, sha256: hash, bytes: bytes.byteLength,
      osmBaseDate: raw.osm3s.timestamp_osm_base,
      areaBaseDate: raw.osm3s.timestamp_areas_base,
      count: raw.elements.length - 1,
      validation: "http-json-no-remark-count-checked",
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`${key}: ${raw.elements.length - 1} objects, saved exact response bytes`);
    return raw;
  }
  const boundary = await step("boundary", boundaryQuery);
  const relations = boundary.elements.filter(e => e.type === "relation");
  if (relations.length !== 1 || relations[0].tags?.["ISO3166-2"] !== "KR-26" || relations[0].tags?.admin_level !== "4")
    throw new Error("Expected exactly one Busan metropolitan administrative boundary (KR-26, admin_level=4)");
  manifest.boundaryRelationId = relations[0].id!;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await step("lodgings", lodgingQuery(manifest.boundaryRelationId));
  const categories = JSON.parse(await readFile(`${root}/place-categories.json`, "utf8"));
  const onlyArgument = args.find(a => a.startsWith("--only-places="));
  const requestedCategories = onlyArgument?.slice("--only-places=".length).split(",");
  if (requestedCategories?.some(key => !categories.some((c: { key: string }) => c.key === key))) throw new Error("Unknown --only-places category");
  const selectedCategories = requestedCategories ? categories.filter((c: { key: string }) => requestedCategories.includes(c.key)) : categories;
  const bounds = relations[0].bounds;
  if (!bounds) throw new Error("Boundary bounds required for bounded POI collection");
  const bboxArgument = args.find(a => a.startsWith("--poi-bbox="));
  const bbox = (bboxArgument ? bboxArgument.slice("--poi-bbox=".length).split(",").map(Number) : [bounds.minlat, bounds.minlon, bounds.maxlat, bounds.maxlon]) as [number, number, number, number];
  if (bbox.length !== 4 || bbox.some(n => !Number.isFinite(n)) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]
    || bbox[0] < bounds.minlat || bbox[1] < bounds.minlon || bbox[2] > bounds.maxlat || bbox[3] > bounds.maxlon) throw new Error("POI extent must lie within the administrative boundary bounding box");
  const placeKeys: string[] = [];
  for (const [key, values] of [...placeGroups(selectedCategories)].sort(([a], [b]) => (a === "railway" ? -1 : b === "railway" ? 1 : a.localeCompare(b)))) for (const value of values) {
    const query = `[out:json][timeout:45];nwr(${bbox.join(",")})[${key}=${value}];out body center;out count;`;
    const part = `places-${key}-${value}-${sha256(query).slice(0, 8)}`;
    await step(part, query);
    placeKeys.push(part);
  }
  manifest.collections = { places: placeKeys };
  manifest.placesScope = { kind: bboxArgument ? "bounded-subset" : "boundary-bounding-box", bbox: [bbox[1], bbox[0], bbox[3], bbox[2]], bboxOrder: "west,south,east,north", includesNeighboringMunicipalities: !bboxArgument, ...(requestedCategories ? { requestedCategories } : {}) };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  fetchBusan().catch(error => { console.error(error); process.exitCode = 1; });
