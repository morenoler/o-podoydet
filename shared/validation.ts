import { z } from "zod";
import { amenityIds } from "./amenities";
export const featureSchema = z.enum([
  "beach_walk",
  "step_free_route",
  "courtyard",
  "step_free_access",
  "family",
  "area_safety",
  "clean_air",
  "low_noise",
  ...amenityIds,
]);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Некорректная дата");
const locationWishSchema = z.object({
  query: z.string().trim().min(1).max(160),
  relation: z.enum(["near", "far"]),
  radiusMeters: z.number().int().min(50).max(50000),
  required: z.boolean(),
});
export const tripSchema = z
  .object({
    locationWishes: z.array(locationWishSchema).max(8).optional(),
    pendingLocationQuery: locationWishSchema.nullable().optional(),
    admissionMode: z.enum(["explore", "verified"]).optional(),
    region: z.literal("Пусан"),
    checkIn: date,
    checkOut: date,
    adults: z.number().int().min(1).max(6),
    children: z.number().int().min(0).max(4),
    scenarios: z
      .array(z.enum(["sea", "family", "quiet"]))
      .max(3)
      .refine((s) => new Set(s).size === s.length, "Сценарии повторяются"),
    preferences: z
      .array(z.object({ feature: featureSchema, required: z.boolean() }))
      .max(featureSchema.options.length)
      .refine(
        (p) => new Set(p.map((x) => x.feature)).size === p.length,
        "Пожелания повторяются",
      ),
    text: z.string().max(1500),
    preferenceOverrides: z.array(z.object({
      feature: featureSchema,
      required: z.boolean(),
      enabled: z.boolean(),
    })).max(featureSchema.options.length).refine((values) => new Set(values.map((v) => v.feature)).size === values.length).optional(),
  })
  .refine((t) => t.checkOut > t.checkIn, {
    message: "Дата выезда должна быть позже даты заезда",
    path: ["checkOut"],
  });
export const extractionSchema = z.object({
  feature: z.enum(["courtyard", "step_free_access", "family"]),
  value: z.boolean(),
  quote: z.string().min(1).max(1500),
});
