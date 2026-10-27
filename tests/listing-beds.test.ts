import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ListingBed } from "../shared/account";
import { sleepingLayoutError, sleepingPlacesTotal, validListingCoordinates } from "../shared/listingDetails";
import { SleepingArrangement } from "../src/features/listings/SleepingArrangement";
import fixtures from "../data/demo/fixtures.json";

const double: ListingBed = { type: "double", count: 1, placesPerUnit: 2, room: "Спальня" };
const crib: ListingBed = { type: "crib", count: 1, placesPerUnit: 1 };

test("beds distinguish shared surfaces, guest capacity and infant cribs", () => {
  assert.equal(sleepingPlacesTotal([double, crib]), 2);
  assert.equal(sleepingLayoutError([double, crib], 2, 2, true), null);
  assert.ok(sleepingLayoutError([double, crib], 3, 3, true));
  assert.ok(sleepingLayoutError([double], 2, 3, true));
  assert.equal(sleepingLayoutError([double], 2, 3, false), null);
  assert.ok(sleepingLayoutError([{...double, placesPerUnit: 1}], 1, 1, true));
  assert.ok(sleepingLayoutError([{...double, count: 0.5}], 1, 1, true));
  assert.ok(sleepingLayoutError([{...double, room: "x".repeat(61)}], 2, 2, true));
  assert.equal(sleepingLayoutError([], null, 2, false), null);
  assert.ok(sleepingLayoutError([], null, 2, true));
});

test("coordinate validation preserves zero and rejects partial, nonfinite and swapped out-of-range latitude", () => {
  for (const coordinates of [[0,0], [129,35], [-180,-90]]) assert.equal(validListingCoordinates(coordinates), true);
  for (const coordinates of [null, [129], [35,129], [180.1,0], [0,NaN], ["129",35], [129,35,1]])
    assert.equal(validListingCoordinates(coordinates), false);
});

test("guest sleeping layout does not imply separate beds or known rooms from total capacity", () => {
  const shared = renderToStaticMarkup(createElement(SleepingArrangement, { beds: [double, crib], sleepingPlaces: 2 }));
  assert.match(shared, /Двуспальная кровать × 1/);
  assert.match(shared, /не означают отдельные постели/);
  assert.match(shared, /Комната не указана/);
  assert.match(shared, /отдельно от основных мест/);
  const unknown = renderToStaticMarkup(createElement(SleepingArrangement, { sleepingPlaces: 4 }));
  assert.match(unknown, /Типы и количество кроватей пока не указаны/);
  assert.doesNotMatch(unknown, /Односпальная кровать/);
  const tiers = renderToStaticMarkup(createElement(SleepingArrangement, { beds: [{ type:"bunk", count:1, placesPerUnit:2 }] }));
  assert.match(tiers, /два яруса/);
});

test("all demo listings are synthetic and published layouts satisfy current editor validation", () => {
  assert.equal(fixtures.listings.length, 8);
  for (const listing of fixtures.listings) {
    assert.equal(listing.demo, true);
    assert.match(listing.title, /^ДЕМО/);
    assert.equal(sleepingLayoutError(listing.beds as ListingBed[], listing.sleepingPlaces, listing.capacity, listing.status === "published"), null, listing.title);
    assert.ok(listing.coordinates == null || validListingCoordinates(listing.coordinates));
  }
  assert.ok(fixtures.listings.some(listing => listing.beds.some(bed => bed.type === "crib")));
  assert.ok(fixtures.listings.some(listing => listing.beds.some(bed => bed.type === "bunk")));
});
