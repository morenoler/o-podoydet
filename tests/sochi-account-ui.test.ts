import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { HostListing } from "../shared/account";
import type { ListingClarification, ClarificationAnswer } from "../shared/clarifications";
import type { Dataset, CriterionDecision } from "../shared/types";
import { listingCurrency, propertyTimeZone, todayInTimeZone } from "../shared/regions";
import { editableListing, updateEditableListing } from "../src/features/account/components/listingForm";
import { ListingRoomFields } from "../src/features/account/components/ListingRoomFields";
import { price } from "../src/features/account/format";
import { clarificationDate } from "../src/features/clarifications/clarificationDates";
import { ClarificationAnswerForm } from "../src/features/clarifications/ClarificationAnswerForm";
import { ClarificationAnswerView } from "../src/features/clarifications/ClarificationsPanel";
import { CriterionLine } from "../src/features/hotels/components/CriterionLine";
import { hasEvaluableRooms } from "../src/features/search/roomResults";
import { createLabDataset } from "../scripts/lab-data";

const legacy: HostListing = { id: "test-listing", hostId: "test-host", hostName: "Тестовый хозяин", title: "Тестовая квартира",
  description: "Вымышленное объявление для проверки интерфейса", city: "Сочи", address: "Тестовый адрес", roomType: "Тестовый номер",
  capacity: 2, pricePerNight: 5000, currency: "KRW", amenities: [], status: "draft", floor: null, windowDirections: [], photos: [],
  createdAt: "2026-10-27T10:00:00Z", updatedAt: "2026-10-27T10:00:00Z", searchProfile: { notes: "" } };

test("new Sochi listings require a fresh ruble amount while Busan prices stay in won", () => {
  const busan = editableListing();
  const sochi = updateEditableListing(busan, "city", "Сочи");
  assert.equal(sochi.currency, "RUB");
  assert.equal(sochi.pricePerNight, 0);
  assert.equal(busan.pricePerNight, 50000, "source form is unchanged");
  const entered = updateEditableListing(sochi, "pricePerNight", 5000);
  assert.equal(updateEditableListing(entered, "address", "Новый адрес").pricePerNight, 5000);
  assert.equal(updateEditableListing(entered, "city", "Пусан").pricePerNight, 0);
  assert.equal(updateEditableListing(entered, "city", "Пусан").currency, "KRW");
  assert.equal(listingCurrency("  сочи "), "RUB");
  const html = renderToStaticMarkup(createElement(ListingRoomFields, { value: sochi, update: () => {} }));
  assert.match(html, /Стоимость за ночь, ₽/);
  assert.match(html, /Введите стоимость в рублях/);
  assert.doesNotMatch(html, /Стоимость за ночь, ₩/);
});

test("legacy Sochi won amounts retain their saved currency until the owner explicitly changes it", () => {
  const form = editableListing(legacy);
  assert.equal(form.currency, "KRW");
  assert.equal(form.pricePerNight, 5000);
  assert.match(price(form.pricePerNight, form.currency), /₩/);
  const html = renderToStaticMarkup(createElement(ListingRoomFields, { value: form, update: () => {} }));
  assert.match(html, /Стоимость за ночь, ₩/);
  assert.match(html, /Указать цену в рублях/);
  const converted = updateEditableListing(form, "currency", "RUB");
  assert.equal(converted.pricePerNight, 0, "currency selection cannot reinterpret a saved number");
  const entered = updateEditableListing(converted, "pricePerNight", 5000);
  assert.match(price(entered.pricePerNight, entered.currency), /₽/);
  assert.doesNotMatch(price(entered.pricePerNight, entered.currency), /₩/);
  assert.match(price(5000, legacy.currency), /₩/, "saved booking totals use their own currency");
});

