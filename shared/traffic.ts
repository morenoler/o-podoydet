import { z } from "zod";
import { closestPointOnLine, distance } from "./geo";
import type { Point } from "./types";

const point = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const source = z.object({
  url: z.url().refine((v) => /^https?:\/\//.test(v)),
  publisher: z.string().min(1),
  retrievedAt: z.iso.datetime({ offset: true }),
  description: z.string().optional(),
});
export const historicalTrafficProfileSchema = z.object({
  id: z.string().min(1),
  sourceLinkId: z.string().min(1),
  referenceYear: z.number().int().min(2000).max(2100),
  dayType: z.literal("weekday"),
  geometry: z.object({
    type: z.literal("LineString"),
    coordinates: z.array(point).min(2),
  }),
  hourlyVehicleCounts: z
    .array(z.number().finite().nonnegative().nullable())
    .length(24),
  reportedTotal: z.number().finite().nonnegative().nullable(),
  availableHours: z.number().int().min(0).max(24),
  lanes: z.null(),
  direction: z.literal("source_link_unspecified"),
  source,
  limitations: z.array(z.string()),
});
export type HistoricalTrafficProfile = z.infer<
  typeof historicalTrafficProfileSchema
>;
export type HistoricalRisk = "low" | "moderate" | "high" | "unknown";
export const HISTORICAL_TRAFFIC_MODEL = {
  lowVehiclesPerHour: 500,
  moderateVehiclesPerHour: 1500,
  nearbyMeters: 300,
} as const;

/** The profile is historical context, never a measurement or forecast on the trip dates. */
export function evaluateHistoricalTraffic(
  input: unknown,
  coordinates: Point,
  checkIn: string,
  checkOut: string,
  now = new Date(),
) {
  const empty = {
    risk: "unknown" as HistoricalRisk,
    profiles: [] as (HistoricalTrafficProfile & {
      meters: number;
      peakVehiclesPerHour: number;
      risk: Exclude<HistoricalRisk, "unknown">;
    })[],
  };
  const parsed = z
    .object({
      schemaVersion: z.literal(1),
      region: z.literal("Пусан"),
      kind: z.literal("historical_observed_profile"),
      timeZone: z.literal("Asia/Seoul"),
      referenceYear: z.number().int(),
      dayType: z.literal("weekday"),
      source,
      historicalTrafficProfiles: z.array(z.unknown()),
    })
    .safeParse(input);
  const validDate = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (
    !parsed.success ||
    !point.safeParse(coordinates).success ||
    !validDate(checkIn) ||
    !validDate(checkOut) ||
    checkIn >= checkOut ||
    !Number.isFinite(+now)
  )
    return empty;
  if (Date.parse(parsed.data.source.retrievedAt) > +now) return empty;
  const from = Date.parse(`${checkIn}T00:00:00Z`),
    to = Date.parse(`${checkOut}T00:00:00Z`);
  let weekday = false;
  for (let t = from; t < Math.min(to, from + 7 * 86400000); t += 86400000) {
    const d = new Date(t).getUTCDay();
    if (d >= 1 && d <= 5) weekday = true;
  }
  if (!weekday) return empty;
  const tripYear = Number(checkIn.slice(0, 4)),
    nowYear = new Date(+now + 9 * 3600000).getUTCFullYear();
  for (const raw of parsed.data.historicalTrafficProfiles) {
    const result = historicalTrafficProfileSchema.safeParse(raw);
    if (!result.success) continue;
    const p = result.data;
    if (
      p.referenceYear !== parsed.data.referenceYear ||
      p.referenceYear > Math.min(tripYear, nowYear) ||
      tripYear - p.referenceYear > 3 ||
      Date.parse(p.source.retrievedAt) > +now
    )
      continue;
    const values = p.hourlyVehicleCounts.filter((v): v is number => v !== null);
    if (!values.length) continue;
    const meters = distance(
      coordinates,
      closestPointOnLine(coordinates, p.geometry.coordinates)!,
    );
    if (meters > 300) continue;
    const peak = Math.max(...values),
      load = peak > 1500 ? "high" : peak > 500 ? "moderate" : "low";
    const risk =
      load === "high" && meters <= 75
        ? "high"
        : load !== "low" && meters <= 150
          ? "moderate"
          : "low";
    empty.profiles.push({
      ...p,
      availableHours: values.length,
      meters,
      peakVehiclesPerHour: peak,
      risk,
    });
  }
  empty.profiles.sort((a, b) => a.meters - b.meters);
  empty.risk = empty.profiles.some((p) => p.risk === "high")
    ? "high"
    : empty.profiles.some((p) => p.risk === "moderate")
      ? "moderate"
      : empty.profiles.length
        ? "low"
        : "unknown";
  return empty;
}
