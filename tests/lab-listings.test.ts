import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LabListings,
  listingTestTrip,
  listingComparisonTrip,
} from "../src/features/lab/LabListings";
import { LabGuide } from "../src/features/lab/LabGuide";
import type { Fact, Hotel, Trip } from "../shared/types";
import { FactEvidence } from "../src/features/hotels/components/FactEvidence";

function hotel(id: string): Hotel {
  return {
    id,
    name: id.startsWith("lab-demo-") ? `ДЕМО · ${id}` : "Real hotel",
    dataNotes: ["Сценарий для теста"],
    address: "Вымышленный адрес",
    coordinates: [129, 35],
    osmUrl: "",
    rooms: [
      { id: `${id}-room`, name: "Тестовая категория", capacity: 4, demo: true },
    ],
    route: null,
    noise: [],
  };
}

test("lab showcase renders only six fictional listings with explicit disclosure and actions", () => {
  const hotels = [
    "match",
    "mismatch",
    "unknown",
    "stale",
    "conflict",
    "capacity",
  ].map((id) => hotel(`lab-demo-${id}`));
  const markup = renderToStaticMarkup(
    createElement(LabListings, {
      hotels: [...hotels, hotel("real-hotel")],
      disabled: false,
      onOpen: () => {},
      onApply: () => {},
    }),
  );
  assert.equal((markup.match(/<article/g) || []).length, 6);
  assert.equal(
    (markup.match(/aria-label="Проверить объявление:/g) || []).length,
    6,
  );
  assert.match(markup, /Тестовые объявления · 6/);
  assert.match(markup, /Полностью вымышленные/);
  assert.match(markup, /Это не реальные предложения размещения/);
  assert.match(markup, /Подобрать по тестовым условиям/);
  assert.doesNotMatch(markup, /Real hotel|href=/);
});

test("test preset exercises capacity for three guests and preserves selected dates without mutating trip", () => {
  const original: Trip = {
    region: "Пусан",
    checkIn: "2026-11-01",
    checkOut: "2026-11-04",
    adults: 1,
    children: 0,
    scenarios: ["family"],
    preferences: [{ feature: "clean_air", required: false }],
    text: "исходный текст",
  };
  const snapshot = structuredClone(original);
  const preset = listingTestTrip(original);
  assert.equal(preset.adults + preset.children, 3);
  assert.equal(preset.checkIn, original.checkIn);
  assert.equal(preset.checkOut, original.checkOut);
  assert.deepEqual(preset.preferences, [
    { feature: "courtyard", required: true },
    { feature: "family", required: true },
  ]);
  assert.deepEqual(original, snapshot);
  assert.equal(preset.text, "");
});

test("showcase is absent for ordinary catalog and disables fixture actions during a run", () => {
  const props = { disabled: true, onOpen: () => {}, onApply: () => {} };
  assert.equal(
    renderToStaticMarkup(
      createElement(LabListings, { ...props, hotels: [hotel("real-hotel")] }),
    ),
    "",
  );
  const markup = renderToStaticMarkup(
    createElement(LabListings, { ...props, hotels: [hotel("lab-demo-match")] }),
  );
  assert.equal((markup.match(/disabled=""/g) || []).length, 2);
});

test("demo evidence discloses active lab policy without changing default label", () => {
  const fact: Fact = {
    id: "demo-fact",
    hotelId: "lab-demo-match",
    feature: "courtyard",
    value: true,
    source: "Тестовый сценарий",
    quote: "Вымышленный факт",
    method: "demo",
    confidence: "high",
    confidenceReason: "Проверка интерфейса",
    obtainedAt: "2026-10-24T00:00:00Z",
    expiresAt: "2027-10-24T00:00:00Z",
    demo: true,
  };
  const main = renderToStaticMarkup(createElement(FactEvidence, { fact }));
  const lab = renderToStaticMarkup(
    createElement(FactEvidence, { fact, allowDemo: true }),
  );
  assert.match(main, /Демонстрация · не влияет на подбор/);
  assert.match(lab, /Демонстрация · влияет только на тестовый подбор/);
  assert.doesNotMatch(lab, /не влияет на подбор/);
});

test("comparison experiment changes only courtyard from required to desired", () => {
  const original: Trip = {
    region: "Пусан",
    checkIn: "2026-11-01",
    checkOut: "2026-11-04",
    adults: 4,
    children: 0,
    scenarios: ["family"],
    preferences: [{ feature: "clean_air", required: true }],
    text: "мои условия",
  };
  const before = structuredClone(original);
  const strict = listingTestTrip(original);
  const broader = listingComparisonTrip(original);
  assert.equal(broader.adults, 2);
  assert.equal(broader.children, 1);
  assert.equal(
    broader.preferences.find((value) => value.feature === "family")?.required,
    true,
  );
  assert.equal(
    broader.preferences.find((value) => value.feature === "courtyard")
      ?.required,
    false,
  );
  const restored = structuredClone(broader);
  restored.preferences.find(
    (value) => value.feature === "courtyard",
  )!.required = true;
  assert.deepEqual(restored, strict);
  assert.deepEqual(original, before);
  assert.equal(
    strict.preferences.find((value) => value.feature === "courtyard")?.required,
    true,
  );
});

test("optional comparison action and strict experiment explain their different purposes", () => {
  const markup = renderToStaticMarkup(
    createElement(LabListings, {
      hotels: [hotel("lab-demo-match")],
      disabled: true,
      onOpen: () => {},
      onApply: () => {},
      onCompare: () => {},
    }),
  );
  assert.match(markup, /Опыт 1. Проверить обязательные условия/);
  assert.match(markup, /у ИИ нет выбора между альтернативами/);
  assert.match(markup, /Опыт 2. Проверить выбор и критику ИИ/);
  assert.match(markup, /Семейная категория остаётся обязательной/);
  assert.match(markup, /Сохранённые ответы отельера могут менять/);
  assert.equal((markup.match(/disabled=""/g) || []).length, 3);
});

test("lab guide distinguishes two model roles from rules and provides actionable stage checks", () => {
  const markup = renderToStaticMarkup(createElement(LabGuide));
  assert.equal((markup.match(/lab-guide-kind-model/g) || []).length, 2);
  assert.equal((markup.match(/lab-guide-kind-rules/g) || []).length, 3);
  assert.equal((markup.match(/Как проверить/g) || []).length, 5);
  assert.equal((markup.match(/href="#lab-workbench"/g) || []).length, 6);
  assert.match(markup, /до трёх ID кандидатов/);
  assert.match(markup, /Текст итогового ответа собирается из шаблонов/);
  assert.match(
    markup,
    /Успешный ответ по правилам или пропущенный вызов модели не подтверждает работу ИИ/,
  );
});
