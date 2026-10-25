import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  airRequestUrl,
  normalizeAir,
  unknownAir,
  makeAssessment,
  coordinateSchema,
  officialImportSchema,
  type AreaTarget,
  type AreaAssessmentFile,
  type AirQualityAssessment,
} from "../shared/area";

// No API requests at app startup: this script prepares a dated, inspectable snapshot.
const args = process.argv.slice(2),
  options = new Map<string, string>();
const flags = new Set(["--refresh"]);
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (flags.has(key)) {
    options.set(key, "true");
    continue;
  }
  if (
    ![
      "--lat",
      "--lon",
      "--id",
      "--name",
      "--input",
      "--output",
      "--offline",
      "--safety",
      "--now",
    ].includes(key) ||
    !args[i + 1] ||
    args[i + 1].startsWith("--")
  )
    throw new Error(`Unknown/missing option ${key}`);
  options.set(key, args[++i]);
}
if (options.has("--now") && !options.has("--offline"))
  throw new Error("--now is only allowed with deterministic --offline input");
const now = options.has("--now") ? new Date(options.get("--now")!) : new Date();
if (!Number.isFinite(+now)) throw new Error("Invalid --now");
const single = options.has("--lat") || options.has("--lon");
let region: string | undefined;
const targets: AreaTarget[] = [],
  skipped: AreaAssessmentFile["skipped"] = [];
if (single) {
  if (!options.has("--lat") || !options.has("--lon"))
    throw new Error("Both --lat and --lon are required");
  targets.push({
    hotelId: options.get("--id") || "point",
    name: options.get("--name") || "Выбранная точка",
    coordinates: coordinateSchema.parse([
      Number(options.get("--lon")),
      Number(options.get("--lat")),
    ]),
  });
} else {
  const input = JSON.parse(
    await readFile(options.get("--input") || "data/demo.json", "utf8"),
  );
  if (!Array.isArray(input.hotels)) throw new Error("Expected hotels array");
  region = typeof input.region === "string" ? input.region : undefined;
  for (const h of input.hotels) {
    const coords = coordinateSchema.safeParse(h.coordinates);
    if (
      typeof h.id !== "string" ||
      !h.id ||
      typeof h.name !== "string" ||
      !coords.success
    ) {
      skipped.push({
        hotelId: String(h.id ?? "unknown"),
        reason: "Отсутствуют корректные id, название или координаты.",
      });
      continue;
    }
    if (targets.some((t) => t.hotelId === h.id)) {
      skipped.push({ hotelId: h.id, reason: "Повторный идентификатор." });
      continue;
    }
    targets.push({ hotelId: h.id, name: h.name, coordinates: coords.data });
  }
}
let safetyText: string | undefined;
try {
  safetyText = await readFile(
    options.get("--safety") || "data/official-safety-evidence.json",
    "utf8",
  );
} catch (error) {
  if (
    options.has("--safety") ||
    (error as NodeJS.ErrnoException).code !== "ENOENT"
  )
    throw error;
}
const records = safetyText
  ? officialImportSchema.parse(JSON.parse(safetyText)).records
  : [];
// Explicit keyed input prevents accidentally reusing one point's data for every hotel.
const offline = options.has("--offline")
  ? (JSON.parse(await readFile(options.get("--offline")!, "utf8")) as {
      responses?: Record<string, { fetchedAt: string; response: unknown }>;
    })
  : null;
if (offline && !offline.responses)
  throw new Error("Offline JSON must contain responses keyed by hotel ID");
const cacheDir = resolve(".local/area-cache");
await mkdir(cacheDir, { recursive: true });
async function airFor(target: AreaTarget): Promise<AirQualityAssessment> {
  const url = airRequestUrl(target.coordinates);
  if (offline) {
    const item = offline.responses?.[target.hotelId];
    return item
      ? normalizeAir(
          item.response,
          item.fetchedAt,
          url,
          now,
          target.coordinates,
        )
      : unknownAir("Нет ответа для этой точки в offline-файле.", url);
  }
  const key = createHash("sha256").update(url).digest("hex");
  const path = resolve(cacheDir, `${key}.json`);
  let cached: { fetchedAt: string; response: unknown } | undefined;
  try {
    cached = JSON.parse(await readFile(path, "utf8"));
  } catch {
    /* cache miss or corrupt cache */
  }
  if (
    cached &&
    !options.has("--refresh") &&
    Date.parse(cached.fetchedAt) <= +now &&
    +now - Date.parse(cached.fetchedAt) < 3 * 3600000
  )
    return normalizeAir(
      cached.response,
      cached.fetchedAt,
      url,
      now,
      target.coordinates,
    );
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    const fetchedAt = new Date().toISOString();
    const result = normalizeAir(
      raw,
      fetchedAt,
      url,
      new Date(),
      target.coordinates,
    );
    if (result.status === "unknown")
      throw new Error(result.error || "Invalid source response");
    await writeFile(path, JSON.stringify({ fetchedAt, response: raw }));
    return result;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Не удалось получить данные";
    if (cached) {
      const result = normalizeAir(
        cached.response,
        cached.fetchedAt,
        url,
        new Date(),
        target.coordinates,
      );
      return {
        ...result,
        status: result.status === "unknown" ? "unknown" : "stale",
        error: `Обновление не удалось: ${reason}`,
        limitations: [
          ...result.limitations,
          "Показан прежний кеш; повторный запрос не обновляет дату доказательства.",
        ],
      };
    }
    return unknownAir(`Источник недоступен: ${reason}`, url);
  }
}
const assessments: AreaAssessmentFile["assessments"] = new Array(
  targets.length,
);
let cursor = 0;
await Promise.all(
  Array.from({ length: Math.min(3, targets.length) }, async () => {
    while (cursor < targets.length) {
      const index = cursor++,
        target = targets[index];
      const air = await airFor(target);
      assessments[index] = makeAssessment(target, air, records, now);
      console.log(
        `${target.hotelId}: air=${air.status}; safety=${assessments[index].safety.status}`,
      );
    }
  }),
);
const result: AreaAssessmentFile = {
  version: 1,
  generatedAt: now.toISOString(),
  ...(region ? { region } : {}),
  assessments,
  skipped,
};
const output = resolve(
  options.get("--output") ||
    (single ? ".local/area-single.json" : "data/area-assessments.json"),
);
await mkdir(dirname(output), { recursive: true });
// Build the entire result before writing; Windows sandbox can prohibit rename.
await writeFile(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      output,
      assessments: assessments.length,
      skipped: skipped.length,
      unknownAir: assessments.filter((a) => a.airQuality.status === "unknown")
        .length,
    },
    null,
    2,
  ),
);
