import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchMonthCalendar } from "../src/features/search/SearchBar";
import { PriceFilter, SearchFilters } from "../src/features/search/SearchFilters";
import { nextSearchDate } from "../src/features/search/searchTrip";
import type { Trip } from "../shared/types";

const trip: Trip = { region: "Сочи", checkIn: "2028-02-28", checkOut: "2028-03-03", adults: 2, children: 0,
  scenarios: [], preferences: [{ feature: "washing_machine", required: true }], text: "", hotelFilters: { maxPricePerNight: 8000 } };

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
  assert.match(busan, /placeholder="Любая цена"/);
  assert.doesNotMatch(busan, /₽|value="8000"/);
});

test("designed filters retain mandatory amenities and admission policy controls", () => {
  const html = renderToStaticMarkup(createElement(SearchFilters, { trip, onApply() {}, onClose() {} }));
  for (const text of ["Посудомоечная машина", "Стиральная машина", "Бассейн", "Обязательно", "Цена, тип жилья и расположение", "Можно уточнить недостающие сведения"]) assert.ok(html.includes(text), text);
  assert.match(html, /type="checkbox"[^>]*checked=""/);
  assert.match(html, /textarea[^>]*maxLength="1500"/i);
});
