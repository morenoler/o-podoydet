import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { CriterionDecision, HotelMatch, RoomMatch, Trip } from "../shared/types";
import { availabilityQuestion, decisionSteps, hasUncheckedPersonalWishes, officialRoomUrl } from "../src/features/clarifications/decisionSteps";

registerHooks({ load(url, context, nextLoad) {
  return url.endsWith(".css") ? { format: "module", source: "export default {};", shortCircuit: true } : nextLoad(url, context);
} });
const { CatalogAvailability, DecisionNextSteps } = await import("../src/features/clarifications/DecisionNextSteps");

const trip: Trip = { region: "Пусан", checkIn: "2027-04-01", checkOut: "2027-04-06", adults: 2, children: 1, scenarios: [], preferences: [{ feature: "courtyard", required: true }], text: "private free text must never leak" };
const criterion: CriterionDecision = { feature: "courtyard", required: true, status: "match", evidenceStatus: "unknown", assumed: true, decisionBasis: "estimate", explanation: "Неизвестно", sourceExplanation: "Нет источника", facts: [] };
const room: RoomMatch = { room: { id: "category", name: "Учебный семейный номер", capacity: 3, demo: true }, criteria: [criterion], score: 0, status: "fits", capacityEvidenceStatus: "unknown", capacityAssumed: true };
const match: HotelMatch = { hotel: { id: "fixture", name: "Учебный отель", address: "", coordinates: null, osmUrl: "", rooms: [room.room], route: null, noise: [] }, best: room, rooms: [room] };

test("decision checklist never upgrades assumed positive decisions or capacity to known", () => {
  const items = decisionSteps(match, room, trip);
  assert.equal(items.find((item) => item.id === "courtyard")?.state, "unknown");
  assert.equal(items.find((item) => item.id === "capacity")?.state, "unknown");
});
test("decision checklist preserves mismatches, conflicts, stale and omitted conditions", () => {
  for (const evidenceStatus of ["mismatch", "conflict", "stale"] as const) {
    const actual = decisionSteps(match, { ...room, criteria: [{ ...criterion, evidenceStatus }] }, trip)[0];
    assert.equal(actual.state, evidenceStatus === "stale" ? "unknown" : evidenceStatus);
    assert.equal(actual.required, true);
  }
  assert.equal(decisionSteps(match, { ...room, criteria: [] }, trip)[0].state, "unknown");
});
test("checklist includes location and owner uncertainties without losing their required priority", () => {
  const enriched: HotelMatch = { ...match, ownerCriteria: [{ id: "floor", feature: "floor", label: "Низкий этаж", required: true, status: "match", evidenceStatus: "unknown", assumed: true, explanation: "Нет данных", sourceExplanation: "Нет данных" }], locationCriteria: [{ id: "park", query: "парк", label: "Рядом парк", required: true, status: "mismatch", evidenceStatus: "mismatch", explanation: "Далеко", places: [], method: "map", assumptions: [] }] };
  const items = decisionSteps(enriched, room, trip);
  assert.equal(items.find((item) => item.id === "owner:floor")?.state, "unknown");
  assert.equal(items.find((item) => item.id === "location:park")?.state, "mismatch");
});
test("availability draft uses dates and structured wishes but no private free text or environmental guarantees", () => {
  const text = availabilityQuestion("Учебный номер", { ...trip, preferences: [...trip.preferences, { feature: "area_safety", required: true }] }, match, room);
  assert.match(text, /2027-04-01.*2027-04-06/);
  assert.match(text, /Номер во двор \(обязательно\)/);
  assert.match(text, /полная стоимость/);
  assert.doesNotMatch(text, /private free text|Безопасность района/);
  assert.match(availabilityQuestion("Номер", trip, undefined, undefined, 4), /Количество гостей: 4/);
  assert.doesNotMatch(availabilityQuestion("Номер", trip, undefined, undefined, 4), /взрослых 2, детей 1/);
  const bookingDraft = availabilityQuestion("Номер", trip, undefined, undefined, 4, false);
  assert.match(bookingDraft, /указаны в полях заявки/);
  assert.doesNotMatch(bookingDraft, /2027-04-01|Количество гостей: 4|взрослых 2/);
});
test("official source links reject unsafe protocols and credential-bearing URLs", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,hi", "https://user:pass@example.com", "/room", ""]) assert.equal(officialRoomUrl(value), undefined);
  assert.equal(officialRoomUrl("https://example.org/rooms/family"), "https://example.org/rooms/family");
});

test("availability request includes amenity filters without confusing them with environmental guarantees", () => {
  const text = availabilityQuestion("Учебный номер", { ...trip, preferences: [{ feature: "dishwasher", required: true }, { feature: "pool", required: false }] });
  assert.match(text, /Посудомоечная машина \(обязательно\)/);
  assert.match(text, /Бассейн \(желательно\)/);
  assert.match(text, /в номере или общие/);
});

test("unrecognized or partly recognized free text remains an unknown decision step", () => {
  for (const status of ["unrecognized", "recognized"] as const) {
    const evaluated: HotelMatch = { ...match, personalWishes: { status, completeness: "unverified", features: status === "recognized" ? ["courtyard"] : [], excludedFeatures: [], ownerCriteria: [] } };
    const knownRoom = { ...room, capacityAssumed: false, capacityEvidenceStatus: "match" as const, criteria: [{ ...criterion, assumed: false, evidenceStatus: "match" as const }] };
    const step = decisionSteps(evaluated, knownRoom, trip).find((item) => item.id === "personal-wishes");
    assert.equal(step?.state, "unknown");
    assert.doesNotMatch(JSON.stringify(step), /private free text/);
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DecisionNextSteps, { match: evaluated, room: knownRoom, trip })));
    assert.match(html, /Что проверить перед выбором/);
    assert.doesNotMatch(html, /Осталось уточнить наличие и цену/);
  }
  assert.equal(hasUncheckedPersonalWishes({ ...trip, text: "" }, match), false);
  assert.equal(hasUncheckedPersonalWishes(trip, match), true);
});

test("catalog draft explains excluded free text without revealing it in the preview", () => {
  const html = renderToStaticMarkup(createElement(CatalogAvailability, { hotel: match.hotel, room: room.room, trip, match, roomMatch: room }));
  assert.match(html, /Свободный текст пожелания и переписка не переносятся/);
  assert.doesNotMatch(html, /private free text/);
  assert.doesNotMatch(availabilityQuestion(room.room.name, trip, match, room), /private free text/);
});
