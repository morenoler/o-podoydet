import type { BedType, ListingBed, ListingCoordinates } from "./account";

export const bedTypes: Record<BedType, { label: string; places: number; variable?: boolean }> = {
  single: { label: "Односпальная кровать", places: 1 },
  double: { label: "Двуспальная кровать", places: 2 },
  sofa: { label: "Раскладной диван", places: 2, variable: true },
  bunk: { label: "Двухъярусная кровать", places: 2 },
  folding: { label: "Раскладушка", places: 1 },
  futon: { label: "Футон / матрас", places: 1, variable: true },
  crib: { label: "Детская кроватка", places: 1 },
  other: { label: "Другое спальное место", places: 1, variable: true },
};

/** Infant cribs are shown separately and cannot establish capacity for other guests. */
export function sleepingPlacesTotal(beds: readonly ListingBed[]): number {
  return beds.reduce((total, bed) => total + (bed.type === "crib" ? 0 : bed.count * bed.placesPerUnit), 0);
}

export function validListingCoordinates(value: unknown): value is ListingCoordinates {
  return Array.isArray(value) && value.length === 2
    && typeof value[0] === "number" && Number.isFinite(value[0]) && Math.abs(value[0]) <= 180
    && typeof value[1] === "number" && Number.isFinite(value[1]) && Math.abs(value[1]) <= 90;
}

export function sleepingLayoutError(beds: readonly ListingBed[], sleepingPlaces: number | null, capacity: number, publishing: boolean): string | null {
  if (!beds.length && sleepingPlaces == null) {
    return publishing ? "Укажите кровати и спальные места перед публикацией." : null;
  }
  if (!beds.length || beds.length > 20) return "Добавьте от 1 до 20 строк со спальными местами.";
  for (const bed of beds) {
    const definition = bedTypes[bed.type];
    if (!definition || !Number.isInteger(bed.count) || bed.count < 1 || bed.count > 20
      || !Number.isInteger(bed.placesPerUnit) || bed.placesPerUnit < 1 || bed.placesPerUnit > 4
      || (!definition.variable && bed.placesPerUnit !== definition.places)
      || (bed.room != null && (typeof bed.room !== "string" || bed.room.trim().length > 60))) {
      return "Проверьте тип, количество и вместимость каждой кровати. Название комнаты — до 60 символов.";
    }
  }
  const total = sleepingPlacesTotal(beds);
  if (!Number.isInteger(sleepingPlaces) || sleepingPlaces !== total || total < 1 || total > 40) {
    return "Количество спальных мест должно совпадать с суммой мест на кроватях и диванах (от 1 до 40). Детские кроватки считаются отдельно.";
  }
  return publishing && total < capacity ? "Спальных мест меньше, чем указано гостей. Добавьте места или уменьшите максимум гостей." : null;
}
