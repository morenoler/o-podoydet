import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { FavoritesProvider } from "../src/features/favorites/FavoritesProvider";
import { HotelCard } from "../src/features/hotels/components/HotelCard";
import { canSearch } from "../src/features/search/searchTrip";
import type { Hotel, HotelMatch, Trip } from "../shared/types";

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
function markup(match?: HotelMatch) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        FavoritesProvider,
        null,
        createElement(HotelCard, { hotel, match }),
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
