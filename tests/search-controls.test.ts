import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchMonthCalendar, selectSearchDate, searchDatesLabel } from "../src/features/search/SearchBar";
import { PriceFilter, SearchFilters, priceDistribution } from "../src/features/search/SearchFilters";
import { nextSearchDate } from "../src/features/search/searchTrip";
import { hasSearchFilters, resetSearchFilters } from "../src/features/search/preferences";
import type { Trip } from "../shared/types";

const trip: Trip = { region: "Сочи", checkIn: "2028-02-28", checkOut: "2028-03-03", adults: 2, children: 0,
  scenarios: [], preferences: [{ feature: "washing_machine", required: true }], text: "", hotelFilters: { maxPricePerNight: 8000 } };

test("filter activity includes policy, text and pending chat conditions and clears on reset", () => {
  const plain = resetSearchFilters(trip);
  assert.equal(hasSearchFilters(plain), false);
  for (const patch of [
    { admissionMode: "verified" },
    { text: "Уточнить поздний заезд" },
    { pendingLocationQuery: { query: "центр", relation: "near", radiusMeters: 500, required: false } },
    { preferenceOverrides: [{ feature: "pool", enabled: false, required: false }] },
    { hotelFilters: { maxPricePerNight: 6000 } },
    { preferences: [{ feature: "wifi", required: false }] },
  ] as Partial<Trip>[]) {
    const filtered = { ...plain, ...patch };
    assert.equal(hasSearchFilters(filtered), true);
    assert.equal(hasSearchFilters(resetSearchFilters(filtered)), false);
  }
  assert.equal(hasSearchFilters(plain, [{ feature: "pool", required: true }]), true);
  assert.equal(hasSearchFilters(plain, [], "distance"), true);
  assert.equal(hasSearchFilters({ ...plain, text: "   " }), false);
});

function calendar(month: string, start = "", end = "", today = "2027-01-01") {
  return renderToStaticMarkup(createElement(SearchMonthCalendar, { month, start, end, today, onSelect() {}, onMonth() {} }));
}

test("calendar dates and range labels do not shift in host time zones or across leap/DST days", () => {
  const before = process.env.TZ;
  try {
    const expected = calendar("2028-02", "2028-02-28", "2028-03-03");
    for (const zone of ["Pacific/Kiritimati", "America/Los_Angeles", "Europe/Moscow", "Asia/Seoul"]) {
      process.env.TZ = zone;
      assert.equal(calendar("2028-02", "2028-02-28", "2028-03-03"), expected);
      assert.equal(nextSearchDate("2028-02-28"), "2028-02-29");
      assert.equal(nextSearchDate("2028-02-29"), "2028-03-01");
      assert.equal(nextSearchDate("2027-03-14"), "2027-03-15");
      assert.equal(nextSearchDate("2027-11-07"), "2027-11-08");
    }
    assert.equal((expected.match(/aria-pressed=/g) || []).length, 29);
    assert.equal((calendar("2027-02").match(/aria-pressed=/g) || []).length, 28);
    assert.equal((calendar("2028-01").match(/aria-pressed=/g) || []).length, 31);
    assert.match(expected, /aria-label="28 февраля 2028 г\., заезд"/);
    assert.match(calendar("2028-03", "2028-02-28", "2028-03-03"), /aria-label="3 марта 2028 г\., выезд"/);
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});

test("calendar keeps native keyboard buttons, date labels and unavailable past dates", () => {
  const html = calendar("2028-02", "2028-02-28", "2028-02-29", "2028-02-28");
  assert.equal((html.match(/<button type="button"/g) || []).length, 31, "all days and both month controls are native non-submit buttons");
  assert.equal((html.match(/disabled=""/g) || []).length, 27);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 2);
  assert.match(html, /aria-label="Предыдущий месяц"/);
  assert.match(html, /aria-label="Следующий месяц"/);
  assert.doesNotMatch(html, /tabindex="-1"/);
});

test("price dialog shows only the supported maximum in the current region currency", () => {
  const sochi = renderToStaticMarkup(createElement(PriceFilter, { trip, onApply() {}, onClose() {} }));
  assert.match(sochi, /Максимум, ₽/);
  assert.match(sochi, /name="maxPricePerNight"[^>]*value="8000"/);
  assert.doesNotMatch(sochi, /₩|minPricePerNight|гистограмм/);
  const busan = renderToStaticMarkup(createElement(PriceFilter, { trip: { ...trip, region: "Пусан", hotelFilters: {} }, onApply() {}, onClose() {} }));
  assert.match(busan, /Максимум, ₩/);
  assert.match(busan, /placeholder="Любая"/);
  assert.doesNotMatch(busan, /₽|value="8000"/);
});

