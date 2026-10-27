import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFilterDraft, editPreferences } from "../src/features/search/preferences";
import { tripSchema } from "../shared/validation";
import type { Trip } from "../shared/types";
import { currentChatFilters, legacyChatFilters, readChatFilters, recordChatFilters, resetChatFilters } from "../src/features/advisor/conversationFilters";
import { advisorTripKey } from "../src/features/advisor/useAdvisor";

const trip: Trip = {
  region: "Пусан", checkIn: "2027-06-10", checkOut: "2027-06-17",
  adults: 2, children: 0, scenarios: [], preferences: [], text: "Обязательно рядом с пляжем",
};
test("filter mode changes survive rebasing onto a newer chat reply", () => {
  const initial: Trip = { ...trip, admissionMode: "explore" };
  const newer = editPreferences(initial, [{ feature: "family", required: true }]);
  const applied = applyFilterDraft(newer, newer.preferences, initial, { ...initial, admissionMode: "verified" });
  assert.equal(applied.admissionMode, "verified");
  assert.deepEqual(applied.preferences, newer.preferences);
  assert.deepEqual(applied.preferenceOverrides, newer.preferenceOverrides);
  const changedElsewhere: Trip = { ...newer, admissionMode: "verified" };
  assert.equal(applyFilterDraft(changedElsewhere, newer.preferences, initial, initial).admissionMode, "verified");
  assert.equal(applyFilterDraft(newer, newer.preferences, initial, { ...initial, admissionMode: "verified", preferences: [] }, true).admissionMode, "verified");
});
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

test("chat reset removes its own criteria and retains manual filters, dates, guests and text", () => {
  const manual = editPreferences(trip, [{ feature: "family", required: true }]);
  const reply = editPreferences(manual, [...manual.preferences, { feature: "courtyard", required: false }]);
  const changes = recordChatFilters([], manual, reply, ["courtyard"]);
  const reset = resetChatFilters(reply, readChatFilters(JSON.parse(JSON.stringify(changes))));
  assert.deepEqual(reset, manual);
});

test("reset restores a previous manual condition after multiple chat edits", () => {
  const manual = editPreferences(trip, [{ feature: "family", required: true }]);
  const optional = editPreferences(manual, [{ feature: "family", required: false }]);
  const removed = editPreferences(optional, []);
  const first = recordChatFilters([], manual, optional, ["family"]);
  const changes = recordChatFilters(first, optional, removed, ["family"]);
  assert.deepEqual(resetChatFilters(removed, changes), manual);
});

test("manual edits after a chat reply survive reset, including other newly selected filters", () => {
  const reply = editPreferences(trip, [{ feature: "family", required: false }, { feature: "courtyard", required: false }]);
  const changes = recordChatFilters([], trip, reply, ["family", "courtyard"]);
  const manual = editPreferences(reply, [{ feature: "family", required: true }, { feature: "courtyard", required: false }, { feature: "low_noise", required: true }]);
  const active = currentChatFilters(changes, manual);
  assert.deepEqual(active.map((change) => change.feature), ["courtyard"]);
  const reset = resetChatFilters(manual, active);
  assert.deepEqual(reset.preferences, [{ feature: "family", required: true }, { feature: "low_noise", required: true }]);
  assert(!reset.preferenceOverrides?.some((p) => p.feature === "courtyard"));
});

test("a partly understood reply is reversible even when its pronoun focus is empty", () => {
  const before = editPreferences(trip, [{ feature: "family", required: true }]);
  // «Нужно тихо и гамак»: low_noise is applied, the unsupported hammock clears focus.
  const reply = editPreferences(before, [...before.preferences, { feature: "low_noise", required: false }]);
  const changes = recordChatFilters([], before, reply, []);
  assert.deepEqual(changes.map((change) => change.feature), ["low_noise"]);
  const restored = resetChatFilters(reply, readChatFilters(JSON.parse(JSON.stringify(changes))));
  assert.deepEqual(restored, before);
});

test("manual overrides survive reset after a reply with empty focus", () => {
  const before: Trip = { ...trip, hotelFilters: { query: "Signiel" } };
  const reply: Trip = {
    ...editPreferences(before, [{ feature: "low_noise", required: false }, { feature: "courtyard", required: false }]),
    hotelFilters: { query: "Signiel балкон" },
  };
  const changes = recordChatFilters([], before, reply, []);
  const manual = editPreferences(reply, [{ feature: "low_noise", required: true }, { feature: "courtyard", required: false }]);
  const reset = resetChatFilters(manual, changes);
  assert.deepEqual(reset.preferences, [{ feature: "low_noise", required: true }]);
  assert.deepEqual(reset.preferenceOverrides, [{ feature: "low_noise", required: true, enabled: true }]);
  assert.equal(reset.hotelFilters?.query, "Signiel");
});

