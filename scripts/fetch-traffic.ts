import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);
export const TRAFFIC_BBOX = [129.145, 35.15, 129.18, 35.175] as const;
export const TRAFFIC_YEAR = 2024;
export const TRAFFIC_PAGE =
  "https://viewt.ktdb.go.kr/cong/map/second_map.do?sendIp=2024";
const url = new URL("https://viewt.ktdb.go.kr/geoserver/wfs");
url.search = new URLSearchParams({
  service: "WFS",
  version: "1.0.0",
  request: "GetFeature",
  typeName: "Link_ObservedTrafficVolume_total_weekday",
  outputFormat: "application/json",
  srsname: "EPSG:4326",
  viewparams: `year:${TRAFFIC_YEAR}`,
  bbox: `${TRAFFIC_BBOX.join(",")},EPSG:4326`,
  maxFeatures: "1000",
}).toString();
export const TRAFFIC_URL = url.toString();
const RAW_PATH = "data/traffic-ktdb-2024.raw.geojson";
const META_PATH = "data/traffic-ktdb-2024.provenance.json";
const OUTPUT_PATH = "data/traffic-ktdb-2024.json";
const point = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const rawSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      id: z.string(),
      geometry: z.object({
        type: z.literal("LineString"),
        coordinates: z.array(point).min(2),
      }),
      properties: z
        .object({
          link_id: z.number().int(),
          sido_id: z.number().int(),
          aadt: z.number().int(),
        })
        .catchall(z.unknown()),
    }),
  ),
  numberMatched: z.number().int(),
  numberReturned: z.number().int(),
  timeStamp: z.iso.datetime(),
  crs: z.object({
    type: z.literal("name"),
    properties: z.object({ name: z.literal("urn:ogc:def:crs:EPSG::4326") }),
  }),
});
export type TrafficProvenance = {
  url: string;
  publisher: string;
  retrievedAt: string;
  description: string;
  sha256: string;
};
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Source-year profiles only: never synthesizes dates, lanes, directions or future observations. */
export function normalizeTraffic(input: unknown, source: TrafficProvenance) {
  const raw = rawSchema.parse(input);
  if (
    raw.numberReturned !== raw.features.length ||
    raw.numberMatched !== raw.numberReturned
  )
    throw new Error(
      "Truncated WFS response: complete bounded response required",
    );
  if (
    new Set(raw.features.map((f) => f.properties.link_id)).size !==
    raw.features.length
  )
    throw new Error("Duplicate source link IDs");
  if (!raw.features.length) throw new Error("Empty traffic response");
  const historicalTrafficProfiles = raw.features.flatMap((feature) => {
    if (feature.properties.sido_id !== 21000000)
      throw new Error("Non-Busan source link");
    const hourlyVehicleCounts = Array.from({ length: 24 }, (_, hour) => {
      const value = feature.properties[`t${String(hour + 1).padStart(2, "0")}`];
      if (value === -1000) return null;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
        throw new Error(
          `Invalid count on link ${feature.properties.link_id} hour ${hour}`,
        );
      return value;
    });
    const validCounts = hourlyVehicleCounts.filter(
      (v): v is number => v !== null,
    );
    if (!validCounts.length) return [];
    const sum = validCounts.reduce((a, b) => a + b, 0);
    if (feature.properties.aadt !== sum)
      throw new Error(
        `Reported sum mismatch on link ${feature.properties.link_id}; source semantics need review`,
      );
    return [
      {
        id: `ktdb-${TRAFFIC_YEAR}-weekday-${feature.properties.link_id}`,
        sourceLinkId: String(feature.properties.link_id),
        referenceYear: TRAFFIC_YEAR,
        dayType: "weekday" as const,
        geometry: feature.geometry,
        hourlyVehicleCounts,
        reportedTotal: feature.properties.aadt,
        availableHours: validCounts.length,
        lanes: null,
        direction: "source_link_unspecified" as const,
        source,
        limitations: [
          "Исторический будничный профиль KTDB за 2024 год. Точная дата исходного обследования в этом слое не опубликована; это не наблюдение на даты поездки.",
          "Количество полос и точный охват направлений не указаны. Числа нельзя делить на выдуманное количество полос или складывать между соседними участками как независимые потоки.",
          "Геометрия принадлежит дорожной сети KTDB; направление координат не доказывает направление подсчёта. Тоннели, высота и акустическое экранирование не представлены.",
          ...(validCounts.length < 24
            ? [
                "Ночные часы отсутствуют. reportedTotal охватывает только доступные часы и не является полным суточным объёмом.",
              ]
            : []),
        ],
      },
    ];
  });
  if (!historicalTrafficProfiles.length)
    throw new Error("No real counts in bounded response");
  return {
    schemaVersion: 1,
    region: "Пусан",
    referenceYear: TRAFFIC_YEAR,
    dayType: "weekday",
    timeZone: "Asia/Seoul",
    kind: "historical_observed_profile",
    generatedAt: new Date().toISOString(),
    source,
    historicalTrafficProfiles,
    coverage: {
      status: "partial",
      reason:
        "Только участки KTDB с опубликованными будничными подсчётами в ограниченной области. Отсутствие данных не означает отсутствие движения.",
      bbox: TRAFFIC_BBOX,
      returnedLinks: raw.features.length,
      profilesWithCounts: historicalTrafficProfiles.length,
    },
    limitations: [
      "Источник — слой ObservedTrafficVolume, не EstimatedTrafficVolume. Точная дата и число дней обследования в ответе отсутствуют, поэтому сохранён год профиля без вымышленных startsAt/endsAt.",
      "hourlyVehicleCounts[0] означает 00:00–01:00 по Корее, [23] — 23:00–24:00. Соответствие подтверждено официальным интерфейсом View-T. -1000 обозначает отсутствие значения, а не нулевой поток.",
      "Поле источника aadt совпадает с суммой имеющихся часов, в том числе у 16-часовых профилей. Оно сохранено как reportedTotal; название AADT не трактуется как доказанный годовой среднесуточный объём.",
      "Собственная геометрия источника используется для расстояния. Автоматическое приписывание этих чисел отдельному OSM way не выполняется.",
      "Для будущей поездки допустим только отдельно помеченный предварительный исторический фон с ограничением возраста и совпадением типа дня. Профиль не доказывает тишину, загрузку или шум на выбранные даты.",
    ],
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--refresh"))
    throw new Error("Usage: tsx scripts/fetch-traffic.ts [--refresh]");
  let rawText: string, source: TrafficProvenance;
  try {
    if (args.includes("--refresh")) throw new Error("Refresh requested");
    rawText = await readFile(RAW_PATH, "utf8");
    source = JSON.parse(await readFile(META_PATH, "utf8"));
    if (source.url !== TRAFFIC_URL || source.sha256 !== sha256(rawText))
      throw new Error("Cache provenance mismatch; use --refresh");
  } catch (error) {
    if (
      !args.includes("--refresh") &&
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    )
      throw error;
    const result = await run(
      process.platform === "win32" ? "curl.exe" : "curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--max-time",
        "45",
        TRAFFIC_URL,
      ],
      { maxBuffer: 10 * 1024 * 1024, encoding: "utf8" },
    );
    rawText = result.stdout;
    source = {
      url: TRAFFIC_URL,
      publisher: "Korea Transport Database (KTDB), Korea Transport Institute",
      retrievedAt: new Date().toISOString(),
      description: `Official View-T observed traffic volume layer, reference year 2024, weekdays. Map and hour legend: ${TRAFFIC_PAGE}`,
      sha256: sha256(rawText),
    };
    normalizeTraffic(JSON.parse(rawText), source); // Reject HTML/errors/truncation before replacing caches.
    await writeFile(RAW_PATH, rawText);
    await writeFile(META_PATH, JSON.stringify(source, null, 2) + "\n");
  }
  const output = normalizeTraffic(JSON.parse(rawText), source);
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(
    JSON.stringify({
      output: OUTPUT_PATH,
      sourceYear: TRAFFIC_YEAR,
      links: output.coverage.returnedLinks,
      profiles: output.historicalTrafficProfiles.length,
      hourlyCounts: output.historicalTrafficProfiles.reduce(
        (n, p) => n + p.availableHours,
        0,
      ),
      provenanceVerified: true,
    }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
