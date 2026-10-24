import { z } from "zod";
import { closestPointOnLine, distance } from "./geo";
import type { Point } from "./types";

export type NoiseRisk = "low" | "moderate" | "high" | "unknown";
const pointSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
function validTimestamp(value: string): boolean {
  const match =
    /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const midnight = Date.parse(`${match[1]}T00:00:00Z`);
  return (
    Number.isFinite(midnight) &&
    new Date(midnight).toISOString().slice(0, 10) === match[1]
  );
}
const timestamp = z
  .string()
  .refine(
    validTimestamp,
    "Valid calendar ISO timestamp with explicit offset required",
  );
const sourceSchema = z
  .object({
    url: z
      .url()
      .refine((value) => /^https?:\/\//.test(value), "HTTP(S) source required"),
    publisher: z.string().min(1),
    retrievedAt: timestamp,
    description: z.string().optional(),
  })
  .strict();
const ringSchema = z
  .array(pointSchema)
  .min(4)
  .refine(
    (ring) => ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1],
    "Polygon rings must be closed",
  );
const polygonSchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(ringSchema).min(1),
  })
  .strict();
const geometrySchema = z.union([
  z.object({ type: z.literal("Point"), coordinates: pointSchema }).strict(),
  polygonSchema,
]);
export const roadSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    roadClass: z.string().min(1),
    geometry: z.array(pointSchema).min(2),
    oneWay: z.boolean(),
    source: sourceSchema,
  })
  .strict();
export const trafficObservationSchema = z
  .object({
    id: z.string().min(1),
    roadId: z.string().min(1),
    startsAt: timestamp,
    endsAt: timestamp,
    vehicleCount: z.number().int().nonnegative().optional(),
    speedKph: z.number().finite().min(0).max(250).optional(),
    lanes: z.number().int().min(1).max(20).optional(),
    direction: z.enum(["one_direction", "both_directions", "unknown"]),
    source: sourceSchema,
    limitations: z.array(z.string()),
  })
  .strict()
  .superRefine((value, ctx) => {
    const duration = Date.parse(value.endsAt) - Date.parse(value.startsAt);
    if (duration < 60_000 || duration > 86_400_000)
      ctx.addIssue({
        code: "custom",
        message: "Traffic intervals must cover 1 minute to 24 hours",
      });
    if (value.vehicleCount === undefined && value.speedKph === undefined)
      ctx.addIssue({
        code: "custom",
        message: "A measured count or speed is required",
      });
    if (Date.parse(value.endsAt) > Date.parse(value.source.retrievedAt))
      ctx.addIssue({
        code: "custom",
        message:
          "Observed traffic cannot end after retrieval; future forecasts are unsupported",
      });
  });
export const noiseEventSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    eventType: z.enum([
      "fireworks",
      "concert",
      "festival",
      "light_installation",
      "holiday",
    ]),
    startsAt: timestamp,
    endsAt: timestamp,
    timePrecision: z.enum(["minute", "day"]),
    geometry: geometrySchema,
    influenceRadiusMeters: z.number().finite().min(0).max(10000),
    noisePotential: z.enum(["low", "moderate", "high"]),
    influenceBasis: z.string().min(1),
    source: sourceSchema,
    geometrySource: sourceSchema,
    limitations: z.array(z.string()),
    status: z.enum(["scheduled", "historical", "cancelled", "tentative"]),
  })
  .strict()
  .refine(
    (value) => Date.parse(value.endsAt) > Date.parse(value.startsAt),
    "Event end must follow start",
  );
