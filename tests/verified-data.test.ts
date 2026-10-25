import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { prepareVerifiedDataset } from "../scripts/prepare-verified-data";
import { evaluate, rankHotels } from "../shared/matching";
import type { Dataset, Fact, Trip } from "../shared/types";

const base: Dataset = JSON.parse(readFileSync("data/demo.json", "utf8"));
const inputs = [
  "data/verified-rooms-research.json",
  "data/verified-access-research.json",
].map((p) => JSON.parse(readFileSync(p, "utf8")));
const now = new Date("2026-10-25T23:00:00Z");
const data = prepareVerifiedDataset(base, inputs, now);
const trip: Trip = {
  region: "Пусан",
  checkIn: "2026-11-09",
  checkOut: "2026-11-10",
  adults: 2,
  children: 1,
  scenarios: [],
  preferences: [],
  text: "",
};

test("verified import preserves geography and admits only sourced categories, never demonstration facts", () => {
  assert.equal(data.hotels.length, base.hotels.length);
  assert.equal(data.evidencePolicy, "verified-only");
  assert.ok(
    data.facts.every(
      (f) => f.demo === false && f.method !== "demo" && f.sourceUrl,
    ),
  );
  assert.ok(data.hotels.some((h) => h.rooms[0].evidenceStatus === "verified"));
  for (const hotel of data.hotels) {
    assert.deepEqual(
      hotel.route,
      base.hotels.find((h) => h.id === hotel.id)!.route,
    );
    for (const room of hotel.rooms) {
      assert.equal(room.demo, false);
      if (room.evidenceStatus === "unknown") assert.equal(room.capacity, null);
      else assert.ok(room.sourceUrl && room.obtainedAt);
    }
  }
  assert.ok(
    data.facts
      .filter((f) => f.feature === "step_free_route")
      .every((f) => f.value === null),
  );
});
test("import rejects unknown hotel links, duplicate categories and future evidence", () => {
  assert.throws(() =>
    prepareVerifiedDataset(
      base,
      [{ hotels: [{ hotelId: "not-in-catalog", rooms: [] }] }],
      now,
    ),
  );
  assert.throws(() =>
    prepareVerifiedDataset(base, [inputs[0], inputs[0]], now),
  );
  assert.throws(() =>
    prepareVerifiedDataset(base, inputs, new Date("2020-01-01")),
  );
});
test("historical demonstration answers cannot confirm or reject a real room", () => {
  const hotel = data.hotels.find(
      (h) => h.rooms[0].evidenceStatus === "verified",
    )!,
    room = hotel.rooms[0];
  const real = data.facts.find(
    (f) => f.roomId === room.id && f.feature === "family" && f.value === true,
  )!;
  const demo: Fact = {
    ...real,
    id: "demo-conflict",
    value: false,
    demo: true,
    method: "host",
  };
  const pref = { feature: "family" as const, required: true };
  assert.equal(evaluate([real, demo], pref, room, trip, now).status, "match");
  assert.equal(evaluate([demo], pref, room, trip, now).status, "unknown");
});
test("unknown capacity and age-dependent occupancy do not become confirmed capacity", () => {
  const unknown = data.hotels.find(
    (h) => h.rooms[0].evidenceStatus === "unknown",
  )!;
  assert.equal(
    rankHotels([unknown], data.facts, [], trip, now)[0].best.status,
    "excluded",
  );
  const conditional = data.hotels.find((h) =>
    h.rooms.some((r) => r.capacityMayVary && r.capacity === 3),
  )!;
  // Another category in this hotel may legitimately hold four guests (Ondol
  // Suite); isolate the conditional category whose capacity is under test.
  const conditionalOnly = { ...conditional, rooms: conditional.rooms.filter(r => r.capacityMayVary && r.capacity === 3) };
  const match = rankHotels(
    [conditionalOnly],
    data.facts,
    [],
    { ...trip, adults: 2, children: 2 },
    now,
  )[0];
  assert.equal(match.best.capacityStatus, "mismatch");
  assert.equal(match.best.status, "excluded");
});
test("partial route evidence explains missing verification without becoming a boolean or conflict", () => {
  const hotel = data.hotels.find((h) => h.route)!,
    room = hotel.rooms[0];
  const partial = data.facts.find(
    (f) => f.hotelId === hotel.id && f.feature === "step_free_route",
  )!;
  const pref = { feature: "step_free_route" as const, required: true };
  assert.equal(evaluate([partial], pref, room, trip, now).status, "unknown");
  assert.equal(
    evaluate([partial], pref, room, trip, now).explanation,
    partial.quote,
  );
  assert.equal(
    evaluate(
      [partial, { ...partial, id: "verified", value: true }],
      pref,
      room,
      trip,
      now,
    ).status,
    "match",
  );
});

test("the collected Ondol Suite supports four guests without inventing a physical room or extra-bed permission", () => {
  const hotel = data.hotels.find(h => h.id === "way-627150752")!;
  const room = hotel.rooms.find(r => r.id.endsWith("-real-ondol-suite"))!;
  assert.equal(room.capacity, 4);
  assert.equal(room.scope, "room_category");
  assert.ok(room.occupancyRules?.some(r => r.maxGuests === 5 && r.childMaxAge === 12));
  const result = rankHotels([{ ...hotel, rooms: [room] }], data.facts,
    [{ feature: "family", required: true }], { ...trip, adults: 2, children: 2 }, now)[0];
  assert.equal(result.best.status, "fits");
  assert.equal(result.best.capacityAssumed, false);
  assert.equal(result.best.criteria[0].decisionBasis, "evidence");
  const fifth = rankHotels([{ ...hotel, rooms: [room] }], data.facts, [],
    { ...trip, adults: 2, children: 3 }, now)[0];
  assert.equal(fifth.best.status, "excluded");
  assert.equal(fifth.best.capacityEvidenceStatus, "unknown");
});

test("new sources never turn a mixed view, a theme or a lift into courtyard or complete accessibility", () => {
  for (const feature of ["courtyard", "step_free_access"] as const) {
    assert.equal(data.facts.filter(f => f.feature === feature && f.value === true).length, 0);
  }
  const shilla = data.hotels.find(h => h.id === "way-627150752")!;
  assert.equal(shilla.rooms.length, 9);
  assert.equal(shilla.rooms.find(r => r.id.endsWith("premier-deluxe-family-twin"))?.occupancyRules?.[0].maxGuests, 4);
  const grand = data.hotels.find(h => h.id === "way-843161717")!;
  assert.equal(grand.rooms.length, 4);
  assert.ok(grand.rooms.every(r => r.capacity === null && r.occupancyRules?.[0].childMaxAge === 12));
});
