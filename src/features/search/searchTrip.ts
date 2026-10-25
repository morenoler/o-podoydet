import type { Trip } from "../../../shared/types";
import { tripSchema } from "../../../shared/validation";

export function canSearch(trip: Trip) {
  return tripSchema.safeParse(trip).success;
}

export function nextSearchDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function searchToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
