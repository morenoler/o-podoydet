import type { LocationCriterion, Trip } from "../../../shared/types";

export type LocationWish = NonNullable<Trip["locationWishes"]>[number];

const categoryLabels: Record<string, string> = {
  cafe: "кафе", restaurant: "рестораны", supermarket: "продуктовые магазины",
  pharmacy: "аптеки", subway: "метро", park: "парк", attraction: "достопримечательности",
};

export function locationWishLabel(wish: LocationWish) {
  const query = categoryLabels[wish.query.toLocaleLowerCase("ru-RU")] || wish.query;
  const distance = wish.radiusMeters >= 1000
    ? `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(wish.radiusMeters / 1000)} км`
    : `${wish.radiusMeters} м`;
  return `${query}: ${wish.relation === "far" ? "не ближе" : "до"} ${distance}`;
}

export function locationState(criterion: LocationCriterion) {
  if (criterion.evidenceStatus === "mismatch") return "mismatch";
  return criterion.status === "match" && criterion.evidenceStatus === "match" ? "match" : "unknown";
}

export function locationDistance(meters: number) {
  return meters >= 1000
    ? `≈ ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(meters / 1000)} км`
    : `≈ ${Math.round(meters)} м`;
}