test("calendar auto-apply happens only after a later checkout date and preserves non-date conditions", () => {
  const start = selectSearchDate(trip, "2028-02-29");
  assert.equal(start.checkIn, "2028-02-29"); assert.equal(start.checkOut, "");
  const sameDay = selectSearchDate(start, "2028-02-29");
  assert.equal(sameDay.checkOut, "");
  const earlier = selectSearchDate(start, "2028-02-28");
  assert.equal(earlier.checkIn, "2028-02-28"); assert.equal(earlier.checkOut, "");
  const complete = selectSearchDate(start, "2028-03-02");
  assert.equal(complete.checkIn, "2028-02-29"); assert.equal(complete.checkOut, "2028-03-02");
  assert.deepEqual(complete.preferences, trip.preferences); assert.deepEqual(complete.hotelFilters, trip.hotelFilters);
});

test("search date summary uses the design's compact range without hiding month or year transitions", () => {
  assert.equal(searchDatesLabel({ checkIn: "2028-09-17", checkOut: "2028-09-20" }), "17 — 20 сентября");
  assert.equal(searchDatesLabel({ checkIn: "2028-09-29", checkOut: "2028-10-02" }), "29 сентября — 2 октября");
  const acrossYear = searchDatesLabel({ checkIn: "2028-12-29", checkOut: "2029-01-02" });
  assert.match(acrossYear, /2028/); assert.match(acrossYear, /2029/);
  assert.equal(searchDatesLabel({ checkIn: "2028-09-17", checkOut: "" }), "Выберите даты");
});

test("price chart counts only actual valid observations and omits fabricated data", () => {
  assert.equal(priceDistribution([]), null);
  assert.equal(priceDistribution([NaN, Infinity, -3, 0, 100000001]), null);
  const chart = priceDistribution([5000, 5000, 9000, 17000, NaN])!;
  assert.equal(chart.min, 5000); assert.equal(chart.max, 17000); assert.equal(chart.count, 4);
  assert.equal(chart.bins.reduce((sum, n) => sum + n, 0), 4);
  const single = priceDistribution([7000, 7000])!;
  assert.equal(single.min, single.max); assert.equal(single.bins.reduce((sum, n) => sum + n, 0), 2);
  const unavailable = renderToStaticMarkup(createElement(PriceFilter, { trip, onApply() {}, onClose() {} }));
  assert.match(unavailable, /Цены пока не указаны/); assert.doesNotMatch(unavailable, /type="range"|figcraft-price-bars/);
  const available = renderToStaticMarkup(createElement(PriceFilter, { trip, prices: [5000, 9000, 17000], onApply() {}, onClose() {} }));
  assert.match(available, /type="range"/); assert.match(available, /Распределение 3 известных цен/);
  assert.doesNotMatch(available, /name="minPricePerNight"/);
});

test("filter disclosure retains all criteria, real sorting choices and original illustration assets", () => {
  const html = renderToStaticMarkup(createElement(SearchFilters, { trip, sort: "distance", onApply() {}, onClose() {}, onSortChange() {} }));
  assert.match(html, /value="distance" selected=""/);
  assert.match(html, /figcraft-all-filters/); assert.match(html, /Показать ещё/);
  for (const image of ["beach", "stroller", "breakfast"]) assert.ok(html.includes(`/images/design/figcraft-${image}.png`));
  assert.equal((html.match(/class="preference-button"/g) || []).length, 18);
  const amenities = html.match(/<details class="figcraft-all-filters">([\s\S]*?)<\/details>/)?.[1] || "";
  assert.match(amenities, /В номере/);
  assert.match(amenities, /Посудомоечная машина/);
  assert.doesNotMatch(amenities, /Цена, тип жилья|Можно уточнить|Безопасность района|Что ещё учесть/,
    "Show more expands amenities only; unrelated filters remain reachable by scrolling");
  const additional = html.slice(html.indexOf('class="figcraft-expanded-filters figcraft-additional-filters"'));
  for (const text of ["Цена, тип жилья и расположение", "Можно уточнить недостающие сведения", "Безопасность района", "Что ещё учесть?"]) assert.ok(additional.includes(text), text);
});

test("designed filters retain mandatory amenities and admission policy controls", () => {
  const html = renderToStaticMarkup(createElement(SearchFilters, { trip, onApply() {}, onClose() {} }));
  for (const text of ["Посудомоечная машина", "Стиральная машина", "Бассейн", "Обязательно", "Цена, тип жилья и расположение", "Можно уточнить недостающие сведения"]) assert.ok(html.includes(text), text);
  assert.match(html, /type="checkbox"[^>]*checked=""/);
  assert.match(html, /textarea[^>]*maxLength="1500"/i);
});
