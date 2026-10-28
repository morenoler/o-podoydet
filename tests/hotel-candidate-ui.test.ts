import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { HotelCandidate } from "../shared/types";
import { MappedHotelCard } from "../src/features/hotels/components/MappedHotelCard";

const candidate: HotelCandidate = {
  hotel: { id: "test-candidate", name: "Тестовый объект", address: "", coordinates: null, osmUrl: "https://example.invalid/source", rooms: [], route: null, noise: [] },
  nearbyMatches: [], catalogMatches: [], limitations: ["Нет сведений о категории"], provisional: true,
  locationCriteria: [{ id: "cafe", query: "cafe", label: "Кафе до 500 м", required: true, status: "unknown", evidenceStatus: "unknown", explanation: "Картографических данных недостаточно", places: [], method: "saved-map", assumptions: ["Неполное покрытие карты"] }],
};
function render(value: HotelCandidate) {
  return renderToStaticMarkup(createElement(MappedHotelCard, { candidate: value, selected: false, onSelect() {}, onShowMap() {} }));
}
test("a provisional mapped hotel exposes unknown required location instead of a confirmed match", () => {
  const html = render(candidate);
  assert.ok(html.includes("Есть обязательные условия для уточнения"));
  assert.ok(html.includes("Недостаточно данных"));
  assert.ok(html.includes("Картографических данных недостаточно"));
  assert.ok(!html.includes("Совпадает по картографическим данным"));
  assert.ok(html.includes("Категории, вместимость, цена и наличие не собраны."));
});
test("a known map match remains limited to map evidence and does not confirm room capacity", () => {
  const html = render({ ...candidate, provisional: false, locationCriteria: [{ ...candidate.locationCriteria![0], status: "match", evidenceStatus: "match", explanation: "Кафе в пределах радиуса", places: [{ id: "cafe-1", name: "Тестовое кафе", meters: 320, sourceUrl: "https://example.invalid/cafe" }] }] });
  assert.ok(html.includes("Совпадает по картографическим данным"));
  assert.ok(html.includes("320 м"));
  assert.ok(!html.includes("Есть обязательные условия для уточнения"));
  assert.ok(html.includes("Категории, вместимость, цена и наличие не собраны."));
});
test("unknown required amenities remain explicit in a mapped candidate", () => {
  const html = render({ ...candidate, locationCriteria: [], criteria: [{ feature: "washing_machine", required: true, status: "match", evidenceStatus: "unknown", assumed: true, decisionBasis: "estimate", sourceExplanation: "Категория не собрана", explanation: "Наличие стиральной машины неизвестно", facts: [] }] });
  assert.ok(html.includes("Стиральная машина"));
  assert.ok(html.includes("Требует уточнения"));
  assert.ok(html.includes("Наличие стиральной машины неизвестно"));
  assert.ok(!html.includes('aria-label="Соответствует фильтру"'));
});
