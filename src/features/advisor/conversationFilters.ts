import type { FeatureId, Preference, PreferenceOverride, Trip } from "../../../shared/types";
import { featureIds, features } from "../../../shared/features";

interface FilterState {
  preference: Preference | null;
  override: PreferenceOverride | null;
}
interface FeatureChange {
  feature: FeatureId;
  field?: never;
  before: FilterState;
  after: FilterState;
}
type Field = "query" | "lodgingTypes" | "maxPricePerNight" | "maxBeachMeters" | "text";
type FieldValue = string | string[] | number | null;
interface FieldChange {
  field: Field;
  feature?: never;
  before: FieldValue;
  after: FieldValue;
}
export type ChatFilterChange = FeatureChange | FieldChange;
const fields: Field[] = ["query", "lodgingTypes", "maxPricePerNight", "maxBeachMeters", "text"];
const fieldState = (trip: Trip, field: Field): FieldValue => field === "text" ? trip.text : trip.hotelFilters?.[field] ?? null;
const sameValue = (a: FieldValue, b: FieldValue) => JSON.stringify(a) === JSON.stringify(b);

function state(trip: Trip, feature: FeatureId): FilterState {
  return {
    preference: trip.preferences.find((p) => p.feature === feature) || null,
    override: trip.preferenceOverrides?.find((p) => p.feature === feature) || null,
  };
}
function same(a: FilterState, b: FilterState) {
  return !!a.preference === !!b.preference && a.preference?.required === b.preference?.required
    && !!a.override === !!b.override && a.override?.enabled === b.override?.enabled
    && a.override?.required === b.override?.required;
}

/** A later manual edit owns the condition; resetting chat must leave it alone. */
export function currentChatFilters(changes: ChatFilterChange[], trip: Trip) {
  return changes.filter((change) => change.field ? sameValue(change.after, fieldState(trip, change.field)) : same(change.after, state(trip, change.feature)));
}

export function recordChatFilters(changes: ChatFilterChange[], before: Trip, after: Trip, _focusFeatures: FeatureId[]) {
  const next = new Map<string, ChatFilterChange>(currentChatFilters(changes, before).map((change) => [change.field || change.feature, change]));
  // Pronoun focus may be cleared for a partly understood message. The applied
  // trip diff, not conversational focus, is the authority for undo ownership.
  for (const feature of featureIds) {
    const previous = state(before, feature), applied = state(after, feature);
    if (same(previous, applied)) continue;
    const existing = next.get(feature) as FeatureChange | undefined;
    const original = existing?.before || previous;
    if (same(original, applied)) next.delete(feature);
    else next.set(feature, { feature, before: original, after: applied });
  }
  for (const field of fields) {
    const previous = fieldState(before, field), applied = fieldState(after, field);
    if (sameValue(previous, applied)) continue;
    const existing = next.get(field) as FieldChange | undefined;
    const original = existing ? existing.before : previous;
    if (sameValue(original, applied)) next.delete(field);
    else next.set(field, { field, before: original, after: applied });
  }
  return [...next.values()];
}

export function resetChatFilters(trip: Trip, changes: ChatFilterChange[]): Trip {
  const current = currentChatFilters(changes, trip);
  if (!current.length) return trip;
  const preferences = new Map(trip.preferences.map((p) => [p.feature, p]));
  const overrides = new Map((trip.preferenceOverrides || []).map((p) => [p.feature, p]));
  const restored: Trip = { ...trip, hotelFilters: { ...trip.hotelFilters } };
  for (const change of current) {
    if (change.field) {
      if (change.field === "text") restored.text = change.before as string;
      else if (change.before === null) delete restored.hotelFilters![change.field];
      else Object.assign(restored.hotelFilters!, { [change.field]: change.before });
      continue;
    }
    const { feature, before } = change;
    if (before.preference) preferences.set(feature, before.preference);
    else preferences.delete(feature);
    if (before.override) overrides.set(feature, before.override);
    else overrides.delete(feature);
  }
  if (!Object.keys(restored.hotelFilters!).length) delete restored.hotelFilters;
  return { ...restored, preferences: [...preferences.values()], preferenceOverrides: overrides.size ? [...overrides.values()] : undefined };
}

export function readChatFilters(value: unknown): ChatFilterChange[] {
  if (!Array.isArray(value) || value.length > featureIds.length + fields.length) return [];
  return value.filter((change): change is ChatFilterChange => {
    if (change?.field && fields.includes(change.field)) {
      return [change.before, change.after].every((entry) => {
        if (entry === null) return change.field !== "text";
        if (change.field === "query" || change.field === "text") return typeof entry === "string" && entry.length <= (change.field === "query" ? 240 : 1500);
        if (change.field === "lodgingTypes") return Array.isArray(entry) && entry.length <= 5 && entry.every((type) => ["hotel", "motel", "guest_house", "hostel", "apartment"].includes(type));
        return typeof entry === "number" && Number.isFinite(entry) && entry > 0 && entry <= (change.field === "maxPricePerNight" ? 100_000_000 : 100_000);
      });
    }
    if (!change || !featureIds.includes(change.feature)) return false;
    return [change.before, change.after].every((entry) => entry &&
      (entry.preference === null || (entry.preference?.feature === change.feature && typeof entry.preference.required === "boolean")) &&
      (entry.override === null || (entry.override?.feature === change.feature && typeof entry.override.required === "boolean" && typeof entry.override.enabled === "boolean")));
  });
}

/** Older chats have no edit journal. Only migrate explicit, still-current assistant edits. */
export function legacyChatFilters(messages: { role: string; text: string }[], trip: Trip): ChatFilterChange[] {
  const edited = new Map<FeatureId, string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const feature of featureIds) {
      const prefix = `«${features[feature].label}» — `;
      const index = message.text.indexOf(prefix);
      if (index >= 0) edited.set(feature, message.text.slice(index + prefix.length).split(/[;.\n]/)[0]);
    }
  }
  return [...edited].flatMap(([feature, action]) => {
    const after = state(trip, feature);
    const enabled = action !== "убрано", required = action === "обязательно";
    if (!["убрано", "обязательно", "желательно"].includes(action)
      || after.override?.enabled !== enabled || after.override.required !== required
      || !!after.preference !== enabled || (enabled && after.preference?.required !== required)) return [];
    return [{ feature, before: { preference: null, override: null }, after }];
  });
}
