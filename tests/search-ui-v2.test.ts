import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { FavoritesProvider } from "../src/features/favorites/FavoritesProvider";
import { HotelCard } from "../src/features/hotels/components/HotelCard";
import { canSearch } from "../src/features/search/searchTrip";
import { catalogRooms, recommendationItem, recommendationMatch, roomHotels } from "../src/features/search/roomResults";
import type { Dataset, Hotel, HotelMatch, RoomRecommendation, Trip } from "../shared/types";
import type { ComponentProps } from "react";

const trip: Trip = {
  region: "Пусан",
  checkIn: "2027-06-12",
  checkOut: "2027-06-17",
  adults: 2,
  children: 0,
  scenarios: [],
  preferences: [],
  text: "",
};
const hotel: Hotel = {
  id: "account-listing:owner-hotel",
  accountListingId: "owner-hotel",
  name: "Жильё владельца",
  address: "Пусан",
  floor: 2,
  windowDirections: ["east"],
  coordinates: null,
  osmUrl: "",
  rooms: [{ id: "room", name: "Стандарт", capacity: 2, demo: false }],
  route: null,
  noise: [],
};
function markup(match?: HotelMatch, props: Partial<ComponentProps<typeof HotelCard>> = {}) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        FavoritesProvider,
        null,
        createElement(HotelCard, { hotel, match, ...props }),
      ),
    ),
  );
}

test("catalog preview does not claim a search match or invent a price", () => {
  const html = markup();
  assert.ok(html.includes("Цена и наличие не проверены"));
  assert.ok(!html.includes("Подходит под фильтры"));
  assert.ok(!html.includes("₩"));
  assert.ok(html.includes("Этаж: 2"));
  assert.ok(html.includes("Окна: восток"));
});

test("room recommendations name and link the exact category, with hotel photos labeled", () => {
  const room = { id: "deluxe-twin", name: "Deluxe Twin", capacity: 2, demo: false };
  const recommendation: RoomRecommendation = {
    id: "real-hotel::deluxe-twin", source: "verified",
    hotel: { ...hotel, id: "real-hotel", accountListingId: undefined, name: "Отель у моря", rooms: [room] },
    room: { room, criteria: [], score: 0, status: "fits" },
  };
  const html = markup(undefined, { roomRecommendation: recommendation });
  assert.ok(html.includes("<h2>Deluxe Twin</h2>"));
  assert.ok(html.includes("Отель у моря"));
  assert.ok(html.includes("/hotels/real-hotel?room=deluxe-twin"));
  assert.ok(html.includes("Вместимость: до 2 гостей"));
  assert.ok(html.includes("Фото отеля"));
  assert.ok(html.includes("Совпали все критерии"));
  const partial = markup(undefined, { roomRecommendation: recommendation, alternative: true });
  assert.ok(partial.includes("Не все условия подтверждены"));
  assert.ok(!partial.includes("Совпали все критерии"));
});

test("two categories in one hotel keep separate comparison identity and one map marker", () => {
  const make = (id: string): RoomRecommendation => ({
    id: `hotel::${id}`, source: "verified", hotel: { ...hotel, id: "hotel", coordinates: [129.1, 35.1] },
    room: { room: { id, name: id, capacity: 2, demo: false }, criteria: [], score: 0, status: "fits" },
  });
  const first = make("double"), second = make("twin");
  assert.notEqual(recommendationItem(first).id, recommendationItem(second).id);
  assert.equal(recommendationMatch(second).best.room.id, "twin");
  assert.equal(roomHotels([recommendationItem(first), recommendationItem(second)]).length, 1);
});

test("catalog previews omit unnamed placeholders and keep actual category names", () => {
  const dataset: Dataset = {
    region: "Пусан", fetchedAt: "2026-10-26", sourceDate: "2026-10-26", attribution: "test",
    evidencePolicy: "verified-only", bbox: [129, 35, 130, 36], facts: [], map: [],
    hotels: [{ ...hotel, accountListingId: undefined, id: "verified", rooms: [
      { id: "verified-unverified", name: "Категория номера не подтверждена", capacity: null, demo: false, evidenceStatus: "unknown" },
      { id: "twin", name: "Twin", capacity: 2, demo: false, evidenceStatus: "verified" },
    ] }],
  };
  const rows = catalogRooms(dataset);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].room.name, "Twin");
  const html = markup(undefined, { hotel: rows[0].hotel, previewRoom: rows[0].room });
  assert.ok(!html.includes("Совпали все критерии"));
});

test("an owner-declared matching floor stays a match, not a mismatch", () => {
  const best: HotelMatch["best"] = {
    room: hotel.rooms[0],
    criteria: [],
    score: 1,
    status: "fits",
  };
  const html = markup({
    hotel,
    best,
    rooms: [best],
    ownerCriteria: [
      {
        id: "floor-0",
        feature: "floor",
        label: "Второй этаж",
        required: true,
        status: "match",
        evidenceStatus: "match",
        assumed: true,
        explanation: "По сведениям владельца",
        sourceExplanation: "По сведениям владельца",
      },
    ],
  });
  assert.ok(html.includes("Второй этаж: по сведениям отельера"));
  assert.ok(!html.includes("не совпадает"));
});

test("incomplete and impossible dates stay in catalog preview", () => {
  assert.equal(canSearch({ ...trip, checkIn: "", checkOut: "" }), false);
  assert.equal(
    canSearch({ ...trip, checkIn: "2027-02-29", checkOut: "2027-03-02" }),
    false,
  );
  assert.equal(canSearch({ ...trip, checkOut: trip.checkIn }), false);
  assert.equal(canSearch({ ...trip, adults: 7 }), false);
  assert.equal(canSearch({ ...trip, children: 5 }), false);
  assert.equal(canSearch(trip), true);
});
