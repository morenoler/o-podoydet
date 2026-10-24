import assert from "node:assert/strict";
import test from "node:test";
import {
  decideCapacity,
  decideCriterion,
} from "../shared/domain/binaryDecisionPolicy";
import type { Criterion, Hotel, Trip } from "../shared/types";

const hotel: Hotel = {
  id: "fixture",
  name: "Fixture",
  address: "",
  coordinates: [129, 35],
  lodgingType: "hotel",
  osmUrl: "https://www.openstreetmap.org/",
  rooms: [],
  route: null,
  noise: [],
};
const raw = (
  feature: Criterion["feature"],
  extra: Partial<Criterion> = {},
): Criterion => ({
  feature,
  required: true,
  status: "unknown",
  facts: [],
  explanation: "Missing evidence",
  ...extra,
});

test("decisions preserve raw evidence and never mutate it", () => {
  for (const status of ["unknown", "stale", "conflict"] as const) {
    const input = raw("family", { status });
    const before = structuredClone(input);
    const decision = decideCriterion(input, hotel);
    assert.equal(decision.status, "match");
    assert.equal(decision.assumed, true);
    assert.equal(decision.evidenceStatus, status);
    assert.deepEqual(input, before);
    assert.equal(decision.sourceExplanation, input.explanation);
  }
  for (const status of ["match", "mismatch"] as const) {
    const decision = decideCriterion(raw("family", { status }), hotel);
    assert.equal(decision.status, status);
    assert.equal(decision.assumed, false);
    assert.equal(decision.decisionBasis, "evidence");
  }
});

test("historical traffic takes precedence over road distance; thresholds are explicit", () => {
  for (const riskLevel of ["high", "moderate", "low"] as const) {
    const result = decideCriterion(
      raw("low_noise", {
        assessmentBasis: "historical",
        riskLevel,
        nearestRoadMeters: 250,
      }),
      hotel,
    );
    assert.equal(result.status, riskLevel === "low" ? "match" : "mismatch");
    assert.equal(result.assumed, true);
  }
  for (const [nearestRoadMeters, status] of [
    [150, "mismatch"],
    [151, "match"],
    [NaN, "mismatch"],
  ] as const)
    assert.equal(
      decideCriterion(raw("low_noise", { nearestRoadMeters }), hotel).status,
      status,
    );
  assert.equal(
    decideCriterion(
      raw("low_noise", {
        status: "mismatch",
        riskLevel: "high",
        assessmentBasis: "dated",
        nearestRoadMeters: 250,
      }),
      hotel,
    ).status,
    "mismatch",
  );
});

test("dated current air is an estimate while unsupported safety and access fail conservatively", () => {
  for (const [currentAirUsAqi, status] of [
    [50, "match"],
    [51, "mismatch"],
    [-1, "mismatch"],
    [NaN, "mismatch"],
  ] as const) {
    const result = decideCriterion(
      raw("clean_air", {
        currentAirUsAqi,
        currentAirTime: "2026-10-24T13:00:00Z",
      }),
      hotel,
    );
    assert.equal(result.status, status);
    assert.equal(result.assumed, true);
  }
  for (const feature of [
    "area_safety",
    "courtyard",
    "step_free_access",
    "beach_walk",
  ] as const)
    assert.equal(decideCriterion(raw(feature), hotel).status, "mismatch");
  assert.match(
    decideCriterion(raw("area_safety"), hotel).explanation,
    /не вывод об опасности/,
  );
});

test("capacity estimates respect lodging type and do not expand conditional limits", () => {
  const room = { id: "unknown", name: "Unknown", capacity: null, demo: false };
  const trip = { adults: 2, children: 1 } as Trip;
  assert.equal(decideCapacity(hotel, room, trip).capacityStatus, "mismatch");
  const apartment = decideCapacity(
    { ...hotel, lodgingType: "apartment" },
    room,
    trip,
  );
  assert.equal(apartment.capacityStatus, "match");
  assert.equal(apartment.estimatedCapacity, 4);
  assert.equal(apartment.capacityAssumed, true);
  const conditional = decideCapacity(
    hotel,
    { ...room, capacity: 2, capacityMayVary: true },
    trip,
  );
  assert.equal(conditional.capacityStatus, "mismatch");
  assert.equal(conditional.capacityEvidenceStatus, "unknown");
  assert.equal(conditional.capacityAssumed, true);
});