const boundedCoverageSchema = z
  .object({
    status: z.enum(["unavailable", "partial", "complete"]),
    reason: z.string(),
    sourceUrls: z.array(z.url()),
    verifiedAt: timestamp.optional(),
    startsAt: timestamp.optional(),
    endsAt: timestamp.optional(),
    geometry: polygonSchema.optional(),
    verificationSource: sourceSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.status === "complete" &&
      (!value.verifiedAt ||
        !value.startsAt ||
        !value.endsAt ||
        !value.geometry ||
        !value.verificationSource)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Complete coverage requires verification time, verified source, polygon and bounded period; traffic proof must include road inventory completeness",
      });
    if (
      value.startsAt &&
      value.endsAt &&
      Date.parse(value.endsAt) <= Date.parse(value.startsAt)
    )
      ctx.addIssue({ code: "custom", message: "Invalid coverage period" });
  });
const coverageSchema = z
  .object({
    traffic: boundedCoverageSchema,
    events: boundedCoverageSchema.refine(
      (value) => value.status !== "unavailable",
      "Event calendar coverage is partial or complete",
    ),
  })
  .strict();
export const noiseContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    region: z.literal("Пусан"),
    timeZone: z.literal("Asia/Seoul"),
    generatedAt: timestamp,
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    coverage: coverageSchema,
    roads: z.array(roadSchema),
    trafficObservations: z.array(trafficObservationSchema),
    events: z.array(noiseEventSchema),
    assumptions: z.array(z.string()),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set(value.roads.map((r) => r.id));
    for (const [label, items] of [
      ["roads", value.roads],
      ["traffic", value.trafficObservations],
      ["events", value.events],
    ] as const)
      if (new Set(items.map((i) => i.id)).size !== items.length)
        ctx.addIssue({ code: "custom", message: `Duplicate ${label} ids` });
    for (const observation of value.trafficObservations)
      if (!ids.has(observation.roadId))
        ctx.addIssue({
          code: "custom",
          message: `Traffic road ${observation.roadId} has no verified geometry`,
        });
    for (const item of [
      ...value.roads,
      ...value.trafficObservations,
      ...value.events,
    ])
      if (Date.parse(item.source.retrievedAt) > Date.parse(value.generatedAt))
        ctx.addIssue({
          code: "custom",
          message: "Source retrieval cannot be after snapshot generation",
        });
    if (value.bbox[0] >= value.bbox[2] || value.bbox[1] >= value.bbox[3])
      ctx.addIssue({ code: "custom", message: "Invalid bounding box" });
  });
export type NoiseContext = z.infer<typeof noiseContextSchema>;
export type TrafficObservation = z.infer<typeof trafficObservationSchema>;
export type NoiseEvent = z.infer<typeof noiseEventSchema>;
export type NoiseGeometry = z.infer<typeof geometrySchema>;
export const NOISE_MODEL = {
  nearbyRoadMeters: 300,
  baselineHighMeters: 50,
  baselineModerateMeters: 150,
  trafficHighDistanceMeters: 75,
  trafficModerateDistanceMeters: 150,
  lowVehiclesPerLaneHour: 300,
  moderateVehiclesPerLaneHour: 700,
  eventHighRadiusFraction: 0.5,
} as const;

