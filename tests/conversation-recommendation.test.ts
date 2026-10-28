import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RoomRecommendation, Trip } from "../shared/types";
import { ConversationRecommendation } from "../src/features/advisor/ConversationRecommendation";

const room = { id: "test-room", name: "Тестовая категория", capacity: 2, demo: true };
const recommendation: RoomRecommendation = {
  id: "test::test-room", source: "demo",
  hotel: { id: "test", name: "Тестовый отель", address: "", coordinates: null, osmUrl: "", rooms: [room], route: null, noise: [], synthetic: true },
  room: { room, criteria: [], score: 0, status: "fits", capacityEvidenceStatus: "match" },
};
function render(value: RoomRecommendation, pendingLocationQuery?: Trip["pendingLocationQuery"]) {
  return renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ConversationRecommendation, { recommendation: value, pendingLocationQuery })));
}

test("a chat recommendation does not present an unknown required amenity as a confirmed match", () => {
  const html = render({ ...recommendation, room: { ...recommendation.room, provisional: true,
    criteria: [{ feature: "washing_machine", required: true, status: "match", evidenceStatus: "unknown", assumed: true, decisionBasis: "estimate", sourceExplanation: "Нет данных", explanation: "Уточните у отельера", facts: [] }],
  } });
  assert.match(html, /Вариант для уточнения/);
  assert.doesNotMatch(html, /Под выбранные условия|Подходит под фильтры/);
});

test("chat keeps uncertain capacity and known amenity mismatches visible", () => {
  const uncertain = render({ ...recommendation, room: { ...recommendation.room, capacityAssumed: true, capacityEvidenceStatus: "unknown" } });
  assert.match(uncertain, /Есть условия для уточнения/);
  assert.match(uncertain, /вместимость нужно уточнить/);
  assert.doesNotMatch(uncertain, /до 2 гостей/);
  const mismatch = render({ ...recommendation, room: { ...recommendation.room,
    criteria: [{ feature: "pool", required: false, status: "mismatch", evidenceStatus: "mismatch", assumed: false, decisionBasis: "evidence", sourceExplanation: "Источник", explanation: "Бассейна нет", facts: [] }],
  } });
  assert.match(mismatch, /Есть несовпадения с пожеланиями/);
  assert.doesNotMatch(mismatch, /Подходит под фильтры/);
});

test("chat preserves source labels, the exact category link and pending location precedence", () => {
  const known = render({ ...recommendation, source: "owner", room: { ...recommendation.room, capacitySource: "owner" } });
  assert.match(known, /Подходит по сведениям отельера/);
  assert.match(known, /до 2 гостей/);
  assert.match(known, /Наличие на даты нужно уточнить/);
  assert.match(known, /href="\/hotels\/test\?room=test-room"/);
  const pending = render(recommendation, { query: "center", relation: "near", radiusMeters: 800, required: false });
  assert.match(pending, /По ранее выбранным условиям; новое пожелание нужно уточнить/);
  assert.match(pending, /Вымышленный тестовый номер/);
});
