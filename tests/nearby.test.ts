import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { nearbyKinds, type Dataset, type Hotel, type HotelFilters, type NearbyPlace, type Trip } from "../shared/types";
import { matchesNearby, nearbyDefinitions, nearbyMatches, validNearbyPlace } from "../shared/nearby";
import { countHotelFilters } from "../shared/catalogFilters";
import { hotelFiltersSchema } from "../shared/validation";
import { recordChatFilters, resetChatFilters, readChatFilters } from "../src/features/advisor/conversationFilters";
import { applyFilterDraft } from "../src/features/search/preferences";
import { catalogHotelCandidates } from "../src/features/search/roomResults";
import { NearbySummary } from "../src/features/hotels/components/NearbySummary";

// Synthetic fixture identifiers: these values are not imported into the real catalog.
const now = Date.parse("2026-10-27T12:00:00Z");
const cafe: NearbyPlace = { kind: "cafe", name: "Synthetic cafe", meters: 250, coordinates: [129.05, 35.15],
  osmId: "node/1", sourceUrl: "https://www.openstreetmap.org/node/1", obtainedAt: "2026-10-26T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z",
  method: "haversine-osm-v1", scope: "hotel_surroundings", status: "supported" };
const hotel: Hotel = { id: "fixture", name: "Synthetic hotel", address: "Synthetic address", coordinates: [129.05, 35.151],
  osmUrl: "https://www.openstreetmap.org/node/2", rooms: [], noise: [], route: null, nearbyPlaces: [cafe] };
const trip: Trip = { region: "Пусан", checkIn: "", checkOut: "", adults: 2, children: 0, scenarios: [], preferences: [], text: "" };
const filters: HotelFilters = { nearby: [{ kind: "cafe", maxMeters: 250 }] };

test("nearby registry and API validation cover exactly the configured kinds", () => {
  assert.deepEqual(nearbyDefinitions.map((item) => item.key).sort(), [...nearbyKinds].sort());
  assert.equal(countHotelFilters({ ...filters, query: "hotel" }), 2);
  assert.ok(hotelFiltersSchema.safeParse(filters).success);
  for (const invalid of [0, -1, Infinity, NaN, 10001]) assert.equal(hotelFiltersSchema.safeParse({ nearby: [{ kind: "cafe", maxMeters: invalid }] }).success, false);
  assert.equal(hotelFiltersSchema.safeParse({ nearby: [...filters.nearby!, ...filters.nearby!] }).success, false);
  assert.equal(hotelFiltersSchema.safeParse({ nearby: [{ kind: "cafe", maxMeters: 500, assumed: true }] }).success, false);
});

test("proximity uses inclusive distance and every selected category must have current evidence", () => {
  assert.equal(matchesNearby(hotel, filters, now), true);
  assert.equal(matchesNearby(hotel, { nearby: [{ kind: "cafe", maxMeters: 249 }] }, now), false);
  assert.equal(matchesNearby(hotel, { nearby: [...filters.nearby!, { kind: "park", maxMeters: 500 }] }, now), false);
  assert.equal(matchesNearby({ ...hotel, nearbyPlaces: [] }, filters, now), false);
  assert.equal(matchesNearby({ ...hotel, synthetic: true }, filters, now), false);
  assert.equal(matchesNearby({ ...hotel, coordinates: null }, filters, now), false);
  assert.deepEqual(nearbyMatches(hotel, filters, now), [cafe]);
});

test("expired, future, malformed or unproven proximity is not a positive badge", () => {
  for (const patch of [{ expiresAt: "2026-10-27T12:00:00Z" }, { obtainedAt: "2027-01-01T00:00:00Z" }, { sourceDate: "2027-01-01T00:00:00Z" },
    { meters: NaN }, { meters: -1 }, { sourceUrl: "https://example.org/node/1" }, { coordinates: [999, 35] }, { method: "unknown" }, { status: "reported" }, { scope: "room" }]) {
    assert.equal(validNearbyPlace({ ...cafe, ...patch } as NearbyPlace, now), false, JSON.stringify(patch));
  }
  assert.equal(validNearbyPlace(cafe, now), true, "unknown sourceDate is not filled with retrieval time");
});

test("reset removes chat proximity changes while preserving a later manual change of another kind", () => {
  const before: Trip = { ...trip, hotelFilters: { nearby: [{ kind: "subway", maxMeters: 800 }] } };
  const after: Trip = { ...trip, hotelFilters: { nearby: [...before.hotelFilters!.nearby!, { kind: "cafe", maxMeters: 500 }] } };
  const changes = recordChatFilters([], before, after, []);
  assert.deepEqual(readChatFilters(JSON.parse(JSON.stringify(changes))), changes);
  const manual: Trip = { ...after, hotelFilters: { nearby: [{ kind: "subway", maxMeters: 400 }, { kind: "cafe", maxMeters: 500 }, { kind: "park", maxMeters: 700 }] } };
  assert.deepEqual(resetChatFilters(manual, changes).hotelFilters?.nearby, [{ kind: "subway", maxMeters: 400 }, { kind: "park", maxMeters: 700 }]);
  assert.equal(resetChatFilters({ ...after, hotelFilters: { nearby: [{ kind: "cafe", maxMeters: 200 }] } }, changes).hotelFilters?.nearby?.[0].maxMeters, 200);
});

test("open filter dialog rebases proximity per kind without losing incoming chat wishes", () => {
  const initial: Trip = { ...trip, hotelFilters: { nearby: [{ kind: "cafe", maxMeters: 500 }] } };
  const live: Trip = { ...initial, hotelFilters: { nearby: [...initial.hotelFilters!.nearby!, { kind: "subway", maxMeters: 800 }] } };
  const draft: Trip = { ...initial, hotelFilters: { nearby: [{ kind: "cafe", maxMeters: 300 }] } };
  assert.deepEqual(applyFilterDraft(live, [], initial, draft).hotelFilters?.nearby, [{ kind: "cafe", maxMeters: 300 }, { kind: "subway", maxMeters: 800 }]);
});

test("map-only hotels are visible separately and never manufacture a room or occupancy", () => {
  const catalog: Dataset = { region: "Пусан", fetchedAt: cafe.obtainedAt, sourceDate: cafe.obtainedAt, attribution: "Synthetic fixture", bbox: [129, 35, 130, 36], facts: [], map: [], hotels: [hotel,
    { ...hotel, id: "collected", hasCollectedRoomCategories: true }, { ...hotel, id: "owner", accountListingId: "owner" }, { ...hotel, id: "demo", synthetic: true }] };
  const candidates = catalogHotelCandidates(catalog, filters);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].hotel.id, "fixture");
  assert.deepEqual(candidates[0].hotel.rooms, []);
  const placeholderCatalog: Dataset = { ...catalog, hotels: [{ ...hotel, rooms: [{ id: "placeholder", name: "invisible-placeholder", capacity: null, demo: false, evidenceStatus: "unknown" }] }] };
  assert.equal(catalogHotelCandidates(placeholderCatalog, { query: "invisible-placeholder" }).length, 0, "room placeholders cannot create a hotel-level text match");
});

test("card badge identifies the source and straight-line limitation without a walking claim", () => {
  const html = renderToStaticMarkup(createElement(NearbySummary, { matches: [cafe] }));
  assert.ok(html.includes("кафе · ≈250 м"));
  assert.ok(html.includes(cafe.sourceUrl));
  assert.ok(html.includes("По прямой"));
  assert.ok(html.includes("часы работы не проверены"));
  assert.ok(!html.includes("минут пешком"));
  assert.equal(renderToStaticMarkup(createElement(NearbySummary, { matches: [] })), "");
});
