import type { FavoriteItem, Shortlist, ShortlistStage } from "../../../shared/shortlist";
import { shortlistStages } from "../../../shared/shortlist";
import type { Trip } from "../../../shared/types";
import { tripSchema } from "../../../shared/validation";
import { isPhotoUrl } from "../../shared/lib/hotelPhotos";

export function emptyShortlist(): Shortlist {
  return { title: "Моя поездка", trip: null, items: [], revision: 0, updatedAt: null };
}
export function shortlistTrip(value: unknown): Trip | null {
  if (!value || typeof value !== "object") return null;
  const datesMissing = (value as Trip).checkIn === "" && (value as Trip).checkOut === "";
  const parsed = tripSchema.safeParse(datesMissing ? { ...value, checkIn: "2099-01-01", checkOut: "2099-01-02" } : value);
  return parsed.success ? { ...parsed.data, ...(datesMissing ? { checkIn: "", checkOut: "" } : {}) } : null;
}
export function safeFavorite(value: unknown): FavoriteItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<FavoriteItem>;
  if (typeof item.id !== "string" || !item.id || item.id.length > 300 ||
      typeof item.name !== "string" || !item.name.trim() || item.name.length > 300 ||
      typeof item.path !== "string" || item.path.length > 1000 ||
      !/^\/(stays|hotels)\/[^/?#\\\s<>]+(?:\?room=[^&#\\\s<>]+)?$/.test(item.path)) return null;
  return {
    id: item.id, name: item.name, path: item.path,
    hotelId: typeof item.hotelId === "string" ? item.hotelId.slice(0, 500) : undefined,
    address: typeof item.address === "string" ? item.address.slice(0, 500) : undefined,
    photos: Array.isArray(item.photos) ? item.photos.filter(isPhotoUrl).slice(0, 12) : undefined,
    note: typeof item.note === "string" ? item.note.slice(0, 1500) : "",
    stage: typeof item.stage === "string" && Object.hasOwn(shortlistStages, item.stage) ? item.stage as ShortlistStage : "considering",
    savedAt: typeof item.savedAt === "string" && /^\d{4}-\d\d-\d\dT/.test(item.savedAt) && Number.isFinite(Date.parse(item.savedAt)) ? item.savedAt : undefined,
  };
}
export function parseShortlist(value: unknown): Shortlist {
  const initial = emptyShortlist();
  if (!value || typeof value !== "object" || Array.isArray(value)) return initial;
  const raw = value as Partial<Shortlist>;
  const seen = new Set<string>();
  const items = Array.isArray(raw.items) ? raw.items.map(safeFavorite).filter((item): item is FavoriteItem => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id); return true;
  }).slice(0, 200) : [];
  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.slice(0, 100) : initial.title,
    trip: shortlistTrip(raw.trip), items,
    revision: Number.isSafeInteger(raw.revision) && raw.revision! >= 0 ? raw.revision! : 0,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    shareActive: raw.shareActive === true,
  };
}
/** Existing notes win when deliberately importing saved browser cards. */
export function mergeShortlistItems(current: FavoriteItem[], imported: FavoriteItem[]) {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...imported.filter((item) => !ids.has(item.id) && Boolean(ids.add(item.id)))].slice(0, 200);
}

/** Import the saved journey with its cards, never silently substitute the active search. */
export function importShortlist(current: Shortlist, browser: Shortlist): Shortlist {
  const empty = !current.items.length && !current.trip;
  return {
    ...current,
    ...(empty ? { title: browser.title, trip: browser.trip } : {}),
    items: mergeShortlistItems(current.items, browser.items),
  };
}
