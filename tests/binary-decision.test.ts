import assert from "node:assert/strict";
import test from "node:test";
import { decideCapacity, decideCriterion } from "../shared/domain/binaryDecisionPolicy";
import { rankHotels } from "../shared/matching";
import type { Criterion, Hotel, OccupancyRule, Room, Trip } from "../shared/types";

const now = new Date("2026-10-25T09:00:00Z");
const hotel: Hotel = {
  id: "fixture", name: "Fixture", address: "", coordinates: [129, 35],
  lodgingType: "hotel", osmUrl: "https://www.openstreetmap.org/", rooms: [],
  route: null, noise: [],
};
const raw = (feature: Criterion["feature"], extra: Partial<Criterion> = {}): Criterion => ({
  feature, required: true, status: "unknown", facts: [],
  explanation: "Missing evidence", ...extra,
});
const source = { sourceUrl: "https://hotel.example/rooms/family",
  obtainedAt: "2026-10-24T12:00:00Z", quote: "Official category occupancy fixture" };
const room: Room = { id: "family", name: "Family", capacity: null, demo: false,
  evidenceStatus: "verified", ...source };
const trip: Trip = { region: "Пусан", checkIn: "2026-11-09", checkOut: "2026-11-10",
  adults: 2, children: 2, scenarios: [], preferences: [], text: "" };
const rule: OccupancyRule = { maxGuests: 4, minChildren: 1, ...source };
const features: Criterion["feature"][] = ["family", "beach_walk", "step_free_route",
  "courtyard", "step_free_access", "area_safety", "clean_air", "low_noise"];

test("all unresolved decisions retain evidence and require clarification without positive substitutions", () => {
  for (const feature of features) for (const status of ["unknown", "stale", "conflict"] as const) {
    const input = raw(feature, { status, currentAirUsAqi: 20, nearestRoadMeters: 500,
      assessmentBasis: "historical", riskLevel: "low" });
    const before = structuredClone(input);
    const decision = decideCriterion(input, hotel);
    assert.equal(decision.status, "mismatch");
    assert.equal(decision.assumed, true);
    assert.equal(decision.evidenceStatus, status);
    assert.equal(decision.sourceExplanation, input.explanation);
    assert.match(decision.explanation, /Требуется уточнение/);
    assert.deepEqual(input, before);
  }
  for (const feature of features) for (const status of ["match", "mismatch"] as const) {
    const input = raw(feature, {status});
    const decision = decideCriterion(input, hotel);
    assert.equal(decision.status, status);
    assert.equal(decision.explanation, input.explanation);
    assert.equal(decision.assumed, false);
    assert.equal(decision.decisionBasis, "evidence");
  }
});

test("historical low noise and distant roads remain context without confirming quiet", () => {
  for (const riskLevel of ["high", "moderate", "low"] as const)
    for (const nearestRoadMeters of [0, 150, 151, 1000, NaN]) {
      const decision = decideCriterion(raw("low_noise", {
        assessmentBasis: "historical", riskLevel, nearestRoadMeters }), hotel);
      assert.equal(decision.status, "mismatch");
      assert.equal(decision.evidenceStatus, "unknown");
      assert.equal(decision.riskLevel, riskLevel);
      assert.equal(decision.nearestRoadMeters, nearestRoadMeters);
    }
});

test("current low AQI cannot confirm clean air for a future trip and unknown safety is not danger", () => {
  for (const currentAirUsAqi of [0, 20, 50, 51, NaN]) {
    const decision = decideCriterion(raw("clean_air", {
      currentAirUsAqi, currentAirTime: now.toISOString() }), hotel);
    assert.equal(decision.status, "mismatch");
    assert.equal(decision.evidenceStatus, "unknown");
    assert.equal(decision.currentAirUsAqi, currentAirUsAqi);
  }
  assert.match(decideCriterion(raw("area_safety"), hotel).explanation, /не вывод об опасности/);
});

