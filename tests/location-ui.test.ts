import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { HotelMatch, LocationCriterion, LocationWish, Trip } from "../shared/types";
import { LocationCriteria } from "../src/features/places/LocationCriteria";
import { locationState, locationWishLabel } from "../src/features/places/locationPresentation";
import { currentChatLocations, emptyLocationChanges, readChatLocations, recordChatLocations, resetChatLocations } from "../src/features/advisor/conversationLocations";
import { resetSearchFilters, applyFilterDraft } from "../src/features/search/preferences";
import { hasKnownRequiredMismatch, matchLabel, matchPresentationState } from "../src/shared/lib/matchPresentation";
import { personalWishSummary } from "../src/shared/lib/personalWishes";

const base: Trip = { region: "Пусан", checkIn: "2027-06-10", checkOut: "2027-06-17", adults: 2, children: 0, scenarios: [], preferences: [], text: "" };
const cafe: LocationWish = { query: "cafe", relation: "near", radiusMeters: 500, required: false };
const center: LocationWish = { query: "центр", relation: "near", radiusMeters: 1000, required: true };
const criterion: LocationCriterion = { id: "cafe", query: "cafe", label: "Кафе в пределах 500 м", required: true,
  status: "unknown", evidenceStatus: "unknown", explanation: "Неизвестны координаты здания.", places: [], method: "haversine", assumptions: [] };
const room = { room: { id: "room", name: "Учебный номер", capacity: 2, demo: true }, criteria: [], score: 0, status: "fits" as const, capacityEvidenceStatus: "match" as const };
const match: HotelMatch = { hotel: { id: "fixture", name: "Учебный отель", address: "", coordinates: null, osmUrl: "", rooms: [room.room], route: null, noise: [] }, best: room, rooms: [room], locationCriteria: [criterion] };

test("unknown geospatial data never turns a room badge or personal wish into a match", () => {
  assert.equal(matchPresentationState(match), "unknown");
  assert.equal(matchLabel(match), "Есть условия для уточнения");
  assert.equal(personalWishSummary(match)?.tone, "unknown");
  assert.equal(locationState({ ...criterion, status: "match" }), "unknown");
  const failed = { ...match, locationCriteria: [{ ...criterion, status: "mismatch" as const, evidenceStatus: "mismatch" as const }] };
  assert.equal(hasKnownRequiredMismatch(failed), true);
  assert.equal(matchPresentationState(failed), "mismatch");
});

test("location evidence displays the actual named place, source and straight-line distance", () => {
  const html = renderToStaticMarkup(createElement(LocationCriteria, { criteria: [{ ...criterion, status: "match", evidenceStatus: "match", explanation: "Найдена отмеченная на карте кофейня.", places: [{ id: "fixture-cafe", name: "Учебная кофейня", meters: 384, sourceUrl: "https://example.test/place" }] }] }));
  assert.match(html, /Учебная кофейня/);
  assert.match(html, /384 м/);
  assert.match(html, /по прямой/);
  assert.match(html, /https:\/\/example.test\/place/);
  assert.match(html, /не пешеходный маршрут/);
  assert.match(locationWishLabel(cafe), /кафе: до 500 м/);
});

test("chat location reset restores the original radius after repeated edits", () => {
  const before = { ...base, locationWishes: [cafe] };
  const added = { ...before, locationWishes: [{ ...cafe, radiusMeters: 800 }, { ...center, query: "центр Хэундэ" }] };
  const changed = { ...added, locationWishes: [{ ...cafe, radiusMeters: 300 }, { ...center, query: "центр Хэундэ" }] };
  const first = recordChatLocations(emptyLocationChanges, before, added);
  const journal = recordChatLocations(first, added, changed);
  assert.deepEqual(resetChatLocations(changed, readChatLocations(JSON.parse(JSON.stringify(journal)))), before);
});

test("chat-added wishes disappear after reset while later manual edits survive", () => {
  const added = { ...base, locationWishes: [cafe, { ...center, query: "центр Хэундэ" }] };
  const first = recordChatLocations(emptyLocationChanges, base, added);
  const twice = { ...added, locationWishes: [{ ...cafe, required: true }, { ...center, query: "центр Хэундэ" }] };
  const journal = recordChatLocations(first, added, twice);
  const manual = { ...twice, locationWishes: [{ ...cafe, radiusMeters: 200 }, { ...center, query: "центр Хэундэ" }] };
  assert.equal(currentChatLocations(journal, manual).wishes.length, 1);
  assert.deepEqual(resetChatLocations(manual, journal).locationWishes, [{ ...cafe, radiusMeters: 200 }]);
  assert.deepEqual(resetChatLocations(twice, journal).locationWishes, []);
});

test("pending center clarification is journaled and reset-all cannot restore it", () => {
  const pending = { ...base, pendingLocationQuery: center };
  const journal = recordChatLocations(emptyLocationChanges, base, pending);
  assert.equal(resetChatLocations(pending, journal).pendingLocationQuery, null);
  const chosen = { ...pending, pendingLocationQuery: null, locationWishes: [{ ...center, query: "центр Хэундэ" }] };
  const resolved = recordChatLocations(journal, pending, chosen);
  assert.deepEqual(resetChatLocations(chosen, resolved).locationWishes, []);
  const reset = resetSearchFilters(chosen);
  assert.deepEqual(currentChatLocations(resolved, reset).wishes, []);
  assert.deepEqual(resetChatLocations(reset, resolved), reset);
  const resetDraft = resetSearchFilters(pending);
  const applied = applyFilterDraft(chosen, [], pending, resetDraft, true);
  assert.deepEqual(applied.locationWishes, []);
  assert.equal(applied.pendingLocationQuery, null);
  assert.equal(applied.checkIn, base.checkIn);
});

test("corrupt stored location journals cannot inject conditions", () => {
  assert.deepEqual(readChatLocations({ wishes: [{ query: "cafe", before: null, after: { ...cafe, radiusMeters: "500" } }] }).wishes, []);
  assert.deepEqual(readChatLocations({ wishes: [{ query: "cafe", before: null, after: { ...cafe, query: "unrelated" } }] }).wishes, []);
  assert.deepEqual(readChatLocations({ wishes: [], pending: { before: {}, after: center } }), emptyLocationChanges);
});
