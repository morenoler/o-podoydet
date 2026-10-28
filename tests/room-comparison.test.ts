import { test } from "node:test";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { HotelMatch, RoomRecommendation, Trip } from "../shared/types";
import { comparisonMatchForRoom, comparisonSelection, currentComparisonEntries } from "../src/features/search/comparison";
import { recommendationItem, recommendationMatch } from "../src/features/search/roomResults";
import { groupRoomAlternatives } from "../src/features/search/resultGroups";
// Server rendering verifies semantics; Vite owns stylesheet loading in the app.
registerHooks({ load(url, context, nextLoad) {
  return url.endsWith(".css") ? { format: "module", source: "export default {};", shortCircuit: true } : nextLoad(url, context);
} });
const { CompareDialog } = await import("../src/features/hotels/components/CompareDialog");

const trip: Trip = { region: "Пусан", checkIn: "2027-06-10", checkOut: "2027-06-17", adults: 2, children: 0, scenarios: [], preferences: [], text: "" };
function recommendation(id = "twin"): RoomRecommendation {
  const room = { id, name: `Учебная категория ${id}`, capacity: 2, demo: true };
  return { id: `fixture::${id}`, source: "demo", hotel: { id: "fixture", name: "Учебный отель", address: "", coordinates: null, osmUrl: "", rooms: [room], route: null, noise: [], synthetic: true }, room: { room, criteria: [], score: 0, status: "fits", capacityEvidenceStatus: "match" } };
}

test("a saved comparison never reuses the verdict from old dates or a failed search", () => {
  const item = recommendation();
  const selections = [comparisonSelection(recommendationItem(item))];
  const evaluations = { key: "old-dates", matches: { [item.id]: recommendationMatch(item) }, errors: {} };
  const changed = currentComparisonEntries(selections, [], evaluations, "new-dates");
  assert.equal(changed[0].selection.id, item.id);
  assert.equal(changed[0].match, undefined);
  assert.match(changed[0].message!, /Перепроверяем/);
  const failed = currentComparisonEntries(selections, [item], evaluations, "new-dates", "Поиск не обновился");
  assert.equal(failed[0].match, undefined);
  assert.equal(failed[0].message, "Поиск не обновился");
});

test("comparison keeps exact category identity and re-evaluates alternatives without borrowing the best room", () => {
  const first = recommendation("double"), second = recommendation("twin");
  second.room = { ...second.room, status: "excluded", capacityEvidenceStatus: "mismatch", capacityStatus: "mismatch" };
  const match: HotelMatch = { ...recommendationMatch(first), rooms: [first.room, second.room] };
  const selected = comparisonMatchForRoom(match, second.room.room.id)!;
  assert.equal(selected.best.room.id, "twin");
  assert.equal(selected.best.capacityEvidenceStatus, "mismatch");
  assert.equal(comparisonMatchForRoom(match, "removed-room"), undefined);
  const selection = comparisonSelection(recommendationItem(second));
  const refreshed = currentComparisonEntries([selection], [], { key: "current", matches: { [second.id]: selected }, errors: {} }, "current");
  assert.equal(refreshed[0].outsideResults, true);
  assert.equal(refreshed[0].match?.best.room.id, "twin");
});

test("a provisional alternative can be compared without converting its missing evidence into a match", () => {
  const item = recommendation();
  item.room.provisional = true;
  item.room.capacityAssumed = true;
  item.room.capacityEvidenceStatus = "unknown";
  const entries = currentComparisonEntries([comparisonSelection(recommendationItem(item))], [item], null, "current");
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CompareDialog, { entries, trip, onClose() {}, onRemove() {} })));
  assert.match(html, /Вариант для уточнения/);
  assert.match(html, /Вместимость не подтверждена/);
  assert.doesNotMatch(html, /Подходит под фильтры/);
});

test("comparison includes location evidence and its limits for the selected category", () => {
  const item = recommendation();
  item.locationCriteria = [{ id: "metro", query: "метро", label: "Метро рядом", required: true, status: "unknown", evidenceStatus: "unknown", explanation: "Координаты не подтверждены", places: [], method: "haversine", assumptions: [] }];
  const entries = currentComparisonEntries([comparisonSelection(recommendationItem(item))], [item], null, "current");
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CompareDialog, { entries, trip, onClose() {}, onRemove() {} })));
  assert.match(html, /Метро рядом/);
  assert.match(html, /Недостаточно данных/);
  assert.match(html, /не пешеходный маршрут/);
  assert.doesNotMatch(html, /Подходит под фильтры/);
});

test("comparison shows owner price per night without claiming total cost or availability", () => {
  const item = recommendation();
  item.hotel.accountListingId = "fixture-owner";
  item.hotel.pricePerNight = 123000;
  item.hotel.currency = "KRW";
  const entries = currentComparisonEntries([comparisonSelection(recommendationItem(item))], [item], null, "current");
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CompareDialog, { entries, trip, onClose() {}, onRemove() {} })));
  assert.match(html, /123\s*000/);
  assert.match(html, /По цене объявления/);
  assert.match(html, /Полную стоимость и наличие уточняйте/);
  assert.doesNotMatch(html, /г\.\./);
  const catalog = recommendation("catalog");
  const unknown = currentComparisonEntries([comparisonSelection(recommendationItem(catalog))], [catalog], null, "current");
  const unknownHtml = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CompareDialog, { entries: unknown, trip, onClose() {}, onRemove() {} })));
  assert.match(unknownHtml, /Цена не указана/);
});

test("known optional mismatch remains separate from unknown evidence even when both exist", () => {
  const unknown = recommendation("unknown"), mismatch = recommendation("mismatch");
  unknown.room.capacityEvidenceStatus = "unknown";
  unknown.room.provisional = true;
  mismatch.room.capacityEvidenceStatus = "unknown";
  mismatch.room.criteria = [{ feature: "pool", required: false, status: "mismatch", evidenceStatus: "mismatch", assumed: false, decisionBasis: "evidence", facts: [], explanation: "Бассейна нет", sourceExplanation: "Учебные данные" }];
  const groups = groupRoomAlternatives([unknown, mismatch]);
  assert.deepEqual(groups.find((group) => group.id === "clarify")?.items.map((item) => item.id), [unknown.id]);
  assert.deepEqual(groups.find((group) => group.id === "tradeoff")?.items.map((item) => item.id), [mismatch.id]);
});
