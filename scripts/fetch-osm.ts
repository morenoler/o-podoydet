import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// A bounded snapshot, not a dependency of application startup.
const bbox = "43.417,39.907,43.452,39.951";
const parts = [
  `nwr[tourism=hotel](${bbox});`,
  ...[
    "43.417,39.907,43.4345,39.929",
    "43.417,39.929,43.4345,39.951",
    "43.4345,39.907,43.452,39.929",
    "43.4345,39.929,43.452,39.951",
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
      `Fetching bounded Adler snapshot from ${new URL(endpoint).host}`,
    );
    const elements = new Map<string, unknown>();
    const queries: string[] = [];
    let osm3s: unknown;
    const sourceDates: string[] = [];
    for (const [i, part] of parts.entries()) {
      const query = `[out:json][timeout:25];${part}out body geom;`;
      queries.push(query);
      const cachePath = `data/osm-part-${createHash("sha256").update(query).digest("hex").slice(0, 10)}.json`;
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
            signal: AbortSignal.timeout(30000),
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
      "data/osm-snapshot.json",
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
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