test("reset preserves an existing free-text wish and removes only the chat override", () => {
  const removed = editPreferences(trip, [], [{ feature: "beach_walk", required: true }]);
  const changes = recordChatFilters([], trip, removed, ["beach_walk"]);
  const reset = resetChatFilters(removed, changes);
  assert.equal(reset.text, trip.text);
  assert.equal(reset.preferenceOverrides, undefined);
});

test("old chats can clear their explicit edits without removing unrelated manual criteria", () => {
  const current = editPreferences(trip, [{ feature: "family", required: true }, { feature: "courtyard", required: false }]);
  const changes = legacyChatFilters([{ role: "assistant", text: "Учтено: «Номер во двор» — желательно." }], current);
  assert.deepEqual(resetChatFilters(current, changes).preferences, [{ feature: "family", required: true }]);
});

test("malformed saved reset metadata cannot become a filter", () => {
  assert.deepEqual(readChatFilters([{ feature: "family", before: {}, after: null }]), []);
  assert.deepEqual(readChatFilters({}), []);
});

test("chat reset restores structured values but preserves later manual changes per field", () => {
  const manual: Trip = { ...trip, hotelFilters: { maxPricePerNight: 150000, query: "Hilton" } };
  const reply: Trip = { ...manual, hotelFilters: { ...manual.hotelFilters, maxPricePerNight: 100000, maxBeachMeters: 500, lodgingTypes: ["hotel"] } };
  const changes = recordChatFilters([], manual, reply, []);
  const later: Trip = { ...reply, hotelFilters: { ...reply.hotelFilters, maxBeachMeters: 900, query: "Signiel" } };
  const reset = resetChatFilters(later, readChatFilters(JSON.parse(JSON.stringify(changes))));
  assert.deepEqual(reset.hotelFilters, { maxPricePerNight: 150000, maxBeachMeters: 900, query: "Signiel" });
  assert.equal(reset.checkIn, manual.checkIn);
});

test("clearing a structured field is reversible and removes empty filter objects", () => {
  const reply: Trip = { ...trip, hotelFilters: { query: "балкон", maxBeachMeters: 300 } };
  const changes = recordChatFilters([], trip, reply, []);
  assert.deepEqual(resetChatFilters(reply, changes), { ...trip, preferenceOverrides: undefined });
  const cleared: Trip = { ...reply, hotelFilters: { query: "балкон" } };
  const removed = recordChatFilters([], reply, cleared, []);
  assert.deepEqual(resetChatFilters(cleared, removed).hotelFilters, reply.hotelFilters);
});

test("owner text appended by chat can be reset and never replaces a later manual text edit", () => {
  const reply = { ...trip, text: trip.text + ". не выше 3 этажа" };
  const changes = recordChatFilters([], trip, reply, []);
  assert.equal(resetChatFilters(reply, changes).text, trip.text);
  const manual = { ...reply, text: reply.text + ". окна на восток" };
  assert.equal(resetChatFilters(manual, changes).text, manual.text);
});

test("saved structured filter journal rejects invalid fields and limits", () => {
  assert.deepEqual(readChatFilters([
    { field: "query", before: null, after: "x".repeat(241) },
    { field: "maxBeachMeters", before: null, after: -1 },
    { field: "lodgingTypes", before: null, after: ["castle"] },
    { field: "admin", before: null, after: true },
    { field: "text", before: null, after: "hello" },
  ]), []);
});

test("advisor identity changes with every search filter but not the order of lodging types", () => {
  for (const hotelFilters of [{ query: "Signiel" }, { maxPricePerNight: 100000 }, { maxBeachMeters: 500 }, { lodgingTypes: ["hotel" as const] }])
    assert.notEqual(advisorTripKey(trip), advisorTripKey({ ...trip, hotelFilters }));
  assert.equal(advisorTripKey({ ...trip, hotelFilters: { lodgingTypes: ["hotel", "apartment"] } }),
    advisorTripKey({ ...trip, hotelFilters: { lodgingTypes: ["apartment", "hotel"] } }));
});
