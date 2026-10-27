import type { Preference, Trip } from "../../../shared/types";

/** Keep explicit edits authoritative even when the old free text mentions the same wish. */
export function editPreferences(trip: Trip, next: Preference[], current = trip.preferences): Trip {
  const overrides = new Map((trip.preferenceOverrides || []).map((p) => [p.feature, p]));
  const ids = new Set([...current, ...next].map((p) => p.feature));
  for (const feature of ids) {
    const previous = current.find((p) => p.feature === feature);
    const preference = next.find((p) => p.feature === feature);
    if (previous?.required === preference?.required && !!previous === !!preference) continue;
    overrides.set(feature, { feature, enabled: !!preference, required: preference?.required || false });
  }
  return { ...trip, preferences: next, preferenceOverrides: [...overrides.values()] };
}

/** Rebase a modal's own edits if a chat reply arrived while the modal was open. */
export function applyFilterDraft(trip: Trip, current: Preference[], initial: Trip, draft: Trip, reset = false): Trip {
  const admissionMode = initial.admissionMode === draft.admissionMode ? trip.admissionMode : draft.admissionMode;
  if (reset) return { ...trip, admissionMode, preferences: draft.preferences, text: draft.text, scenarios: draft.scenarios, preferenceOverrides: undefined, hotelFilters: draft.hotelFilters };
  const hotelFilters = { ...trip.hotelFilters };
  for (const key of ["query", "lodgingTypes", "maxPricePerNight", "maxBeachMeters"] as const) {
    if (JSON.stringify(initial.hotelFilters?.[key]) === JSON.stringify(draft.hotelFilters?.[key])) continue;
    Object.assign(hotelFilters, { [key]: draft.hotelFilters?.[key] });
  }
  const next = new Map(current.map((p) => [p.feature, p]));
  for (const feature of new Set([...initial.preferences, ...draft.preferences].map((p) => p.feature))) {
    const before = initial.preferences.find((p) => p.feature === feature);
    const after = draft.preferences.find((p) => p.feature === feature);
    if (before?.required === after?.required && !!before === !!after) continue;
    if (after) next.set(feature, after);
    else next.delete(feature);
  }
  return { ...editPreferences(trip, [...next.values()], current), admissionMode, hotelFilters, text: initial.text === draft.text ? trip.text : draft.text };
}
