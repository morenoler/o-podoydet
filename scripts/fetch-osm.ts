import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { OsmElement } from "../shared/geo";

// A bounded snapshot, not a dependency of application startup.
const regionKey = "busan-haeundae";
const bbox = "35.150,129.145,35.175,129.180";
const coreTiles = [
  "129.145,35.150,129.1625,35.1625", "129.1625,35.150,129.180,35.1625",
  "129.145,35.1625,129.1625,35.175", "129.1625,35.1625,129.180,35.175",
];
// A one-time, bounded fallback when the public Overpass instances are unavailable.
// The application itself never queries the editing API. Preserve the cached extract.
async function fetchCoreSnapshot() {
  const merged = new Map<string, OsmElement>();
  const fetchedDates: string[] = [];
  for (const [index, tile] of coreTiles.entries()) {
    const path = `data/osm-${regionKey}-api-tile-${index + 1}.json`;
    const sourceUrl = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${tile}`;
    let raw: { elements: OsmElement[]; fetchedAt?: string };
    try { raw = JSON.parse(await readFile(path, "utf8")); }
    catch {
      const response = await fetch(sourceUrl, { headers: { "User-Agent": "O-Podoydet-MVP/0.1 (bounded educational snapshot)" }, signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`OSM API tile ${index + 1}: HTTP ${response.status}`);
      raw = await response.json() as typeof raw;
      raw.fetchedAt = new Date().toISOString();
    }
    if (!Array.isArray(raw.elements)) throw new Error(`Invalid OSM API tile ${index + 1}`);
    const fetchedAt = raw.fetchedAt || (await stat(path)).mtime.toISOString();
    fetchedDates.push(fetchedAt);
    // Contributor account metadata is not needed for route calculations.
    const elements = raw.elements.map(({ type, id, lat, lon, nodes, tags }) => ({ type, id, lat, lon, nodes, tags }));
    await writeFile(path, JSON.stringify({ sourceUrl, fetchedAt, license: "ODbL-1.0", elements }));
    for (const e of elements) merged.set(`${e.type}-${e.id}`, e);
    console.log(`OSM API tile ${index + 1}: ${elements.length} objects (cached)`);
  }
  const nodes = new Map([...merged.values()].filter(e => e.type === "node").map(e => [e.id, e]));
  const elements: OsmElement[] = [];
  for (const e of merged.values()) {
    const t = e.tags || {};
    const needed = t.highway || t.entrance || t.barrier || t.foot || t.access || t.tourism === "hotel" || t.railway === "rail" || ["beach", "coastline"].includes(t.natural || "") || ["bar", "pub", "nightclub"].includes(t.amenity || "");
    if (!needed) continue;
    if (e.type === "way" && e.nodes) {
      const geometry = e.nodes.map(id => nodes.get(id));
      if (geometry.some(n => n?.lat === undefined || n.lon === undefined)) continue;
      elements.push({ ...e, geometry: geometry.map(n => ({ lat: n!.lat!, lon: n!.lon! })) });
    } else if (e.type === "node") elements.push(e);
  }
  const sourceDate = fetchedDates.sort()[0];
  await writeFile(`data/osm-${regionKey}-snapshot.json`, JSON.stringify({
    regionKey, bbox, fetchedAt: sourceDate, endpoint: "https://api.openstreetmap.org/api/0.6/map.json",
    sourceUrls: coreTiles.map(t => `https://api.openstreetmap.org/api/0.6/map.json?bbox=${t}`),
    license: "ODbL-1.0", attribution: "© OpenStreetMap contributors", sourceDate, elements,
  }));
  console.log(`Saved ${elements.length} real Busan / Haeundae OSM objects.`);
}

await mkdir("data", { recursive: true });
const coreCachePresent = await Promise.all(coreTiles.map((_, i) => stat(`data/osm-${regionKey}-api-tile-${i + 1}.json`).then(() => true, () => false)));
if (process.argv.includes("--osm-api") || coreCachePresent.every(Boolean)) {
  await fetchCoreSnapshot();
  process.exit(0);
}
const parts = [
  `nwr[tourism=hotel](${bbox});`,
  ...[
    "35.150,129.145,35.1625,129.1625",
    "35.150,129.1625,35.1625,129.180",
    "35.1625,129.145,35.175,129.1625",
    "35.1625,129.1625,35.175,129.180",
  ].map((b) => `way[highway](${b});`),
  `(way[natural=beach](${bbox});way[natural=coastline](${bbox}););`,
  `(way[railway=rail](${bbox});nwr[amenity=bar](${bbox});nwr[amenity=pub](${bbox});nwr[amenity=nightclub](${bbox}););`,
  `(node[entrance](${bbox});node[highway=crossing](${bbox});node[barrier](${bbox}););`,
];
// Public instances listed at https://wiki.openstreetmap.org/wiki/Overpass_API.
// Sequential requests and per-query cache keep this one-time extract small.
const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
await mkdir("data", { recursive: true });
let success = false;
for (const endpoint of endpoints) {
  try {
    console.log(
      `Fetching bounded Busan / Haeundae snapshot from ${new URL(endpoint).host}`,
    );
    const elements = new Map<string, unknown>();
    const queries: string[] = [];
    let osm3s: unknown;
    const sourceDates: string[] = [];
    for (const [i, part] of parts.entries()) {
      const query = `[out:json][timeout:25];${part}out body geom;`;
      queries.push(query);
      const cachePath = `data/osm-${regionKey}-part-${createHash("sha256").update(query).digest("hex").slice(0, 10)}.json`;
      let raw: {
        elements?: { type: string; id: number }[];
        remark?: string;
        osm3s: unknown;
      };
      try {
        raw = JSON.parse(await readFile(cachePath, "utf8"));
      } catch {
        const response = await fetch(
          endpoint + "?data=" + encodeURIComponent(query),
          {
            headers: {
              "User-Agent":
                "O-Podoydet-MVP/0.1 (bounded educational OSM snapshot)",
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(60000),
          },
        );
        if (!response.ok)
          throw new Error(`Part ${i + 1}: HTTP ${response.status}`);
        raw = (await response.json()) as typeof raw;
        if (raw.elements && !raw.remark)
          await writeFile(cachePath, JSON.stringify(raw));
      }
      if (!raw.elements || raw.remark)
        throw new Error(raw.remark || "Invalid snapshot");
      for (const e of raw.elements) elements.set(`${e.type}-${e.id}`, e);
      osm3s = raw.osm3s;
      const sourceDate = (raw.osm3s as { timestamp_osm_base?: string })
        ?.timestamp_osm_base;
      if (sourceDate) sourceDates.push(sourceDate);
      console.log(`Part ${i + 1}: ${raw.elements.length} objects`);
    }
    // Cached queries can originate from different public instances and base dates.
    // Use the oldest base date to avoid overstating freshness of the merged extract.
    if (sourceDates.length)
      osm3s = { timestamp_osm_base: sourceDates.sort()[0] };
    await writeFile(
      `data/osm-${regionKey}-snapshot.json`,
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        regionKey,
        endpoint,
        cacheMayIncludeOtherInstances: true,
        bbox,
        queries,
        license: "ODbL-1.0",
        attribution: "© OpenStreetMap contributors",
        osm3s,
        elements: [...elements.values()],
      }),
    );
    console.log(`Saved ${elements.size} OSM objects.`);
    success = true;
    break;
  } catch (error) {
    console.error(String(error));
  }
}
if (!success) process.exitCode = 1;
