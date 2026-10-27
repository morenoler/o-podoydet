import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256, validateOverpass, type OverpassResponse, type SnapshotManifest } from "./fetch-busan";

export const SOCHI_BOUNDARY = 365233;
export const boundaryQuery = `[out:json][timeout:45];rel(${SOCHI_BOUNDARY});out tags;out count;`;
export const SOCHI_AREA = 3600000000 + SOCHI_BOUNDARY;
export const lodgingQuery = `[out:json][timeout:90];nwr(area:${SOCHI_AREA})[tourism~"^(hotel|motel|guest_house|hostel|apartment)$"];out body center;out count;`;
export const placesQuery = `[out:json][timeout:90];(nwr(area:${SOCHI_AREA})[amenity~"^(cafe|restaurant|pharmacy)$"];nwr(area:${SOCHI_AREA})[shop~"^(supermarket|convenience|mall)$"];nwr(area:${SOCHI_AREA})[leisure=park];nwr(area:${SOCHI_AREA})[tourism=museum];nwr(area:${SOCHI_AREA})[natural=beach];nwr(area:${SOCHI_AREA})[railway=station];);out body center;out count;`;

/** Explicit, sequential, bounded HTTP collection. Cached source bytes are immutable. */
export async function fetchSochi(args = process.argv.slice(2)): Promise<void> {
  if (!args.includes("--fetch")) throw new Error("Network collection requires --fetch; offline build: scripts/prepare-sochi.ts");
  if (args.includes("--refresh")) throw new Error("Preserve this snapshot; use a new reviewed directory for a refresh");
  const endpoint = args.find(a => a.startsWith("--endpoint="))?.slice(11) ?? "https://overpass-api.de/api/interpreter";
  const post = args.includes("--post");
  if (!endpoint.startsWith("https://")) throw new Error("HTTPS endpoint required");
  const root = "data/sochi";
  await mkdir(`${root}/raw`, { recursive: true });
  let manifest: SnapshotManifest;
  try { manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    manifest = { schemaVersion: 1, endpoint, boundaryRelationId: SOCHI_BOUNDARY, license: "ODbL-1.0", attribution: "© OpenStreetMap contributors", entries: {} };
  }
  const saveManifest = () => writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  async function step(key: string, query: string): Promise<OverpassResponse> {
    const cached = manifest.entries[key];
    if (cached) {
      if (cached.query !== query) throw new Error(`Cached ${key} query differs; do not overwrite source snapshots`);
      const bytes = await readFile(`${root}/${cached.path}`);
      if (sha256(bytes) !== cached.sha256 || bytes.byteLength !== cached.bytes) throw new Error(`Invalid cached ${key} SHA-256/size`);
      const raw = validateOverpass(JSON.parse(bytes.toString("utf8")));
      if (raw.elements.length - 1 !== cached.count) throw new Error(`Cached ${key} count mismatch`);
      console.log(`${key}: ${cached.count} objects (preserved cache)`);
      return raw;
    }
    const url = post ? endpoint : `${endpoint}?data=${encodeURIComponent(query)}`;
    console.log(`Fetching ${key} sequentially from ${new URL(endpoint).hostname}`);
    const response = await fetch(url, { method: post ? "POST" : "GET", ...(post ? { body: new URLSearchParams({ data: query }) } : {}), signal: AbortSignal.timeout(110000), headers: {
      Accept: "application/json", "User-Agent": "O-Podoydet/0.3 (educational Sochi catalog; https://github.com/morenoler/o-podoydet)",
    } });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("json")) throw new Error(`${key}: HTTP ${response.status}, ${contentType}; stopped without retry`);
    const cap = 20 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > cap) throw new Error("Response exceeds 20 MiB cap");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing response body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > cap) { await reader.cancel(); throw new Error("Response exceeds 20 MiB cap"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    const raw = validateOverpass(JSON.parse(bytes.toString("utf8")));
    if (!raw.osm3s.timestamp_osm_base || !Number.isFinite(Date.parse(raw.osm3s.timestamp_osm_base))) throw new Error("Missing OSM database date");
    const hash = sha256(bytes), path = `raw/${key}-${hash.slice(0, 16)}.json`;
    await writeFile(`${root}/${path}`, bytes, { flag: "wx" });
    manifest.entries[key] = {
      path, query, url, method: post ? "POST" : "GET", receivedAt: new Date().toISOString(), httpStatus: response.status,
      contentType, sha256: hash, bytes: size, osmBaseDate: raw.osm3s.timestamp_osm_base,
      areaBaseDate: raw.osm3s.timestamp_areas_base, count: raw.elements.length - 1,
      validation: "http-json-no-remark-count-checked",
    };
    await saveManifest();
    console.log(`${key}: ${raw.elements.length - 1} objects, exact HTTP bytes saved`);
    return raw;
  }
  const boundary = await step("boundary", boundaryQuery);
  const rels = boundary.elements.filter(e => e.type === "relation");
  if (rels.length !== 1 || rels[0].id !== SOCHI_BOUNDARY || rels[0].tags?.admin_level !== "6"
      || !rels[0].tags?.name?.includes("Сочи")) throw new Error("Expected Sochi municipal administrative boundary");
  await step("lodgings", lodgingQuery);
  // Build/check a five-record pilot before collecting the additional POI layer.
  if (args.includes("--lodgings-only")) return;
  await step("places", placesQuery);
  await saveManifest();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  fetchSochi().catch(error => { console.error(error); process.exitCode = 1; });
