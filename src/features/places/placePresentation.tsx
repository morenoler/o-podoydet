import type { Point } from "../../../shared/types";

export interface SurroundingPlace {
  id: string;
  name: string;
  meters: number;
  sourceUrl: string;
  categories?: string[];
  coordinates?: Point;
  interpretation?: string;
  obtainedAt?: string;
  sourceDate?: string;
}
export interface Surroundings {
  status: "available" | "unknown";
  places: SurroundingPlace[];
  centers: SurroundingPlace[];
  method: string;
  assumptions: string[];
  obtainedAt?: string;
  sourceDate?: string;
}
const icons = {
  pharmacy: { label: "Аптека", tone: "green", paths: ["M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z"] },
  supermarket: { label: "Магазин", tone: "green", paths: ["M3 9l2-6h14l2 6M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v9h14v-9M9 21v-6h6v6"] },
  cafe: { label: "Кафе", tone: "pink", paths: ["M4 8h12v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4ZM16 9h2a3 3 0 0 1 0 6h-2M6 3v2M10 3v2M14 3v2"] },
  restaurant: { label: "Ресторан", tone: "pink", paths: ["M4 3v6a3 3 0 0 0 6 0V3M7 3v18M20 21V3c-4 2-5 7-5 10h5"] },
  park: { label: "Парк", tone: "green", paths: ["M12 2 4 12h4l-5 6h18l-5-6h4ZM12 18v4"] },
  subway: { label: "Метро", tone: "purple", paths: ["M5 16V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3ZM5 11h14M8 15h.01M16 15h.01M8 19l-3 3M16 19l3 3"] },
  museum: { label: "Музей", tone: "purple", paths: ["M3 9 12 3l9 6ZM4 21h16M6 10v8M12 10v8M18 10v8"] },
  bar: { label: "Бар", tone: "purple", paths: ["M3 3h18l-9 10ZM12 13v8M7 21h10"] },
  beach: { label: "Пляж", tone: "yellow", paths: ["M3 12a9 9 0 0 1 18 0ZM12 3v17M2 21h20"] },
  place: { label: "Место", tone: "neutral", paths: ["M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z", "M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0"] },
} as const;
export function placePresentation(categories: string[] = []) {
  const category = categories.find(value => value in icons || ["convenience", "shopping_mall", "train_station"].includes(value));
  const key = category === "convenience" || category === "shopping_mall" ? "supermarket" : category === "train_station" ? "subway" : category;
  return icons[key as keyof typeof icons] || icons.place;
}
export function PlaceIcon({ categories, size = 18 }: { categories?: string[]; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {placePresentation(categories).paths.map((d, index) => <path key={index} d={d} />)}
  </svg>;
}
export function nearbyDisplayPlaces(places: SurroundingPlace[], hotelId: string) {
  const ownUrl = `https://www.openstreetmap.org/${hotelId.replace(/^(node|way|relation)-/, "$1/")}`;
  const seen = new Set<string>();
  return places.filter(place => {
    if (!place.id || seen.has(place.id) || place.sourceUrl === ownUrl || !Number.isFinite(place.meters) || place.meters < 0) return false;
    seen.add(place.id);
    return true;
  });
}
export function validMapPlaces(places: SurroundingPlace[]): (SurroundingPlace & { coordinates: Point })[] {
  return places.filter((place): place is SurroundingPlace & { coordinates: Point } => !!place.coordinates
    && place.coordinates.length === 2 && place.coordinates.every(Number.isFinite) && Math.abs(place.coordinates[0]) <= 180
    && Math.abs(place.coordinates[1]) <= 85.05112878 && /^https:\/\//.test(place.sourceUrl));
}