test("all generated laboratory scenarios remain evaluable with the collected-category flag false", () => {
  const source: Dataset = { region: "Пусан", evidencePolicy: "verified-only", fetchedAt: "2026-10-27", sourceDate: "2026-10-26",
    attribution: "fixture", bbox: [129.12, 35.14, 129.18, 35.2], hotels: [], facts: [], map: [] };
  const lab = createLabDataset(source, new Date("2026-10-27T10:00:00Z"));
  assert.equal(lab.hotels.filter((hotel) => hotel.synthetic).length, 6);
  for (const hotel of lab.hotels) assert.equal(hasEvaluableRooms({ ...hotel, hasCollectedRoomCategories: false }), true, hotel.id);
  const real = { ...lab.hotels[0], synthetic: false, hasCollectedRoomCategories: false, rooms: [] };
  assert.equal(hasEvaluableRooms(real), false);
  assert.equal(hasEvaluableRooms({ ...real, rooms: [{ id: "unverified", name: "Категория не подтверждена", demo: false, capacity: null, evidenceStatus: "unknown" }] }), false);
});

const answer: ClarificationAnswer = { id: "test-answer", feature: "family", value: true, observedOn: "2026-10-27",
  recordedAt: "2026-10-27T16:00:00Z", recheckAt: "2026-11-26T21:00:00Z", timeZone: "Europe/Moscow", validFrom: null, validTo: null,
  scope: "listing_unit", scopeId: "test-listing", state: "active", version: 1, text: "Тестовый ответ", supersedes: [] };

test("Sochi date displays and observedOn limits use the local day without shifting date-only sources", (context) => {
  const now = new Date("2026-10-27T16:00:00Z");
  assert.equal(propertyTimeZone("Сочи"), "Europe/Moscow");
  assert.equal(todayInTimeZone("Europe/Moscow", now), "2026-10-27");
  assert.equal(todayInTimeZone("Asia/Seoul", now), "2026-10-28");
  assert.equal(clarificationDate(now.toISOString(), "Europe/Moscow"), "27 октября 2026");
  assert.equal(clarificationDate(now.toISOString(), "Asia/Seoul"), "28 октября 2026");
  assert.equal(clarificationDate("2026-10-27", "Europe/Moscow"), clarificationDate("2026-10-27", "Asia/Seoul"));
  context.mock.timers.enable({ apis: ["Date"], now });
  const question: ListingClarification = { id: "test-question", listingId: legacy.id, listingTitle: legacy.title, region: "Сочи", timeZone: "Europe/Moscow",
    roomId: "test-unit", feature: "family", text: "Тестовый вопрос", note: "", createdAt: now.toISOString(), status: "open", version: 0,
    context: { checkIn: "2027-06-01", checkOut: "2027-06-03", adults: 2, children: 1 }, scopeChanged: false, evidenceStatus: "unknown", answer: null, history: [] };
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ClarificationAnswerForm, { question, onSubmit: async () => {} })));
  assert.match(html, /max="2026-10-27"/);
  assert.doesNotMatch(html, /max="2026-10-28"/);
});

test("history and public evidence use their stored calculation timezone, preserving legacy deadlines", () => {
  const old = { ...answer, timeZone: "Asia/Seoul", recheckAt: "2026-11-23T15:00:00Z" };
  const history = renderToStaticMarkup(createElement(ClarificationAnswerView, { answer: old, timeZone: "Europe/Moscow" }));
  assert.match(history, /24 ноября 2026/);
  assert.match(history, /UTC\+9/);
  assert.equal(old.recheckAt, "2026-11-23T15:00:00Z");
  const criterion: CriterionDecision = { feature: "family", required: true, status: "match", evidenceStatus: "match", assumed: false, decisionBasis: "evidence",
    facts: [], explanation: "Тест", sourceExplanation: "Тест", reportedEvidence: [{ ...answer, method: "owner_response", provenanceStatus: "reported", evidenceStatus: "match" }] };
  const html = renderToStaticMarkup(createElement(CriterionLine, { criterion, detailed: true }));
  assert.match(html, /27 октября 2026/);
  assert.match(html, /UTC\+3/);
  assert.doesNotMatch(html, /Пусан|UTC\+9/);
});
