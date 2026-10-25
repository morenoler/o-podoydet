import { z } from "zod";

export const AIR_SOURCE = "https://open-meteo.com/en/docs/air-quality-api";
export const SAFETY_SOURCE =
  "https://www.safemap.go.kr/dvct/data/selectDataAPIDetail.do?dataApiId=11";
export const AIR_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const AIR_MAX_CELL_DISTANCE_KM = 80;
export const AIR_MAX_FORECAST_HOURS = 168;
export const coordinateSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
export type Coordinates = z.infer<typeof coordinateSchema>;

// Publication dates on Korean portals are civil dates in Korea, while
// retrievedAt is an instant. Comparing its UTC date loses the first nine hours.
export function koreanDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isFinite(+date)
    ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date)
    : "";
}
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
      !u.username &&
      !u.password &&
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
      !u.username &&
      !u.password &&
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
const rateDefinitionSchema = z
  .object({
    categoryCode: z.string().min(1).max(100),
    denominatorBasis: z.literal("annual_average_resident_population"),
    methodologyId: z.string().min(1).max(200),
  })
  .strict();
const comparatorSchema = z
  .object({
    metric: z.literal("crime_rate_per_100000"),
    categoryCode: z.string().min(1).max(100),
    period: z
      .object({ from: isoDate, to: isoDate })
      .strict()
      .refine((p) => p.from <= p.to, "Period is reversed"),
    unit: z.literal("incidents_per_100000_residents"),
    denominatorBasis: z.literal("annual_average_resident_population"),
    methodologyId: z.string().min(1).max(200),
    value: z.number().finite().nonnegative(),
    baselineRegion: z
      .object({
        name: z.string().min(1).max(200),
        code: z.string().min(1).max(100),
      })
      .strict(),
    sourcePublisher: z.string().min(1).max(200),
    sourceUrl: officialUrl,
    sourceRecord: z.string().min(1).max(2000),
    publishedAt: isoDate,
    retrievedAt: z.string().datetime(),
    verification: z.literal("operator-checked-official-source"),
  })
  .strict()
  .refine(
    (c) =>
      c.period.to <= c.publishedAt &&
      c.publishedAt <= koreanDate(c.retrievedAt),
    "Comparator provenance dates are inconsistent",
  );
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
    rateDefinition: rateDefinitionSchema.optional(),
    comparator: comparatorSchema.optional(),
  })
  .strict()
  .refine(
    (e) => e.period.to <= e.publishedAt,
    "Publication precedes the covered period",
  )
  .refine(
    (e) => e.publishedAt <= koreanDate(e.retrievedAt),
    "Publication follows retrieval in the Korean civil calendar",
  )
  .refine(
    (e) => e.metric !== "reported_incidents" || Number.isInteger(e.value),
    "Reported incident counts must be integers",
  )
  .refine(
    (e) =>
      e.metric !== "crime_density_grade" ||
      (Number.isInteger(e.value) && e.value >= 1 && e.value <= 10),
    "Crime density grade must be 1–10",
  )
  .refine(
    (e) =>
      !e.comparator ||
      (e.metric === "crime_rate_per_100000" &&
        e.unit === e.comparator.unit &&
        e.period.from === e.comparator.period.from &&
        e.period.to === e.comparator.period.to &&
        e.rateDefinition?.categoryCode === e.comparator.categoryCode &&
        e.rateDefinition?.denominatorBasis === e.comparator.denominatorBasis &&
        e.rateDefinition?.methodologyId === e.comparator.methodologyId &&
        e.geography.code !== e.comparator.baselineRegion.code),
    "Comparator requires exactly matching rate metric, unit, period, category, denominator and methodology",
  );
export type OfficialEvidence = z.infer<typeof officialEvidenceSchema>;
export const officialImportSchema = z
  .object({
    version: z.literal(1),
    records: z.array(officialEvidenceSchema).max(10000),
  })
  .strict();

