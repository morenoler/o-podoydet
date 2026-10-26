import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFilterDraft, editPreferences } from "../src/features/search/preferences";
import { tripSchema } from "../shared/validation";
import type { Trip } from "../shared/types";

const trip: Trip = {
  region: "Пусан", checkIn: "2027-06-10", checkOut: "2027-06-17",
  adults: 2, children: 0, scenarios: [], preferences: [], text: "Обязательно рядом с пляжем",
};
test("removing an inferred wish explicitly overrides the original text", () => {
  const next = editPreferences(trip, [], [{ feature: "beach_walk", required: true }]);
  assert.deepEqual(next.preferenceOverrides, [{ feature: "beach_walk", enabled: false, required: false }]);
  assert.equal(next.text, trip.text);
  assert.equal(tripSchema.parse(next).preferenceOverrides?.[0].enabled, false);
});
test("manual edits retain unrelated chat criteria and their overrides", () => {
  const current: Trip = { ...trip, preferences: [{ feature: "low_noise", required: true }],
    preferenceOverrides: [{ feature: "beach_walk", required: false, enabled: false }] };
  const next = editPreferences(current, [...current.preferences, { feature: "family", required: false }]);
  assert.deepEqual(next.preferences[0], current.preferences[0]);
  assert.equal(next.preferenceOverrides?.find((p) => p.feature === "beach_walk")?.enabled, false);
  assert.equal(next.checkIn, trip.checkIn);
});
test("removing and re-adding a wish replaces its override", () => {
  const removed = editPreferences(trip, [], [{ feature: "beach_walk", required: true }]);
  const added = editPreferences(removed, [{ feature: "beach_walk", required: false }]);
  assert.deepEqual(added.preferenceOverrides, [{ feature: "beach_walk", enabled: true, required: false }]);
});

test("an unrelated text edit keeps a previously removed criterion suppressed", () => {
  const removed = editPreferences(trip, [], [{ feature: "beach_walk", required: true }]);
  const applied = applyFilterDraft(removed, [], removed, { ...removed, text: `${removed.text}. Второй этаж` });
  assert.deepEqual(applied.preferenceOverrides, removed.preferenceOverrides);
});

test("an open filter dialog rebases its changes onto a newer chat reply", () => {
  const newer: Trip = { ...trip, preferences: [{ feature: "low_noise", required: true }] };
  const draft: Trip = { ...trip, preferences: [{ feature: "family", required: false }] };
  const applied = applyFilterDraft(newer, newer.preferences, trip, draft);
  assert.deepEqual(applied.preferences, [...newer.preferences, ...draft.preferences]);
});
