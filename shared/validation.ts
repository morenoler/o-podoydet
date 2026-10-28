import { z } from "zod";
import { amenityIds } from "./amenities";
import { nearbyKinds } from "./types";
import { regionNames } from "./regions";
export const nearbyConditionsSchema = z.array(z.object({ kind: z.enum(nearbyKinds), maxMeters: z.number().min(1).max(10_000) }).strict())
  .max(nearbyKinds.length).refine((items) => new Set(items.map((item) => item.kind)).size === items.length, "Условия окружения повторяются");
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
export const locationWishSchema = z.object({
  query: z.string().min(1).max(120).refine((value) => !!value.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value), "Укажите название места без управляющих символов"),
  relation: z.enum(["near", "far"]),
  radiusMeters: z.number().int().min(50).max(20000),
  required: z.boolean(),
});
export const hotelFiltersSchema = z.object({
  nearby: nearbyConditionsSchema.optional(),
  query: z.string().max(240).transform((value) => value.trim()).optional(),
  lodgingTypes: z.array(z.enum(["hotel", "motel", "guest_house", "hostel", "apartment"]))
    .max(5).refine((values) => new Set(values).size === values.length, "Типы жилья повторяются").optional(),
  maxPricePerNight: z.number().positive().max(100_000_000).optional(),
  maxBeachMeters: z.number().positive().max(100_000).optional(),
}).strict();
export const tripSchema = z
  .object({
    locationWishes: z.array(locationWishSchema).max(8).refine((items) => new Set(items.map((item) => item.query.trim().toLowerCase().replaceAll("ё", "е"))).size === items.length, "Условия расположения повторяются").optional(),
    pendingLocationQuery: locationWishSchema.refine((value) => value.query === "center", "Некорректное уточнение центра").nullable().optional(),
    admissionMode: z.enum(["explore", "verified"]).optional(),
    hotelFilters: hotelFiltersSchema.optional(),
    region: z.enum(regionNames),
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