test("short old routes, missing OSM stairs and lodging type cannot override missing evidence", () => {
  for (const lodgingType of ["hotel", "guest_house", "apartment", "hostel", "motel"] as const) {
    const mapped: Hotel = { ...hotel, lodgingType, route: {
      meters: 100, steps: 0, coordinates: [], wayIds: [], beachName: "Fixture",
      beachId: 1, connectionMeters: 0, approximate: true,
      noStepsAlternative: { meters: 110, coordinates: [] } } };
    assert.equal(decideCriterion(raw("family"), mapped).status, "mismatch");
    assert.equal(decideCriterion(raw("step_free_route"), mapped).status, "mismatch");
    assert.equal(decideCriterion(raw("beach_walk", { status: "stale" }), mapped).status, "mismatch");
  }
});

test("unknown capacity never invents two or four places and differs from confirmed insufficiency", () => {
  for (const lodgingType of ["hotel", "apartment"] as const)
    for (const children of [0, 1, 2]) {
      const decision = decideCapacity({ ...hotel, lodgingType }, room, { ...trip, children }, now);
      assert.equal(decision.capacityStatus, "mismatch");
      assert.equal(decision.capacityEvidenceStatus, "unknown");
      assert.equal("estimatedCapacity" in decision, false);
      assert.match(decision.capacityExplanation!, /не установленный недостаток мест/);
    }
  const confirmed = decideCapacity(hotel, { ...room, capacity: 2 }, trip, now);
  assert.equal(confirmed.capacityEvidenceStatus, "mismatch");
  assert.equal(confirmed.capacityAssumed, false);
  const conditional = decideCapacity(hotel, { ...room, capacity: 2, capacityMayVary: true }, trip, now);
  assert.equal(conditional.capacityEvidenceStatus, "unknown");
  assert.equal(decideCapacity(hotel, { ...room, capacity: 4 }, trip, now).capacityStatus, "match");
});

test("only a sourced applicable occupancy rule can admit a larger party in this room", () => {
  const described = { ...room, capacity: 3, occupancyRules: [rule] };
  const before = structuredClone(described);
  const admitted = decideCapacity(hotel, described, trip, now);
  assert.equal(admitted.capacityStatus, "match");
  assert.equal(admitted.capacityAssumed, false);
  assert.deepEqual(admitted.capacityRule, rule);
  assert.deepEqual(described, before);
  assert.equal(decideCapacity(hotel, described, { ...trip, adults: 4, children: 0 }, now).capacityStatus, "mismatch");
  assert.equal(decideCapacity(hotel, described, { ...trip, children: 3 }, now).capacityStatus, "mismatch");
  assert.equal(rankHotels([{...hotel, rooms:[described]}], [], [], trip, now)[0].best.status, "fits");
});

test("child age limits and invalid, stale or unscoped occupancy evidence remain unresolved", () => {
  for (const invalid of [
    { ...rule, childMaxAge: 12 },
    { ...rule, maxAdults: 1 },
    { ...rule, maxChildren: 1 },
    { ...rule, quote: "" },
    { ...rule, sourceUrl: "file:///local" },
    { ...rule, obtainedAt: "2026-09-24T12:00:00Z" },
    { ...rule, obtainedAt: "2026-10-26T12:00:00Z" },
    { ...rule, minChildren: 5 },
  ]) {
    const decision = decideCapacity(hotel, { ...room, occupancyRules: [invalid] }, trip, now);
    assert.equal(decision.capacityStatus, "mismatch");
    assert.equal(decision.capacityEvidenceStatus, "unknown");
  }
  const ages = decideCapacity(hotel, { ...room, occupancyRules: [
    { ...rule, maxAdults: 2, maxChildren: 2, childMaxAge: 12 }] }, trip, now);
  assert.match(ages.capacityExplanation!, /возраст/);
  assert.equal(decideCapacity(hotel, { ...room, evidenceStatus: "unknown", occupancyRules: [rule] }, trip, now).capacityStatus, "mismatch");
  assert.equal(decideCapacity(hotel, { ...room, occupancyRules: [
    { ...rule, minChildren: 0, childMaxAge: 12 }] }, { ...trip, children: 0 }, now).capacityStatus, "match");
});
