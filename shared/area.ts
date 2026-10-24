import { z } from "zod";

export const AIR_SOURCE = "https://open-meteo.com/en/docs/air-quality-api";
export const SAFETY_SOURCE =
  "https://www.safemap.go.kr/dvct/data/selectDataAPIDetail.do?dataApiId=11";
export const AIR_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const AIR_MAX_CELL_DISTANCE_KM = 80;
export const coordinateSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
export type Coordinates = z.infer<typeof coordinateSchema>;
export interface AreaTarget {
  hotelId: string;
  name: string;
  coordinates: Coordinates;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s;
  }, "Invalid calendar date");
const officialUrl = z
  .string()
  .url()
  .refine((s) => {
    const u = new URL(s);
    return (
      u.protocol === "https:" &&
      (u.hostname === "go.kr" || u.hostname.endsWith(".go.kr"))
    );
  }, "Expected an official Korean government HTTPS source");
const ringSchema = z
  .array(coordinateSchema)
  .min(4)
  .max(10000)
  .refine(
    (r) => r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1],
    "Polygon ring must be closed",
  );
const boundarySource = z
  .string()
  .url()
  .refine((s) => {
    const u = new URL(s);
    return (
      u.protocol === "https:" &&
      (u.hostname.endsWith(".go.kr") ||
        ((u.hostname === "www.openstreetmap.org" ||
          u.hostname === "openstreetmap.org") &&
          /^\/relation\/\d+\/?$/.test(u.pathname)))
    );
  }, "Expected official boundary or identified OSM relation");
const polygonSchema = z.array(ringSchema).min(1).max(50);
const geographySchema = z.discriminatedUnion("type", [
  z
    .object({
      name: z.string().min(1).max(200),
      code: z.string().min(1).max(100),
      sourceUrl: boundarySource,
      type: z.literal("Polygon"),
      coordinates: polygonSchema,
    })
    .strict(),
  z
    .object({
      name: z.string().min(1).max(200),
      code: z.string().min(1).max(100),
      sourceUrl: boundarySource,
      type: z.literal("MultiPolygon"),
      coordinates: z.array(polygonSchema).min(1).max(100),
    })
    .strict(),
]);
export const officialEvidenceSchema = z
  .object({
    id: z.string().min(1).max(150),
    sourcePublisher: z.string().min(1).max(200),
    sourceUrl: officialUrl,
    publishedAt: isoDate,
    retrievedAt: z.string().datetime(),
    period: z
      .object({ from: isoDate, to: isoDate })
      .strict()
      .refine((p) => p.from <= p.to, "Period is reversed"),
    geography: geographySchema,
    metric: z.enum([
      "reported_incidents",
      "crime_density_grade",
      "crime_rate_per_100000",
    ]),
    metricLabel: z.string().min(1).max(300),
    sourceRecord: z.string().min(1).max(2000),
    sourceFileSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    value: z.number().finite().nonnegative(),
    unit: z.string().min(1).max(100),
    methodology: z.string().min(20).max(3000),
    limitations: z.array(z.string().min(1).max(1000)).min(1).max(20),
    verification: z.literal("operator-checked-official-source"),
  })
  .strict()
  .refine(
    (e) => e.period.to <= e.publishedAt,
    "Publication precedes the covered period",
  )
  .refine(
    (e) =>
      e.metric !== "crime_density_grade" ||
      (Number.isInteger(e.value) && e.value >= 1 && e.value <= 10),
    "Crime density grade must be 1–10",
  );
export type OfficialEvidence = z.infer<typeof officialEvidenceSchema>;
export const officialImportSchema = z
  .object({
    version: z.literal(1),
    records: z.array(officialEvidenceSchema).max(10000),
  })
  .strict();

export interface AirQualityAssessment {
  status: "available" | "partial" | "unknown" | "stale";
  time: string | null;
  fetchedAt: string | null;
  model: "CAMS Global";
  resolutionKm: 45;
  temporalResolutionHours: 3;
  sourceUrl: string;
  requestUrl: string | null;
  attribution: string;
  licenseUrl: string;
  modelCoordinates: Coordinates | null;
  pm25: number | null;
  pm10: number | null;
  no2: number | null;
  usAqi: number | null;
  concentrationUnit: "µg/m³";
  category: string | null;
  limitations: string[];
  error?: string;
}
export interface SafetyAssessment {
  status: "unknown" | "evidence";
  summary: string;
  sourceUrl: string;
  evidence: OfficialEvidence[];
  limitations: string[];
}
export interface AreaAssessment extends AreaTarget {
  assessedAt: string;
  airQuality: AirQualityAssessment;
  safety: SafetyAssessment;
}
export interface AreaAssessmentFile {
  version: 1;
  generatedAt: string;
  region?: string;
  assessments: AreaAssessment[];
  skipped: { hotelId: string; reason: string }[];
}

