import { z } from "zod";
export const featureSchema = z.enum([
  "beach_walk",
  "step_free_route",
  "courtyard",
  "step_free_access",
  "family",
]);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Некорректная дата");
export const tripSchema = z
  .object({
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
      .max(5)
      .refine(
        (p) => new Set(p.map((x) => x.feature)).size === p.length,
        "Пожелания повторяются",
      ),
    text: z.string().max(1500),
  })
  .refine((t) => t.checkOut > t.checkIn, {
    message: "Дата выезда должна быть позже даты заезда",
    path: ["checkOut"],
  });
export const extractionSchema = z.object({
  feature: featureSchema,
  value: z.boolean(),
  quote: z.string().min(1).max(1500),
});
