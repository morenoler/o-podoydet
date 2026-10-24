import assert from "node:assert/strict";
import test from "node:test";
import { evaluate, rankHotels } from "../shared/matching";
import { tripSchema } from "../shared/validation";
import type { Fact, Hotel, Preference, Trip } from "../shared/types";

// These tests retain the UI evaluator contract; Java API behavior is tested by Maven/JUnit.
const now = new Date("2026-10-24T12:00:00Z");
const trip: Trip = {
  region: "Пусан",
  checkIn: "2027-06-10",
  checkOut: "2027-06-17",
  adults: 2,
  children: 1,
  scenarios: [],
  preferences: [],
  text: "",
};
const hotel: Hotel = {
  id: "hotel-a",
  name: "Тестовый отель",
  address: "Пусан",
  coordinates: [129.16, 35.16],
  osmUrl: "https://www.openstreetmap.org/",
  rooms: [
    { id: "room-a", name: "Во двор", capacity: 4, demo: true },
    { id: "room-b", name: "У входа", capacity: 4, demo: true },
  ],
  route: null,
  noise: [],
};
function fact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: "fact-a",
    hotelId: hotel.id,
    roomId: "room-a",
    feature: "courtyard",
    value: true,
    source: "Демо",
    quote: "Окна во двор",
    method: "demo",
    confidence: "low",
    confidenceReason: "Демонстрация",
    obtainedAt: "2026-10-01T00:00:00Z",
    expiresAt: "2030-01-01T00:00:00Z",
    demo: true,
    ...overrides,
  };
}
function pref(feature: Preference["feature"], required = true): Preference {
  return { feature, required };
}

test("Busan trip validates real dates, guests and duplicate preferences", () => {
  assert.ok(tripSchema.safeParse(trip).success);
  for (const change of [
    { checkIn: "2027-02-30" },
    { checkOut: trip.checkIn },
    { adults: 0 },
    { children: 0.5 },
    { region: "Адлер" },
    { scenarios: ["sea", "sea"] },
    { preferences: [pref("courtyard"), pref("courtyard")] },
  ])
    assert.equal(
      tripSchema.safeParse({ ...trip, ...change }).success,
      false,
      JSON.stringify(change),
    );
});
test("unknown, expired, invalid and out-of-period evidence never becomes a match", () => {
  for (const [facts, status] of [
    [[], "unknown"],
    [[fact({ expiresAt: "2026-10-23T00:00:00Z" })], "stale"],
    [[fact({ value: "unknown" })], "unknown"],
    [[fact({ validTo: "2027-06-12" })], "unknown"],
    [[fact({ supersededBy: "new" })], "unknown"],
  ] as const)
    assert.equal(
      evaluate([...facts], pref("courtyard"), hotel.rooms[0], trip, now).status,
      status,
    );
  assert.equal(
    rankHotels([hotel], [], [pref("courtyard")], trip, now)[0].best.status,
    "clarify",
  );
});
test("room advantages cannot combine across categories or leak between hotels", () => {
  const facts = [
    fact(),
    fact({ id: "access-b", roomId: "room-b", feature: "step_free_access" }),
  ];
  const result = rankHotels(
    [hotel],
    facts,
    [pref("courtyard"), pref("step_free_access")],
    trip,
    now,
  )[0];
  assert.equal(result.best.status, "clarify");
  assert.ok(
    result.rooms.every(
      (r) => r.criteria.filter((c) => c.status === "match").length === 1,
    ),
  );
  assert.equal(
    rankHotels(
      [{ ...hotel, id: "other" }],
      facts,
      [pref("courtyard")],
      trip,
      now,
    )[0].best.criteria[0].status,
    "unknown",
  );
});
test("conflicting current evidence requires clarification and stale evidence cannot override it", () => {
  const yes = fact(),
    no = fact({ id: "no", value: false });
  assert.equal(
    evaluate([yes, no], pref("courtyard"), hotel.rooms[0], trip, now).status,
    "conflict",
  );
  assert.equal(
    evaluate(
      [yes, { ...no, expiresAt: "2026-01-01T00:00:00Z" }],
      pref("courtyard"),
      hotel.rooms[0],
      trip,
      now,
    ).status,
    "match",
  );
});
test("mandatory mismatches and capacity shortages are excluded without relaxation", () => {
  const distance = fact({
    roomId: undefined,
    feature: "beach_walk",
    value: 1500,
  });
  assert.equal(
    rankHotels([hotel], [distance], [pref("beach_walk")], trip, now)[0].best
      .status,
    "excluded",
  );
  assert.equal(
    rankHotels([hotel], [distance], [pref("beach_walk", false)], trip, now)[0]
      .best.status,
    "fits",
  );
  assert.equal(
    rankHotels([hotel], [], [], { ...trip, adults: 5 }, now)[0].best.status,
    "excluded",
  );
});
