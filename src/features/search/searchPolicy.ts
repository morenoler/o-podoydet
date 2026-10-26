import type { Hotel, Trip } from "../../../shared/types";

export type AdmissionMode = "explore" | "verified";

/** The browsing UI starts broad; the API's omitted-field default stays strict. */
export function uiAdmissionMode(value: unknown): AdmissionMode {
  return value === "verified" ? "verified" : "explore";
}

export function normalizeSearchTrip(trip: Trip): Trip {
  return { ...trip, admissionMode: uiAdmissionMode(trip.admissionMode) };
}

export function restoreSearchTrip(saved: unknown, initial: Trip): Trip {
  if (!saved || typeof saved !== "object" || Array.isArray(saved))
    return normalizeSearchTrip(initial);
  const value = saved as Partial<Trip>;
  return Array.isArray(value.preferences) && Array.isArray(value.scenarios)
    ? normalizeSearchTrip({ ...initial, ...value })
    : normalizeSearchTrip(initial);
}

export function listLimitForSelection(hotels: Hotel[], current: number, id: string) {
  const index = hotels.findIndex((hotel) => hotel.id === id);
  return index < 0 ? current : Math.max(current, Math.ceil((index + 1) / 8) * 8);
}

export const admissionDescriptions: Record<AdmissionMode, string> = {
  explore: "При нехватке данных покажем варианты для уточнения. Известные несоответствия и противоречия в обязательных условиях исключаем.",
  verified: "Вместимость и все обязательные условия должны быть подтверждены. Варианты с недостающими сведениями скрываем.",
};
