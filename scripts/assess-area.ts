import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  envelope,
  fetchAirSource,
  parseAirSource,
  sha256,
  MAX_AIR_RESPONSE_BYTES,
  type AirSourceEnvelope,
} from "./air-source";
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
      "--source-archive",
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
    if (!h || typeof h !== "object") {
      skipped.push({
        hotelId: "unknown",
        reason: "Запись объекта не является JSON-объектом.",
      });
      continue;
    }
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
const usedSources = new Map<string, AirSourceEnvelope>();
function normalizeSource(
  source: AirSourceEnvelope,
  target: AreaTarget,
  checkedAt: Date,
) {
  usedSources.set(source.requestUrl, source);
  return {
    ...normalizeAir(
      JSON.parse(source.body), source.fetchedAt, source.requestUrl,
      checkedAt, target.coordinates,
    ),
    sourceSnapshot: {
      sha256: source.sha256,
      byteLength: Buffer.byteLength(source.body),
      requestUrl: source.requestUrl,
      fetchedAt: source.fetchedAt,
    },
  };
}
async function airFor(target: AreaTarget): Promise<AirQualityAssessment> {
  const url = airRequestUrl(target.coordinates);
  if (offline) {
    const item = offline.responses?.[target.hotelId];
    return item
      ? normalizeSource(
          envelope(JSON.stringify(item.response), url, item.fetchedAt), target, now,
        )
      : unknownAir("Нет ответа для этой точки в offline-файле.", url);
  }
  const key = createHash("sha256").update(url).digest("hex");
  const path = resolve(cacheDir, `${key}.json`);
  let cached: AirSourceEnvelope | undefined;
  try {
    if ((await stat(path)).size > 2 * MAX_AIR_RESPONSE_BYTES)
      throw new Error("Air cache envelope exceeds limit");
    cached = parseAirSource(JSON.parse(await readFile(path, "utf8")), url);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.warn(
        `${target.hotelId}: rejected unverified cache: ${error instanceof Error ? error.message : error}`,
      );
  }
  if (
    cached &&
    !options.has("--refresh") &&
    Date.parse(cached.fetchedAt) <= +now &&
    +now - Date.parse(cached.fetchedAt) < 3 * 3600000
  )
    return normalizeSource(cached, target, new Date());
  try {
    const source = await fetchAirSource(url);
    const result = normalizeSource(source, target, new Date());
    if (result.status === "unknown" && result.forecast.status === "unknown")
      throw new Error(result.error || "Invalid source response");
    await writeFile(path, JSON.stringify(source));
    return result;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Не удалось получить данные";
    if (cached) {
      const result = normalizeSource(cached, target, new Date());
      return {
        ...result,
        status: result.status === "unknown" ? "unknown" : "stale",
        error: `Обновление не удалось: ${reason}`,
        forecast: {
          ...result.forecast,
          status: result.forecast.status === "unknown" ? "unknown" : "stale",
          error: `Обновление прогноза не удалось: ${reason}`,
          limitations: [
            ...result.forecast.limitations,
            "Показан сохранённый прогноз без обновления времени получения.",
          ],
        },
        limitations: [
          ...result.limitations,
          "Показан прежний кеш; повторный запрос не обновляет дату доказательства.",
        ],
      };
    }
    return unknownAir(`Источник недоступен: ${reason}`, url);
  }
}
const assessments: AreaAssessmentFile["assessments"] = new Array(targets.length);
for (let index = 0; index < targets.length; index++) {
  const target = targets[index];
  const air = await airFor(target);
  assessments[index] = makeAssessment(
    target, air, records, offline ? now : new Date(),
  );
  console.log(
    `${target.hotelId}: air=${air.status}; forecast=${air.forecast.status} (${air.forecast.hourly.length} h); safety=${assessments[index].safety.status}`,
  );
  if (!offline && index + 1 < targets.length)
    await new Promise((accept) => setTimeout(accept, 200));
}
const result: AreaAssessmentFile = {
  version: 1,
  generatedAt: (offline ? now : new Date()).toISOString(),
  ...(region ? { region } : {}),
  assessments,
  skipped,
};
if (options.has("--source-archive")) {
  const archivePath = resolve(options.get("--source-archive")!);
  const packed = gzipSync(JSON.stringify({
    version: 1,
    generatedAt: result.generatedAt,
    synthetic: Boolean(offline),
    sources: [...usedSources.values()],
  }));
  await mkdir(dirname(archivePath), { recursive: true });
  await writeFile(archivePath, packed);
  result.sourceArchive = {
    path: options.get("--source-archive")!,
    sha256: sha256(packed),
    entryCount: usedSources.size,
  };
}
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
