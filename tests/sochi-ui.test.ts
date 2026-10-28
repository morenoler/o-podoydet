import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Dataset, Hotel, Trip } from "../shared/types";
import { regionDetails, regionNames } from "../shared/regions";
import { matchesHotelFilters } from "../shared/catalogFilters";
import { canSearch, readSearchForm } from "../src/features/search/searchTrip";
import { changeTripRegion, restoreSearchTrip } from "../src/features/search/searchPolicy";
import { catalogHotelCandidates, catalogRooms } from "../src/features/search/roomResults";
import { CatalogFilterFields } from "../src/features/search/CatalogFilterFields";
import { SearchBar } from "../src/features/search/SearchBar";
import { TripSearchForm } from "../src/features/trip/components/TripSearchForm";
import { datasetMapPoints, visibleMapHotels } from "../src/features/map/mapData";

const trip: Trip = { region: "Пусан", checkIn: "2027-06-10", checkOut: "2027-06-14", adults: 2, children: 0,
  scenarios: ["quiet"], preferences: [{ feature: "low_noise", required: false }], text: "Спокойный отдых" };
const hotel: Hotel = { id: "sochi-test-fixture", region: "Сочи", name: "Тестовый объект", address: "Сочи",
  coordinates: [39.72, 43.58], osmUrl: "", rooms: [], route: null, noise: [], hasCollectedRoomCategories: false };
const catalog: Dataset = { region: "Сочи", evidencePolicy: "verified-only", fetchedAt: "2026-10-27", sourceDate: "2026-10-26",
  attribution: "test fixture", bbox: [39.6, 43.4, 39.9, 43.7], hotels: [hotel], facts: [], map: [] };

test("search accepts Sochi, preserves its saved region, and rejects unsupported destinations", () => {
  assert.equal(canSearch({ ...trip, region: "Сочи" }), true);
  assert.equal(canSearch({ ...trip, region: "Адлер" }), false);
  assert.equal(restoreSearchTrip({ ...trip, region: "Сочи" }, trip).region, "Сочи");
  const fields = new FormData();
  for (const [key, value] of Object.entries({ region: "Сочи", checkIn: trip.checkIn, checkOut: trip.checkOut, adults: "2", children: "0" })) fields.set(key, value);
  const submitted = readSearchForm({ ...trip, hotelFilters: { maxPricePerNight: 150000, query: "отель" } }, fields);
  assert.equal(submitted.region, "Сочи");
  assert.deepEqual(submitted.preferences, trip.preferences);
  assert.deepEqual(submitted.scenarios, trip.scenarios);
  assert.equal(submitted.text, trip.text);
  assert.equal(submitted.hotelFilters?.query, "отель");
  assert.equal(submitted.hotelFilters?.maxPricePerNight, undefined);
});

test("switching regions clears the old currency budget, while same-region edits preserve it", () => {
  const original = { ...trip, hotelFilters: { maxPricePerNight: 100000, maxBeachMeters: 1500 } };
  assert.equal(changeTripRegion(original, "Пусан"), original);
  const sochi = changeTripRegion(original, "Сочи");
  assert.equal(sochi.hotelFilters?.maxPricePerNight, undefined);
  assert.equal(sochi.hotelFilters?.maxBeachMeters, 1500);
  assert.equal(original.hotelFilters.maxPricePerNight, 100000);
  assert.equal(regionDetails("Сочи")?.currency, "RUB");
  assert.equal(regionDetails("Сочи")?.timeZone, "Europe/Moscow");
});

test("switching regions clears named places and pending clarification but preserves amenities", () => {
  const original: Trip = { ...trip, preferences: [{ feature: "washing_machine", required: true }],
    locationWishes: [{ query: "BEXCO", relation: "near", radiusMeters: 1000, required: true }],
    pendingLocationQuery: { query: "центр", relation: "near", radiusMeters: 1000, required: false } };
  assert.equal(changeTripRegion(original, "Пусан"), original);
  const changed = changeTripRegion(original, "Сочи");
  assert.deepEqual(changed.locationWishes, []);
  assert.equal(changed.pendingLocationQuery, null);
  assert.deepEqual(changed.preferences, original.preferences);
  assert.equal(original.locationWishes?.[0].query, "BEXCO");
});

test("trip and search forms display the selected destination and respect single-region catalogs", () => {
  const sochi = { ...trip, region: "Сочи" };
  for (const html of [
    renderToStaticMarkup(createElement(TripSearchForm, { initialTrip: sochi, regions: [...regionNames], onContinue: () => {} })),
    renderToStaticMarkup(createElement(SearchBar, { trip: sochi, regions: [...regionNames], onSearch: () => {} })),
  ]) {
    assert.match(html, /value="Сочи" selected=""/);
    assert.match(html, /Сочи, Россия/);
    assert.match(html, /value="Пусан"/);
    assert.doesNotMatch(html, /в Пусане/);
  }
  const lab = renderToStaticMarkup(createElement(TripSearchForm, { initialTrip: trip, regions: ["Пусан"], onContinue: () => {} }));
  assert.doesNotMatch(lab, /value="Сочи"/);
  const preview = renderToStaticMarkup(createElement(SearchBar, { trip: { ...sochi, checkIn: "", checkOut: "" }, regions: [...regionNames], onSearch: () => {} }));
  assert.match(preview, /Показать каталог без дат/);
});

test("Sochi price filters use rubles and do not present the Busan center reference", () => {
  const html = renderToStaticMarkup(createElement(CatalogFilterFields, { region: "Сочи", onChange: () => {} }));
  assert.match(html, /Цена за ночь, до ₽/);
  assert.doesNotMatch(html, /₩|Сомён/);
  const maximum = { maxPricePerNight: 6000 };
  assert.equal(matchesHotelFilters(hotel, maximum, [], undefined, "RUB"), false, "missing price cannot satisfy a limit");
  assert.equal(matchesHotelFilters({ ...hotel, currency: "KRW", pricePerNight: 5000 }, maximum, [], undefined, "RUB"), false);
  assert.equal(matchesHotelFilters({ ...hotel, currency: "RUB", pricePerNight: 5000 }, maximum, [], undefined, "RUB"), true);
  assert.equal(matchesHotelFilters({ ...hotel, currency: "RUB", pricePerNight: 7000 }, maximum, [], undefined, "RUB"), false);
});

test("mapped Sochi objects stay candidates without invented rooms, prices, or routes", () => {
  assert.equal(catalogRooms(catalog).length, 0);
  const candidates = catalogHotelCandidates(catalog);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].hotel.rooms, []);
  assert.equal(candidates[0].hotel.route, null);
  assert.equal(catalogHotelCandidates(catalog, { maxPricePerNight: 6000 }).length, 0);
  assert.equal(catalogHotelCandidates(catalog, { maxBeachMeters: 1000 }).length, 0);
  assert.deepEqual(datasetMapPoints(catalog), [[39.6, 43.4], [39.9, 43.7]]);
  assert.deepEqual(datasetMapPoints({ ...catalog, bbox: [0, 0, 0, 0] }), [hotel.coordinates]);
  const busan: Hotel = { ...hotel, id: "busan-test-fixture", region: "Пусан", coordinates: [129.16, 35.16] };
  assert.deepEqual(visibleMapHotels(catalog, undefined, [hotel, busan]), [hotel]);
});
