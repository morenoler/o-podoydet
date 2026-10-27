import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Hotel, HotelMatch, Room, Trip } from "../shared/types";
import { CompareDialog } from "../src/features/hotels/components/CompareDialog";

const trip: Trip = {
  region: "Пусан", checkIn: "2027-06-12", checkOut: "2027-06-17",
  adults: 2, children: 0, scenarios: [], preferences: [], text: "",
};
function match(room: Partial<Room> = {}, hotel: Partial<Hotel> = {}): HotelMatch {
  const category: Room = { id: "category", name: "Категория", capacity: 4, demo: false, ...room };
  const best: HotelMatch["best"] = { room: category, criteria: [], score: 0, status: "fits" };
  return {
    hotel: { id: "hotel", name: "Отель", address: "", coordinates: null, osmUrl: "", rooms: [category], route: null, noise: [], ...hotel },
    best, rooms: [best],
  };
}
function markup(matches: HotelMatch[]) {
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(CompareDialog, { matches, trip, onClose() {} })));
}
function row(html: string, label: string) {
  const found = html.match(new RegExp(`<tr><th scope="row">${label}</th>(.*?)</tr>`, "s"));
  assert.ok(found, `Missing comparison row ${label}`);
  return found[1];
}

test("comparison preserves explicit ruble prices together with the imported bed layout", () => {
  const html = markup([match({ sleepingPlaces: 2, beds: [{ type: "double", count: 1, placesPerUnit: 2 }] },
    { currency: "RUB", pricePerNight: 6500, region: "Сочи" })]);
  assert.match(html, /₽/);
  assert.doesNotMatch(html, /₩|валюта не указана/);
  assert.match(html, /Двуспальная/);
});

test("comparison keeps owner location and sleeping layout explicit and separately sourced", () => {
  const owner = match({ sleepingPlaces: 4, amenities: ["Wi-Fi", "Кухня"], beds: [
    { type: "double", count: 1, placesPerUnit: 2, room: "Спальня" },
    { type: "single", count: 2, placesPerUnit: 1, room: "Гостиная" },
  ] }, { id: "account-listing:owner", accountListingId: "owner", address: "Пусан, учебный адрес", coordinates: [129.16, 35.16], pricePerNight: 50000, currency: "KRW", floor: 0, windowDirections: ["east", "south"] });
  const html = markup([owner]);
  assert.match(row(html, "Источник сведений"), /Сведения отельера.*Независимая проверка не проведена/s);
  assert.match(row(html, "Точка на карте"), /35\.16000° широты, 129\.16000° долготы/);
  assert.match(row(html, "Точка на карте"), /mlat=35\.16&amp;mlon=129\.16/);
  assert.match(row(html, "Точка на карте"), /Точка указана отельером.*Расположение входа не проверено/s);
  assert.match(row(html, "Спальные места"), /4 места.*Без детских кроваток/s);
  assert.match(row(html, "Кровати и диваны"), /Двуспальная кровать: 1 шт., по 2 места/);
  assert.match(row(html, "Кровати и диваны"), /Односпальная кровать: 2 шт., по 1 место/);
  assert.match(row(html, "Распределение по комнатам"), /Спальня.*Гостиная.*общее число комнат не подтверждено/s);
  assert.match(row(html, "Этаж"), /<td>0<\/td>/);
  assert.match(row(html, "Стороны окон"), /восток, юг/);
  assert.match(row(html, "Удобства"), /Wi-Fi, Кухня/);
  assert.match(row(html, "Цена за ночь"), /₩.*стоимость на даты поездки не проверена/s);
});

test("comparison never derives beds, rooms, price or amenities from maximum occupancy", () => {
  const html = markup([match({ capacity: 6 })]);
  assert.match(row(html, "Максимум гостей"), /до 6 гостей/);
  assert.match(row(html, "Спальные места"), /Не указано/);
  assert.doesNotMatch(row(html, "Спальные места"), /6 мест/);
  assert.match(row(html, "Кровати и диваны"), /Не указано/);
  assert.match(row(html, "Распределение по комнатам"), /Распределение по комнатам не указано/);
  assert.match(row(html, "Удобства"), /Не указаны/);
  assert.match(row(html, "Цена за ночь"), /Цена неизвестна/);
  assert.match(row(html, "Точка на карте"), /Точка на карте не указана/);
});

test("comparison distinguishes category columns within one hotel and supplies table semantics", () => {
  const html = markup([
    match({ id: "double", name: "Double", sleepingPlaces: 2, beds: [{ type: "double", count: 1, placesPerUnit: 2 }] }),
    match({ id: "twin", name: "Twin", sleepingPlaces: 2, beds: [{ type: "single", count: 2, placesPerUnit: 1 }] }),
  ]);
  assert.match(html, /<table[^>]*>.*<caption.*<thead>/s);
  assert.equal((html.match(/scope="col"/g) || []).length, 3);
  assert.match(html, /role="region"[^>]*tabindex="0"/);
  assert.match(row(html, "Кровати и диваны"), /Двуспальная кровать: 1 шт.*<\/td><td>.*Односпальная кровать: 2 шт/s);
  assert.match(row(html, "Подробнее"), /\/hotels\/hotel\?room=double/);
  assert.match(row(html, "Подробнее"), /\/hotels\/hotel\?room=twin/);
});

test("synthetic coordinates and routes cannot become real location evidence in comparison", () => {
  const html = markup([match({ demo: true }, {
    synthetic: true, coordinates: [129.1, 35.1], route: {
      meters: 100, coordinates: [], wayIds: [], steps: 0, beachName: "Демо", beachId: 1, connectionMeters: 10, approximate: true,
    },
  })]);
  assert.match(row(html, "Источник сведений"), /Демонстрационные данные/);
  assert.match(row(html, "Точка на карте"), /Демонстрационная точка/);
  assert.doesNotMatch(row(html, "Точка на карте"), /href=/);
  assert.match(row(html, "Маршрут до пляжа"), /Нет данных о маршруте/);
  assert.doesNotMatch(row(html, "Маршрут до пляжа"), /100 м/);
});

test("comparison preserves uncertainty in criteria and incomplete room labels", () => {
  const first = match({ sleepingPlaces: 3, beds: [
    { type: "double", count: 1, placesPerUnit: 2, room: "Спальня" },
    { type: "folding", count: 1, placesPerUnit: 1 },
  ] });
  first.best.criteria = [{ feature: "area_safety", required: true, status: "match", evidenceStatus: "unknown", assumed: true, decisionBasis: "estimate", sourceExplanation: "Нет сопоставимых сведений", explanation: "Безопасность требует уточнения", facts: [] }];
  const html = markup([first, match({ id: "other" })]);
  assert.match(row(html, "Распределение по комнатам"), /Для части кроватей комната не указана/);
  assert.match(html, /Требует уточнения/);
  assert.match(html, /Не оценивалось для этого варианта/);
  assert.doesNotMatch(html, /Безопасность подтверждена|Совпало 1 из 1/);
});
