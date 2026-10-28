import type { Trip } from "../../../shared/types";
import type { LocationWish } from "../places/locationPresentation";

interface WishChange { query: string; before: LocationWish | null; after: LocationWish | null }
interface PendingChange {
  before: Trip["pendingLocationQuery"];
  after: Trip["pendingLocationQuery"];
}
export interface ChatLocationChanges { wishes: WishChange[]; pending?: PendingChange }
export const emptyLocationChanges: ChatLocationChanges = { wishes: [] };
const key = (query: string) => query.trim().toLocaleLowerCase("ru-RU");
const equal = (a: LocationWish | null | undefined, b: LocationWish | null | undefined) =>
  (!a && !b) || (!!a && !!b && key(a.query) === key(b.query) && a.relation === b.relation && a.radiusMeters === b.radiusMeters && a.required === b.required);
const current = (trip: Trip, query: string) => trip.locationWishes?.find((wish) => key(wish.query) === query) || null;

export function currentChatLocations(changes: ChatLocationChanges, trip: Trip): ChatLocationChanges {
  return {
    wishes: changes.wishes.filter((change) => equal(change.after, current(trip, change.query))),
    ...(changes.pending && equal(changes.pending.after, trip.pendingLocationQuery) ? { pending: changes.pending } : {}),
  };
}

export function recordChatLocations(changes: ChatLocationChanges, before: Trip, after: Trip): ChatLocationChanges {
  const active = currentChatLocations(changes, before);
  const next = new Map(active.wishes.map((change) => [change.query, change]));
  const queries = new Set([...(before.locationWishes || []), ...(after.locationWishes || [])].map((wish) => key(wish.query)));
  for (const query of queries) {
    const previous = current(before, query), applied = current(after, query);
    if (equal(previous, applied)) continue;
    const original = next.has(query) ? next.get(query)!.before : previous;
    if (equal(original, applied)) next.delete(query);
    else next.set(query, { query, before: original, after: applied });
  }
  let pending = active.pending;
  if (!equal(before.pendingLocationQuery, after.pendingLocationQuery)) {
    const original = pending ? pending.before : before.pendingLocationQuery;
    pending = equal(original, after.pendingLocationQuery) ? undefined : { before: original, after: after.pendingLocationQuery };
  }
  return { wishes: [...next.values()], ...(pending ? { pending } : {}) };
}

export function resetChatLocations(trip: Trip, changes: ChatLocationChanges): Trip {
  const active = currentChatLocations(changes, trip);
  if (!active.wishes.length && !active.pending) return trip;
  const wishes = new Map((trip.locationWishes || []).map((wish) => [key(wish.query), wish]));
  for (const change of active.wishes) {
    if (change.before) wishes.set(change.query, change.before);
    else wishes.delete(change.query);
  }
  return { ...trip, ...(active.wishes.length ? { locationWishes: [...wishes.values()] } : {}),
    ...(active.pending ? { pendingLocationQuery: active.pending.before || null } : {}) };
}

function validWish(value: unknown): value is LocationWish | null {
  if (value == null) return true;
  if (typeof value !== "object") return false;
  const wish = value as LocationWish;
  return typeof wish.query === "string" && wish.query.trim().length > 0 && wish.query.length <= 120
    && ["near", "far"].includes(wish.relation) && typeof wish.required === "boolean"
    && Number.isInteger(wish.radiusMeters) && wish.radiusMeters >= 50 && wish.radiusMeters <= 20000;
}

export function readChatLocations(value: unknown): ChatLocationChanges {
  if (!value || typeof value !== "object") return emptyLocationChanges;
  const candidate = value as ChatLocationChanges;
  if (!Array.isArray(candidate.wishes) || candidate.wishes.length > 16) return emptyLocationChanges;
  const wishes = candidate.wishes.filter((change) => change && typeof change.query === "string"
    && validWish(change.before) && validWish(change.after)
    && (!change.before || key(change.before.query) === change.query)
    && (!change.after || key(change.after.query) === change.query));
  return { wishes, ...(candidate.pending && validWish(candidate.pending.before) && validWish(candidate.pending.after) ? { pending: candidate.pending } : {}) };
}