export function aqiCategory(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  if (value <= 50) return "Хороший";
  if (value <= 100) return "Умеренный";
  if (value <= 150) return "Нездоровый для чувствительных групп";
  if (value <= 200) return "Нездоровый";
  if (value <= 300) return "Очень нездоровый";
  return "Опасный";
}
export function airRequestUrl(coordinates: Coordinates): string {
  coordinateSchema.parse(coordinates);
  const params = new URLSearchParams({
    latitude: String(coordinates[1]),
    longitude: String(coordinates[0]),
    current: "pm2_5,pm10,nitrogen_dioxide,us_aqi",
    domains: "cams_global",
    timezone: "GMT",
    timeformat: "unixtime",
  });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`;
}
const airLimitations = [
  "Модель CAMS Global с разрешением около 45 км: не измерение станции и не оценка конкретной улицы. Близкие отели могут иметь одинаковые значения.",
  "Оценка относится к указанному времени; она не прогнозирует загрязнение на произвольные даты поездки и не характеризует долгосрочное состояние района.",
  "US AQI возвращён провайдером; концентрации в мкг/м³. Индекс не пересчитывается из одного мгновенного значения PM2.5.",
];
export function unknownAir(
  reason: string,
  requestUrl: string | null = null,
): AirQualityAssessment {
  return {
    status: "unknown",
    time: null,
    fetchedAt: null,
    model: "CAMS Global",
    resolutionKm: 45,
    temporalResolutionHours: 3,
    sourceUrl: AIR_SOURCE,
    requestUrl,
    attribution: "Open-Meteo · Copernicus Atmosphere Monitoring Service (CAMS)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    modelCoordinates: null,
    pm25: null,
    pm10: null,
    no2: null,
    usAqi: null,
    concentrationUnit: "µg/m³",
    category: null,
    limitations: [...airLimitations],
    error: reason,
  };
}
export function normalizeAir(
  raw: unknown,
  fetchedAt: string,
  requestUrl: string,
  now = new Date(),
  expectedCoordinates?: Coordinates,
): AirQualityAssessment {
  const base = unknownAir(
    "Источник не вернул проверяемые значения.",
    requestUrl,
  );
  if (!raw || typeof raw !== "object") return base;
  const data = raw as Record<string, unknown>;
  if (data.error)
    return {
      ...base,
      error: typeof data.reason === "string" ? data.reason : "Ошибка источника",
    };
  const current = data.current as Record<string, unknown> | undefined,
    units = data.current_units as Record<string, unknown> | undefined;
  if (
    !current ||
    !units ||
    units.time !== "unixtime" ||
    typeof current.time !== "number" ||
    !Number.isFinite(current.time)
  )
    return { ...base, error: "Нет времени модели в Unix UTC." };
  const time = new Date(current.time * 1000),
    fetched = new Date(fetchedAt);
  if (
    !Number.isFinite(+time) ||
    !Number.isFinite(+fetched) ||
    +time > +now + 3600000 ||
    +fetched > +now + 60000
  )
    return { ...base, error: "Некорректное время модели или получения." };
  const number = (key: string, unit: string) =>
    units[key] === unit &&
    typeof current[key] === "number" &&
    Number.isFinite(current[key]) &&
    (current[key] as number) >= 0
      ? (current[key] as number)
      : null;
  const pm25 = number("pm2_5", "μg/m³"),
    pm10 = number("pm10", "μg/m³"),
    no2 = number("nitrogen_dioxide", "μg/m³"),
    usAqi = number("us_aqi", "USAQI");
  const valid = [pm25, pm10, no2, usAqi].filter((v) => v !== null).length;
  const coords = coordinateSchema.safeParse([data.longitude, data.latitude]);
  if (!coords.success)
    return { ...base, error: "Нет координат модельной ячейки." };
  if (expectedCoordinates) {
    const rad = Math.PI / 180,
      lat1 = expectedCoordinates[1] * rad,
      lat2 = coords.data[1] * rad,
      dLat = lat2 - lat1,
      dLon = (coords.data[0] - expectedCoordinates[0]) * rad;
    const hav =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const kilometers = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, hav)));
    if (kilometers > AIR_MAX_CELL_DISTANCE_KM)
      return {
        ...base,
        error: `Модельная ячейка дальше ${AIR_MAX_CELL_DISTANCE_KM} км от запрошенной точки.`,
      };
  }
  const stale =
    +now - +time > AIR_MAX_AGE_MS || +now - +fetched > AIR_MAX_AGE_MS;
  return {
    ...base,
    status:
      valid === 0
        ? "unknown"
        : stale
          ? "stale"
          : valid === 4
            ? "available"
            : "partial",
    time: time.toISOString(),
    fetchedAt,
    modelCoordinates: coords.success ? coords.data : null,
    pm25,
    pm10,
    no2,
    usAqi,
    category: aqiCategory(usAqi),
    error:
      valid === 0 ? "Нет числовых значений с ожидаемыми единицами." : undefined,
    limitations: [
      ...airLimitations,
      ...(valid > 0 && valid < 4
        ? ["Часть показателей отсутствует или имеет неожиданные единицы."]
        : []),
      ...(stale
        ? ["Снимок старше 6 часов. Обновите источник перед использованием."]
        : []),
    ],
  };
}
function ringLocation(point: Coordinates, ring: Coordinates[]): -1 | 0 | 1 {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    // Boundary is deliberately excluded: a shared administrative edge is ambiguous.
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (
      Math.abs(cross) < 1e-12 &&
      x >= Math.min(xi, xj) &&
      x <= Math.max(xi, xj) &&
      y >= Math.min(yi, yj) &&
      y <= Math.max(yi, yj)
    )
      return -1;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside ? 1 : 0;
}
export function evidenceContains(
  evidence: OfficialEvidence,
  coordinates: Coordinates,
): boolean {
  const polygons =
    evidence.geography.type === "Polygon"
      ? [evidence.geography.coordinates]
      : evidence.geography.coordinates;
  return polygons.some(
    ([outer, ...holes]) =>
      ringLocation(coordinates, outer) === 1 &&
      holes.every((r) => ringLocation(coordinates, r) === 0),
  );
}
export function assessSafety(
  coordinates: Coordinates,
  records: OfficialEvidence[] = [],
  now = new Date(),
): SafetyAssessment {
  const today = now.toISOString().slice(0, 10);
  const evidence = records.filter(
    (e) =>
      evidenceContains(e, coordinates) &&
      e.publishedAt <= today &&
      Date.parse(e.retrievedAt) <= +now,
  );
  return {
    status: evidence.length ? "evidence" : "unknown",
    summary: evidence.length
      ? "Есть официальные исторические сведения для указанной территории; общий рейтинг безопасности не рассчитывается."
      : "Недостаточно проверенных районных данных о преступности. Безопасность не оценена.",
    sourceUrl: SAFETY_SOURCE,
    evidence,
    limitations: [
      "Статистика относится к периоду и территории источника; она не описывает личный риск гостя, конкретный отель или будущую поездку.",
      "Наличие полиции, камер, освещения, туристических объектов и демографический состав не используются как заменители статистики безопасности.",
      evidence.length
        ? "Импорт проверен оператором по официальному источнику; приложение валидирует формат и географическое покрытие, но не подтверждает подлинность публикации автоматически."
        : "SafeMap требует API-ключ. Официальный районный CSV data.go.kr доступен, но его показатели пока не сопоставлены с проверенной границей района для этой точки.",
    ],
  };
}
export function makeAssessment(
  target: AreaTarget,
  airQuality: AirQualityAssessment,
  records: OfficialEvidence[] = [],
  now = new Date(),
): AreaAssessment {
  coordinateSchema.parse(target.coordinates);
  return {
    ...target,
    assessedAt: now.toISOString(),
    airQuality,
    safety: assessSafety(target.coordinates, records, now),
  };
}
export function refreshAreaFreshness(
  assessment: AreaAssessment,
  now = new Date(),
): AreaAssessment {
  const air = assessment.airQuality;
  if (air.status === "unknown" || air.status === "stale") return assessment;
  const time = Date.parse(air.time || ""),
    fetched = Date.parse(air.fetchedAt || "");
  if (!Number.isFinite(time) || !Number.isFinite(fetched))
    return {
      ...assessment,
      airQuality: {
        ...air,
        status: "unknown",
        error: "В сохранённом снимке отсутствует проверяемое время.",
      },
    };
  if (+now - time <= AIR_MAX_AGE_MS && +now - fetched <= AIR_MAX_AGE_MS)
    return assessment;
  return {
    ...assessment,
    airQuality: {
      ...air,
      status: "stale",
      limitations: [
        ...air.limitations,
        "Сохранённый снимок старше 6 часов. Значения не обновлялись с указанного времени.",
      ],
    },
  };
}