export interface AirForecastHour {
  time: string;
  pm25: number | null;
  pm10: number | null;
  no2: number | null;
  usAqi: number | null;
}
export interface AirForecast {
  status: "available" | "partial" | "unknown" | "stale";
  fetchedAt: string | null;
  issuedAt: null;
  sourceUrl: string;
  requestUrl: string | null;
  model: "CAMS Global";
  resolutionKm: 45;
  timezone: "UTC";
  tripTimezone: "Asia/Seoul";
  intervalSeconds: 3600;
  units: { pm25: "µg/m³"; pm10: "µg/m³"; no2: "µg/m³"; usAqi: "USAQI" };
  modelCoordinates: Coordinates | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  hourly: AirForecastHour[];
  limitations: string[];
  error?: string;
}
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
  forecast: AirForecast;
  sourceSnapshot?: {
    sha256: string;
    byteLength: number;
    requestUrl: string;
    fetchedAt: string;
  };
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
  sourceArchive?: { path: string; sha256: string; entryCount: number };
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
    hourly: "pm2_5,pm10,nitrogen_dioxide,us_aqi",
    forecast_days: "5",
    domains: "cams_global",
    timezone: "Asia/Seoul",
    timeformat: "unixtime",
  });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`;
}
const airLimitations = [
  "Модель CAMS Global с разрешением около 45 км: не измерение станции и не оценка конкретной улицы. Близкие отели могут иметь одинаковые значения.",
  "Оценка относится к указанному времени; она не прогнозирует загрязнение на произвольные даты поездки и не характеризует долгосрочное состояние района.",
  "US AQI возвращён провайдером; концентрации в мкг/м³. Индекс не пересчитывается из одного мгновенного значения PM2.5.",
];
const forecastLimitations = [
  "Часовые значения интерполированы провайдером из CAMS Global (~45 км, исходный шаг 3 часа); это модель, а не измерение на улице.",
  "Применим только фактически полученный интервал. Для поездки проверяются все часы от 00:00 заезда до 00:00 выезда по Asia/Seoul без пробелов и пропущенных US AQI.",
  "Время выпуска модельного прогона API не возвращает. fetchedAt — время получения, а не выпуска; текущие концентрации не заменяют прогноз на даты поездки.",
];
export function unknownForecast(
  reason: string,
  requestUrl: string | null = null,
): AirForecast {
  return {
    status: "unknown",
    fetchedAt: null,
    issuedAt: null,
    sourceUrl: AIR_SOURCE,
    requestUrl,
    model: "CAMS Global",
    resolutionKm: 45,
    timezone: "UTC",
    tripTimezone: "Asia/Seoul",
    intervalSeconds: 3600,
    units: { pm25: "µg/m³", pm10: "µg/m³", no2: "µg/m³", usAqi: "USAQI" },
    modelCoordinates: null,
    coverageStart: null,
    coverageEnd: null,
    hourly: [],
    limitations: [...forecastLimitations],
    error: reason,
  };
}
function cellCoordinates(
  raw: Record<string, unknown>,
  expected?: Coordinates,
): Coordinates | null {
  const parsed = coordinateSchema.safeParse([raw.longitude, raw.latitude]);
  if (!parsed.success) return null;
  if (expected) {
    const rad = Math.PI / 180,
      lat1 = expected[1] * rad,
      lat2 = parsed.data[1] * rad;
    const hav =
      Math.sin((lat2 - lat1) / 2) ** 2 +
      Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(((parsed.data[0] - expected[0]) * rad) / 2) ** 2;
    if (
      6371 * 2 * Math.asin(Math.sqrt(Math.min(1, hav))) >
      AIR_MAX_CELL_DISTANCE_KM
    )
      return null;
  }
  return parsed.data;
}
export function normalizeAirForecast(
  raw: unknown,
  fetchedAt: string,
  requestUrl: string,
  now = new Date(),
  expectedCoordinates?: Coordinates,
): AirForecast {
  const base = unknownForecast(
    "Почасовой прогноз отсутствует или не прошёл проверку.",
    requestUrl,
  );
  if (!raw || typeof raw !== "object") return base;
  const data = raw as Record<string, unknown>;
  if (data.error) return base;
  const coords = cellCoordinates(data, expectedCoordinates),
    fetched = Date.parse(fetchedAt);
  if (!coords || !Number.isFinite(fetched) || fetched > +now + 60000)
    return {
      ...base,
      error: "Некорректные координаты модели или время получения прогноза.",
    };
  const source = data.hourly as Record<string, unknown> | undefined,
    units = data.hourly_units as Record<string, unknown> | undefined;
  if (
    !source ||
    !units ||
    units.time !== "unixtime" ||
    !Array.isArray(source.time) ||
    source.time.length === 0 ||
    source.time.length > AIR_MAX_FORECAST_HOURS
  )
    return base;
  const times = source.time;
  let previous = -Infinity,
    hasGaps = false;
  for (const time of times) {
    if (
      typeof time !== "number" ||
      !Number.isSafeInteger(time) ||
      time % 3600 !== 0 ||
      time <= previous ||
      time * 1000 < fetched - 24 * 3600000 ||
      time * 1000 > fetched + 7 * 24 * 3600000
    )
      return {
        ...base,
        error:
          "Неверный, повторный или несортированный час прогноза либо дата за допустимым горизонтом.",
      };
    if (previous !== -Infinity && time - previous !== 3600) hasGaps = true;
    previous = time;
  }
  const fields = {
    pm25: ["pm2_5", "μg/m³"],
    pm10: ["pm10", "μg/m³"],
    no2: ["nitrogen_dioxide", "μg/m³"],
    usAqi: ["us_aqi", "USAQI"],
  } as const;
  // An unequal array length makes index alignment untrustworthy for that metric.
  const arrays = Object.fromEntries(
    Object.entries(fields).map(([key, [name, unit]]) => [
      key,
      units[name] === unit &&
      Array.isArray(source[name]) &&
      source[name].length === times.length
        ? source[name]
        : null,
    ]),
  ) as Record<keyof typeof fields, unknown[] | null>;
  const value = (key: keyof typeof fields, index: number): number | null => {
    const v = arrays[key]?.[index];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  };
  const hourly: AirForecastHour[] = times.map((time, index) => ({
    time: new Date(time * 1000).toISOString(),
    pm25: value("pm25", index),
    pm10: value("pm10", index),
    no2: value("no2", index),
    usAqi: value("usAqi", index),
  }));
  const valid = hourly.some((h) =>
    [h.pm25, h.pm10, h.no2, h.usAqi].some((v) => v !== null),
  );
  if (!valid)
    return {
      ...base,
      error: "Прогноз не содержит проверяемых значений в ожидаемых единицах.",
    };
  const incomplete =
    hasGaps ||
    hourly.some((h) =>
      [h.pm25, h.pm10, h.no2, h.usAqi].some((v) => v === null),
    );
  const stale = +now - fetched > AIR_MAX_AGE_MS;
  return {
    ...base,
    status: stale ? "stale" : incomplete ? "partial" : "available",
    fetchedAt,
    modelCoordinates: coords,
    coverageStart: hourly[0].time,
    coverageEnd: new Date((times.at(-1)! + 3600) * 1000).toISOString(),
    hourly,
    error: undefined,
    limitations: [
      ...forecastLimitations,
      ...(incomplete
        ? [
            "В прогнозе есть пропуски часов или показателей. Границы coverageStart/coverageEnd сами по себе не доказывают полного покрытия поездки.",
          ]
        : []),
      ...(stale
        ? ["Прогноз получен более 6 часов назад; обновите источник."]
        : []),
    ],
  };
}
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
    forecast: unknownForecast(reason, requestUrl),
    error: reason,
  };
}
function normalizeCurrentAir(
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
export function normalizeAir(
  raw: unknown,
  fetchedAt: string,
  requestUrl: string,
  now = new Date(),
  expectedCoordinates?: Coordinates,
): AirQualityAssessment {
  return {
    ...normalizeCurrentAir(
      raw,
      fetchedAt,
      requestUrl,
      now,
      expectedCoordinates,
    ),
    forecast: normalizeAirForecast(
      raw,
      fetchedAt,
      requestUrl,
      now,
      expectedCoordinates,
    ),
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
  const today = koreanDate(now);
  const evidence = records
    .filter(
      (e) =>
        evidenceContains(e, coordinates) &&
        e.publishedAt <= today &&
        Date.parse(e.retrievedAt) <= +now,
    )
    .map((e) => {
      if (
        e.comparator &&
        (e.comparator.publishedAt > today ||
          Date.parse(e.comparator.retrievedAt) > +now)
      ) {
        const { comparator, ...withoutComparator } = e;
        return {
          ...withoutComparator,
          limitations: [
            ...e.limitations,
            "Сравнительное значение исключено: дата его публикации или получения находится в будущем.",
          ],
        };
      }
      return e;
    });
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
  let forecast =
    air.forecast ??
    unknownForecast("В старом снимке нет почасового прогноза.", air.requestUrl);
  const forecastFetched = Date.parse(forecast.fetchedAt || "");
  if (forecast.status !== "unknown" && forecast.status !== "stale") {
    if (!Number.isFinite(forecastFetched) || forecastFetched > +now + 60000)
      forecast = {
        ...forecast,
        status: "unknown",
        error: "Неверное время получения прогноза.",
      };
    else if (+now - forecastFetched > AIR_MAX_AGE_MS)
      forecast = {
        ...forecast,
        status: "stale",
        limitations: [
          ...forecast.limitations,
          "Сохранённый прогноз старше 6 часов.",
        ],
      };
  }
  const withForecast = { ...assessment, airQuality: { ...air, forecast } };
  if (air.status === "unknown" || air.status === "stale") return withForecast;
  const time = Date.parse(air.time || ""),
    fetched = Date.parse(air.fetchedAt || "");
  if (
    !Number.isFinite(time) ||
    !Number.isFinite(fetched) ||
    time > +now + 3600000 ||
    fetched > +now + 60000
  )
    return {
      ...withForecast,
      airQuality: {
        ...withForecast.airQuality,
        status: "unknown",
        error: "Время сохранённого снимка отсутствует, некорректно или находится в будущем.",
      },
    };
  if (+now - time <= AIR_MAX_AGE_MS && +now - fetched <= AIR_MAX_AGE_MS)
    return withForecast;
  return {
    ...withForecast,
    airQuality: {
      ...withForecast.airQuality,
      status: "stale",
      limitations: [
        ...air.limitations,
        "Сохранённый снимок старше 6 часов. Значения не обновлялись с указанного времени.",
      ],
    },
  };
}