function inRing(point: Point, ring: Point[]): boolean {
  if (distance(point, closestPointOnLine(point, ring)!) < 0.01) return true;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = point,
      [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
export function insideNoisePolygon(
  point: Point,
  geometry: z.infer<typeof polygonSchema>,
): boolean {
  return (
    inRing(point, geometry.coordinates[0]) &&
    !geometry.coordinates.slice(1).some((r) => inRing(point, r))
  );
}
export function distanceToNoiseGeometry(
  point: Point,
  geometry: NoiseGeometry,
): number {
  if (geometry.type === "Point") return distance(point, geometry.coordinates);
  if (insideNoisePolygon(point, geometry)) return 0;
  return Math.min(
    ...geometry.coordinates.map((r) =>
      distance(point, closestPointOnLine(point, r)!),
    ),
  );
}
export function noiseTripWindow(checkIn: string, checkOut: string) {
  for (const day of [checkIn, checkOut])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day
    )
      throw new Error("Invalid trip date");
  const start = Date.parse(`${checkIn}T00:00:00+09:00`),
    end = Date.parse(`${checkOut}T00:00:00+09:00`);
  if (end <= start) throw new Error("Checkout must follow check-in");
  return {
    start,
    end,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    timeZone: "Asia/Seoul",
  };
}
export function trafficLoad(observation: TrafficObservation): {
  vehiclesPerLaneHour: number;
  level: Exclude<NoiseRisk, "unknown">;
} | null {
  if (
    observation.vehicleCount === undefined ||
    !observation.lanes ||
    observation.direction === "unknown"
  )
    return null;
  const hours =
    (Date.parse(observation.endsAt) - Date.parse(observation.startsAt)) /
    3_600_000;
  const volume = observation.vehicleCount / (hours * observation.lanes);
  return {
    vehiclesPerLaneHour: volume,
    level: volume <= 300 ? "low" : volume <= 700 ? "moderate" : "high",
  };
}
export function trafficNoiseRisk(
  load: Exclude<NoiseRisk, "unknown">,
  meters: number,
): Exclude<NoiseRisk, "unknown"> {
  return load === "high" && meters <= 75
    ? "high"
    : load !== "low" && meters <= 150
      ? "moderate"
      : "low";
}
function intervalsCover(
  intervals: { start: number; end: number }[],
  start: number,
  end: number,
): boolean {
  let until = start;
  for (const range of intervals.sort((a, b) => a.start - b.start)) {
    if (range.end <= until) continue;
    if (range.start > until) return false;
    until = Math.max(until, range.end);
    if (until >= end) return true;
  }
  return until >= end;
}

/** A bounded, transparent exposure model. Never estimates decibels or indoor quiet. */
export function evaluateNoise(
  context: NoiseContext,
  coordinates: Point,
  checkIn: string,
  checkOut: string,
  now: Date = new Date(),
) {
  const tripWindow = noiseTripWindow(checkIn, checkOut);
  const nowMs = now.getTime();
  const fresh = (value: string | undefined) =>
    !!value &&
    Date.parse(value) <= nowMs &&
    Date.parse(value) >= nowMs - 6 * 3_600_000;
  const completeCoverage = (
    c: NoiseContext["coverage"]["traffic"],
    clearance = 0.01,
  ) =>
    c.status === "complete" &&
    !!c.startsAt &&
    !!c.endsAt &&
    !!c.geometry &&
    !!c.verificationSource &&
    fresh(c.verifiedAt) &&
    fresh(c.verificationSource.retrievedAt) &&
    Date.parse(c.startsAt) <= tripWindow.start &&
    Date.parse(c.endsAt) >= tripWindow.end &&
    insideNoisePolygon(coordinates, c.geometry) &&
    c.geometry.coordinates.every(
      (r) =>
        distance(coordinates, closestPointOnLine(coordinates, r)!) > clearance,
    );
  const overlaps = (start: string, end: string) =>
    Date.parse(start) < tripWindow.end && Date.parse(end) > tripWindow.start;
  const inArea =
    coordinates[0] >= context.bbox[0] &&
    coordinates[0] <= context.bbox[2] &&
    coordinates[1] >= context.bbox[1] &&
    coordinates[1] <= context.bbox[3];
  const validInventory = context.roads.every(
    (road) => Date.parse(road.source.retrievedAt) <= nowMs,
  );
  const roads = context.roads
    .filter((road) => Date.parse(road.source.retrievedAt) <= nowMs)
    .map((road) => ({
      ...road,
      meters: distance(
        coordinates,
        closestPointOnLine(coordinates, road.geometry)!,
      ),
    }))
    .filter((road) => road.meters <= NOISE_MODEL.nearbyRoadMeters)
    .sort((a, b) => a.meters - b.meters);
  const observations = context.trafficObservations.flatMap((observation) => {
    const road = roads.find((r) => r.id === observation.roadId);
    if (
      !road ||
      !overlaps(observation.startsAt, observation.endsAt) ||
      Date.parse(observation.endsAt) > nowMs ||
      Date.parse(observation.source.retrievedAt) > nowMs
    )
      return [];
    const load = trafficLoad(observation);
    return [
      {
        ...observation,
        roadName: road.name,
        meters: road.meters,
        load: load?.level || "unknown",
        vehiclesPerLaneHour: load?.vehiclesPerLaneHour ?? null,
        risk: load ? trafficNoiseRisk(load.level, road.meters) : "unknown",
      },
    ];
  });
  const trafficComplete =
    inArea &&
    validInventory &&
    completeCoverage(context.coverage.traffic, NOISE_MODEL.nearbyRoadMeters) &&
    roads.length > 0 &&
    roads.every((road) =>
      intervalsCover(
        observations
          .filter(
            (o) =>
              o.roadId === road.id &&
              o.load !== "unknown" &&
              (road.oneWay || o.direction === "both_directions"),
          )
          .map((o) => ({
            start: Date.parse(o.startsAt),
            end: Date.parse(o.endsAt),
          })),
        tripWindow.start,
        tripWindow.end,
      ),
    );
  const matches = context.events.flatMap((event) => {
    if (
      event.status === "cancelled" ||
      event.status === "tentative" ||
      event.eventType === "holiday" ||
      !overlaps(event.startsAt, event.endsAt) ||
      Date.parse(event.source.retrievedAt) > nowMs ||
      Date.parse(event.geometrySource.retrievedAt) > nowMs
    )
      return [];
    const meters = distanceToNoiseGeometry(coordinates, event.geometry);
    if (meters > event.influenceRadiusMeters) return [];
    const risk =
      event.noisePotential === "high" &&
      meters > event.influenceRadiusMeters * 0.5
        ? "moderate"
        : event.noisePotential;
    return [{ ...event, meters, risk }];
  });
  const eventsComplete = completeCoverage(context.coverage.events);
  const contributors = [
    ...observations.map((o) => o.risk),
    ...matches.map((e) => e.risk),
  ];
  const risk: NoiseRisk = !inArea
    ? "unknown"
    : contributors.includes("high")
      ? "high"
      : contributors.includes("moderate")
        ? "moderate"
        : trafficComplete && eventsComplete
          ? "low"
          : "unknown";
  const nearest = roads[0]?.meters;
  return {
    risk,
    matchingStatus:
      risk === "high" || risk === "moderate"
        ? "mismatch"
        : risk === "low"
          ? "match"
          : "unknown",
    tripWindow,
    baseline: {
      exposure:
        nearest === undefined
          ? "unknown"
          : nearest <= 50
            ? "high"
            : nearest <= 150
              ? "moderate"
              : "low",
      roads: roads.map((r) => ({
        id: r.id,
        name: r.name,
        roadClass: r.roadClass,
        meters: r.meters,
        source: r.source,
      })),
    },
    traffic: {
      status: trafficComplete
        ? "covered"
        : observations.length
          ? "partial"
          : "unknown",
      observations,
      coverageReason: context.coverage.traffic.reason,
    },
    events: {
      coverage: eventsComplete ? "complete" : "partial",
      matches,
      coverageReason: context.coverage.events.reason,
    },
    limitations: [
      "Риск внешнего шума — прозрачная эвристика, не замеры дБ и не подтверждение тишины внутри номера.",
      "Класс и близость дороги описывают фоновые факторы; измеренная загрузка без наблюдений неизвестна.",
      "Периоды поездки трактуются как [заезд 00:00, выезд 00:00) по Asia/Seoul: точное время заселения не задано.",
      ...(!trafficComplete
        ? [
            "Наблюдения движения не покрывают все близкие дороги и весь срок поездки. Прошлая загрузка не переносится на будущие даты.",
          ]
        : []),
      ...(!eventsComplete
        ? [
            "Календарь событий неполон. Отсутствие совпадений не подтверждает отсутствие событий.",
          ]
        : []),
      ...(!inArea
        ? ["Точка находится вне территории сохранённого контекста."]
        : []),
    ],
  };
}
