import type { FeatureId, Preference, PreferenceOverride, Trip } from "../../../shared/types";
import { featureIds, features } from "../../../shared/features";

interface FilterState {
  preference: Preference | null;
  override: PreferenceOverride | null;
}
export interface ChatFilterChange {
  feature: FeatureId;
  before: FilterState;
  after: FilterState;
}

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
  return changes.filter((change) => same(change.after, state(trip, change.feature)));
}

export function recordChatFilters(changes: ChatFilterChange[], before: Trip, after: Trip, edited: FeatureId[]) {
  const next = new Map(currentChatFilters(changes, before).map((change) => [change.feature, change]));
  for (const feature of edited) {
    const previous = state(before, feature), applied = state(after, feature);
    if (same(previous, applied)) continue;
    const original = next.get(feature)?.before || previous;
    if (same(original, applied)) next.delete(feature);
    else next.set(feature, { feature, before: original, after: applied });
  }
  return [...next.values()];
}

export function resetChatFilters(trip: Trip, changes: ChatFilterChange[]): Trip {
  const current = currentChatFilters(changes, trip);
  if (!current.length) return trip;
  const preferences = new Map(trip.preferences.map((p) => [p.feature, p]));
  const overrides = new Map((trip.preferenceOverrides || []).map((p) => [p.feature, p]));
  for (const { feature, before } of current) {
    if (before.preference) preferences.set(feature, before.preference);
    else preferences.delete(feature);
    if (before.override) overrides.set(feature, before.override);
    else overrides.delete(feature);
  }
  return { ...trip, preferences: [...preferences.values()], preferenceOverrides: overrides.size ? [...overrides.values()] : undefined };
}

export function readChatFilters(value: unknown): ChatFilterChange[] {
  if (!Array.isArray(value) || value.length > featureIds.length) return [];
  return value.filter((change): change is ChatFilterChange => {
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
