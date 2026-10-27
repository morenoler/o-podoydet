import config from "../data/busan/place-categories.json";
import type { Hotel, HotelFilters, NearbyCondition, NearbyKind, NearbyPlace } from "./types";

export const nearbyDefinitions = config as { key: NearbyKind; label: string; defaultMaxMeters: number; aliases: string[]; osmQueries: string[] }[];
export const nearbyLabel = (kind: NearbyKind) => nearbyDefinitions.find((item) => item.key === kind)!.label;
export const nearbyConditionLabel = (condition: NearbyCondition) => `${nearbyLabel(condition.kind)} · до ${condition.maxMeters.toLocaleString("ru-RU")} м по прямой`;
const validPoint = (point: unknown): point is [number, number] => Array.isArray(point) && point.length === 2
  && Number.isFinite(point[0]) && Math.abs(point[0]) <= 180 && Number.isFinite(point[1]) && Math.abs(point[1]) <= 90;
function instant(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const day = value.slice(0, 10), parsedDay = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsedDay.getTime()) && parsedDay.toISOString().startsWith(day) ? Date.parse(value) : NaN;
}

/** A mapped point is evidence of proximity, never of opening hours or a walkable route. */
export function validNearbyPlace(place: NearbyPlace, now = Date.now()): boolean {
  return place.status === "supported" && place.scope === "hotel_surroundings" && place.method === "haversine-osm-v1"
    && Number.isFinite(place.meters) && place.meters >= 0 && !!place.name?.trim()
    && /^(node|way|relation)\/[1-9]\d*$/.test(place.osmId) && place.sourceUrl === `https://www.openstreetmap.org/${place.osmId}`
    && validPoint(place.coordinates)
    && Number.isFinite(instant(place.obtainedAt)) && instant(place.obtainedAt) <= now
    && Number.isFinite(instant(place.expiresAt)) && instant(place.expiresAt) > now && instant(place.expiresAt) > instant(place.obtainedAt)
    && (place.sourceDate === undefined || (Number.isFinite(instant(place.sourceDate)) && instant(place.sourceDate) <= now));
}

export function nearbyMatches(hotel: Hotel, filters?: HotelFilters, now = Date.now()): NearbyPlace[] {
  if (hotel.synthetic || !validPoint(hotel.coordinates)) return [];
  return (filters?.nearby || []).flatMap((condition) => {
    const match = hotel.nearbyPlaces?.filter((place) => place.kind === condition.kind && validNearbyPlace(place, now) && place.meters <= condition.maxMeters)
      .sort((a, b) => a.meters - b.meters || a.osmId.localeCompare(b.osmId))[0];
    return match ? [match] : [];
  });
}

export function matchesNearby(hotel: Hotel, filters?: HotelFilters, now = Date.now()): boolean {
  return nearbyMatches(hotel, filters, now).length === (filters?.nearby?.length || 0);
}
