import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { countHotelFilters, hasHotelFilters, matchesHotelFilters, matchingCatalogSnippets } from "../shared/catalogFilters";
import { hotelFiltersSchema, tripSchema } from "../shared/validation";
import type { Fact, Hotel, Room } from "../shared/types";

const suite: Room = { id: "suite", name: "Ocean Suite", capacity: 2, demo: false, quote: "A balcony overlooking the ocean", sourceUrl: "https://example.org/suite" };
const twin: Room = { id: "twin", name: "Garden Twin", capacity: 2, demo: false, quote: "Two beds and a kitchenette" };
const hotel: Hotel = {
  id: "test", name: "Park Test Hotel", address: "Пусан, 해운대, Haeundae 10", lodgingType: "hotel",
  coordinates: null, osmUrl: "", rooms: [suite, twin], noise: [],
  pricePerNight: 80_000, currency: "KRW",
  route: { meters: 500, coordinates: [], wayIds: [], steps: 0, beachName: "Test", beachId: 1, connectionMeters: 50, approximate: true },
};
const fact: Fact = {
  id: "negative-pool", hotelId: "test", roomId: "suite", feature: "family", value: false,
  source: "Test source", sourceUrl: "https://example.org/suite", quote: "No pool is available",
  method: "official", confidence: "high", confidenceReason: "Synthetic test fixture", obtainedAt: "2026-10-27T00:00:00Z", expiresAt: "2026-11-27T00:00:00Z", demo: false,
};

test("omitted and empty filters preserve the old catalog, active filter count counts dimensions", () => {
  assert.equal(matchesHotelFilters(hotel), true);
  assert.equal(matchesHotelFilters(hotel, {}), true);
  assert.equal(hasHotelFilters({ query: "   ", lodgingTypes: [] }), false);
  assert.equal(countHotelFilters({ query: "Park", lodgingTypes: ["hotel", "motel"], maxBeachMeters: 500 }), 3);
});

test("numeric limits are inclusive and missing, invalid, or foreign-currency prices do not pass", () => {
  const filters = { maxPricePerNight: 80_000, maxBeachMeters: 500 };
  assert.equal(matchesHotelFilters(hotel, filters), true);
  assert.equal(matchesHotelFilters(hotel, { maxPricePerNight: 79_999 }), false);
  assert.equal(matchesHotelFilters(hotel, { maxBeachMeters: 499 }), false);
  for (const pricePerNight of [undefined, NaN, 0, -1])
    assert.equal(matchesHotelFilters({ ...hotel, pricePerNight }, filters), false);
  assert.equal(matchesHotelFilters({ ...hotel, currency: undefined }, filters), false);
  assert.equal(matchesHotelFilters({ ...hotel, route: null }, filters), false);
  assert.equal(matchesHotelFilters({ ...hotel, lodgingType: undefined }, { lodgingTypes: ["hotel"] }), false);
});

test("Unicode, case, prefixes, and explicit category aliases work without a model", () => {
  assert.equal(matchesHotelFilters(hotel, { query: "ＰＡＲＫ люкс с балконом" }, [], suite), true);
  assert.equal(matchesHotelFilters(hotel, { query: "Haeun 해운대" }), true);
  assert.equal(matchesHotelFilters(hotel, { query: "вид на море" }, [], { ...suite, quote: "Sea view" }), true);
  assert.equal(matchesHotelFilters(hotel, { query: "ТВИН с кухней" }, [], twin), true);
  assert.equal(matchesHotelFilters(hotel, { query: "Park absent" }), false);
  assert.equal(matchesHotelFilters(hotel, { query: "!!!" }), false);
});

test("all words must match the same room, including when previewing a whole hotel", () => {
  assert.equal(matchesHotelFilters(hotel, { query: "люкс кухня" }), false);
  assert.equal(matchesHotelFilters(hotel, { query: "балкон" }, [], twin), false);
  assert.equal(matchesHotelFilters(hotel, { query: "балкон" }, [], suite), true);
});

test("source quote matches keep negation and evidence intact, with scope and source references", () => {
  const original = JSON.stringify(fact);
  assert.equal(matchesHotelFilters(hotel, { query: "бассейн" }, [fact], suite), true);
  assert.equal(matchesHotelFilters(hotel, { query: "бассейн" }, [fact], twin), false);
  const snippets = matchingCatalogSnippets(hotel, { query: "бассейн" }, [fact], suite);
  assert.deepEqual(snippets, [{ field: "quote", text: "No pool is available", sourceUrl: fact.sourceUrl, roomId: "suite", factId: fact.id, obtainedAt: fact.obtainedAt, expiresAt: fact.expiresAt }]);
  assert.equal(snippets[0].sourceDate, undefined);
  assert.equal(JSON.stringify(fact), original);
  assert.equal(matchesHotelFilters(hotel, { query: "без бассейна" }, [fact], suite), false);
});

test("demo quotes and another hotel's quotes do not retrieve real categories", () => {
  assert.equal(matchesHotelFilters(hotel, { query: "pool" }, [{ ...fact, demo: true }], suite), false);
  assert.equal(matchesHotelFilters(hotel, { query: "pool" }, [{ ...fact, hotelId: "other" }], suite), false);
});

test("filter validation rejects typos, coercions, nulls, oversized queries, and duplicates", () => {
  for (const value of [{ maxPricePerNight: "1000" }, { maxPricePerNight: 0 }, { maxPricePerNight: 100_000_001 }, { maxBeachMeters: null }, { maxBeachMeters: -2 }, { maxBeachMeters: Infinity }, { query: "x".repeat(241) }, { lodgingTypes: ["hotel", "hotel"] }, { lodgingTypes: ["villa"] }, { maxPrice: 10 }])
    assert.equal(hotelFiltersSchema.safeParse(value).success, false, JSON.stringify(value));
  assert.deepEqual(hotelFiltersSchema.parse({ query: "  Park  ", maxBeachMeters: 500.5 }), { query: "Park", maxBeachMeters: 500.5 });
  const trip = { region: "Пусан", checkIn: "2027-06-01", checkOut: "2027-06-02", adults: 2, children: 0, scenarios: [], preferences: [], text: "", hotelFilters: { query: "Park" } };
  assert.equal(tripSchema.parse(trip).hotelFilters?.query, "Park");
});

test("shared cross-language fixture keeps TypeScript preview aligned with Java retrieval", () => {
  const cases: { query: string; roomId: string; expected: boolean; quote?: string }[] = JSON.parse(readFileSync(new URL("./catalog-filter-cases.json", import.meta.url), "utf8"));
  for (const value of cases) {
    const room = { ...(value.roomId === "suite" ? suite : twin), ...(value.quote ? { quote: value.quote } : {}) };
    assert.equal(matchesHotelFilters(hotel, { query: value.query }, [], room), value.expected, JSON.stringify(value));
  }
});
