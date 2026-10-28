import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Hotel, Room } from "../shared/types";
import { DetailGallery } from "../src/features/hotels/components/DetailGallery";
import { CatalogRoomDetails } from "../src/features/hotels/components/CatalogRoomDetails";
import { CatalogSummary } from "../src/features/hotels/components/CatalogSummary";
import { DetailRoomCard } from "../src/features/hotels/components/DetailRoomCard";

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
