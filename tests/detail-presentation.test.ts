import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Hotel, Room } from "../shared/types";
import { DetailGallery } from "../src/features/hotels/components/DetailGallery";
import { CatalogRoomDetails } from "../src/features/hotels/components/CatalogRoomDetails";
import { CatalogSummary } from "../src/features/hotels/components/CatalogSummary";
import { DetailRoomCard } from "../src/features/hotels/components/DetailRoomCard";
import { HotelCard } from "../src/features/hotels/components/HotelCard";
import { accommodationPrice } from "../src/features/hotels/presentationPrice";
import { roomHotels } from "../src/features/search/roomResults";
import { FavoritesTestProvider } from "./helpers/favoritesTestProvider";

const room: Room = { id: "category", name: "Категория из источника", capacity: 2, demo: false };
const hotel: Hotel = { id: "real-hotel", name: "Отель", address: "", coordinates: null, osmUrl: "", rooms: [room], route: null, noise: [], pricePerNight: 4500, currency: "RUB" };

test("a category never inherits the property's general price or photos", () => {
  const html = renderToStaticMarkup(createElement(CatalogRoomDetails, {
    hotel: { ...hotel, photos: ["/images/property.jpg"] }, room,
  }));
  assert.match(html, /Цена за ночь<\/dt><dd>Нужно уточнить/);
  assert.match(html, /По запросу/);
  assert.match(html, /Фото категории пока нет/);
  assert.doesNotMatch(html, /4.?500|property\.jpg|Забронировать/);
});

test("an explicitly priced category keeps its own amount and currency", () => {
  const html = renderToStaticMarkup(createElement(CatalogRoomDetails, {
    hotel, room: { ...room, pricePerNight: 80000, currency: "KRW" },
  }));
  assert.match(html, /80.?000.*₩/);
  assert.doesNotMatch(html, /₽/);
  assert.match(html, /Наличие и итоговую стоимость нужно подтвердить/);
});

test("a single owner unit may show its declared price without asserting availability", () => {
  const html = renderToStaticMarkup(createElement(CatalogRoomDetails, {
    hotel: { ...hotel, id: "account-listing:owner", accountListingId: "owner" }, room,
  }));
  assert.match(html, /4.?500.*₽/);
  assert.match(html, /Наличие на даты поездки не проверено/);
});

test("search and map offers keep category amount and currency together", () => {
  assert.equal(accommodationPrice(hotel, room), null);
  assert.equal(accommodationPrice(hotel, { ...room, pricePerNight: 80000 }), null);
  assert.equal(accommodationPrice(hotel, { ...room, currency: "KRW" }), null);
  assert.deepEqual(accommodationPrice(hotel, { ...room, pricePerNight: 80000, currency: "KRW" }), { amount: 80000, currency: "KRW" });
  assert.deepEqual(accommodationPrice(hotel), { amount: 4500, currency: "RUB" });
  const own = { ...hotel, id: "account-listing:owner", accountListingId: "owner" };
  assert.deepEqual(accommodationPrice(own, room), { amount: 4500, currency: "RUB" });
  assert.equal(accommodationPrice(own, { ...room, id: "another-unit" }), null);
  assert.equal(accommodationPrice(own, { ...room, pricePerNight: 80000 }), null);
  assert.equal(accommodationPrice({ ...own, rooms: [room, { ...room, id: "another-unit" }] }, room), null);
  for (const amount of [0, -1, NaN, Infinity]) {
    assert.equal(accommodationPrice(hotel, { ...room, pricePerNight: amount, currency: "RUB" }), null);
  }
});

test("a result card does not advertise a property price as the selected room's offer", () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(FavoritesTestProvider, {},
    createElement(HotelCard, { hotel, previewRoom: room }))));
  assert.match(html, /Цена по запросу/);
  assert.doesNotMatch(html, /4.?500|₽/);
});

test("map markers show the first selectable category price and preserve unknown amounts", () => {
  const mapped = { ...hotel, coordinates: [129.16, 35.16] as [number, number] };
  const first = { ...room, pricePerNight: 80000, currency: "KRW" as const };
  const second = { ...room, id: "other", pricePerNight: 120000, currency: "KRW" as const };
  const markers = roomHotels([{ id: "first", hotel: mapped, room: first }, { id: "second", hotel: mapped, room: second }]);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].pricePerNight, 80000);
  assert.equal(markers[0].currency, "KRW");
  const unknown = roomHotels([{ id: "unknown", hotel: mapped, room }, { id: "second", hotel: mapped, room: second }]);
  assert.equal(unknown[0].pricePerNight, undefined);
  assert.equal(unknown[0].currency, undefined);
  assert.equal(mapped.pricePerNight, 4500, "map presentation must not mutate source prices");
});

test("the four gallery slots do not repeat a single supplied photograph", () => {
  const html = renderToStaticMarkup(createElement(DetailGallery, {
    name: "Объект", photos: ["/images/property.jpg", "/images/property.jpg"],
  }));
  assert.equal((html.match(/<img /g) || []).length, 2); // one visible photo and the closed full-size dialog
  assert.equal((html.match(/class="figcraft-detail-photo is-missing"/g) || []).length, 3);
  assert.match(html, /Других фото пока нет/);
  assert.doesNotMatch(html, /Все фото/);
});

test("the review overview preserves unknown rating and count", () => {
  const html = renderToStaticMarkup(createElement(CatalogSummary, { hotel, room }));
  assert.match(html, /Нет оценки/);
  assert.match(html, /href="#hotel-reviews"/);
  assert.match(html, /Перечень удобств пока не указан/);
  assert.doesNotMatch(html, /1201|9\.0|Превосходно/);
});

test("a category gallery exposes every supplied photo through its full-size viewer", () => {
  const photos = Array.from({ length: 6 }, (_, index) => `/images/category-${index}.jpg`);
  const html = renderToStaticMarkup(createElement(DetailRoomCard, { name: room.name, photos, children: null }));
  assert.equal((html.match(/<img /g) || []).length, 4);
  assert.match(html, /aria-label="Предыдущее фото"/);
  assert.match(html, /aria-label="Следующее фото"/);
  assert.match(html, /aria-live="polite">1 \/ 6/);
  const single = renderToStaticMarkup(createElement(DetailRoomCard, { name: room.name, photos: [photos[0]], children: null }));
  assert.doesNotMatch(single, /aria-label="Следующее фото"/);
});
