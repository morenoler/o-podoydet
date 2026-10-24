import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateHistoricalTraffic,
  type HistoricalTrafficProfile,
} from "../shared/traffic";
import { evaluateNoise, noiseContextSchema } from "../shared/noise";
import type { Point } from "../shared/types";

// Synthetic cases only; public source data is never rewritten for tests.
const now = new Date("2026-10-24T12:00:00Z");
const location: Point = [129.16, 35.16];
const source = {
  url: "https://example.org/test",
  publisher: "Synthetic",
  retrievedAt: now.toISOString(),
};
const checkIn = "2026-10-26",
  checkOut = "2026-10-27";
function profile(peak = 2000): HistoricalTrafficProfile {
  return {
    id: "test",
    sourceLinkId: "link",
    referenceYear: 2024,
    dayType: "weekday",
    geometry: {
      type: "LineString",
      coordinates: [
        [129.159, 35.1601],
        [129.161, 35.1601],
      ],
    },
    hourlyVehicleCounts: Array.from({ length: 24 }, (_, index) =>
      index === 8 ? peak : null,
    ),
    reportedTotal: 999999,
    availableHours: 24,
    lanes: null,
    direction: "source_link_unspecified",
    source: { ...source },
    limitations: [],
  };
}
function dataset(p = profile()) {
  return {
    schemaVersion: 1,
    region: "Пусан",
    kind: "historical_observed_profile",
    timeZone: "Asia/Seoul",
    referenceYear: 2024,
    dayType: "weekday",
    source: { ...source },
    historicalTrafficProfiles: [p],
  };
}
function context() {
  return noiseContextSchema.parse({
    schemaVersion: 1,
    region: "Пусан",
    timeZone: "Asia/Seoul",
    generatedAt: now.toISOString(),
    bbox: [129.15, 35.15, 129.17, 35.17],
    roads: [],
    trafficObservations: [],
    events: [],
    assumptions: [],
    coverage: {
      traffic: {
        status: "unavailable",
        reason: "No dated measurements",
        sourceUrls: [],
      },
      events: {
        status: "partial",
        reason: "Incomplete calendar",
        sourceUrls: [],
        verifiedAt: now.toISOString(),
      },
    },
  });
}
const evaluate = (
  input: unknown,
  point = location,
  from = checkIn,
  to = checkOut,
) => evaluateHistoricalTraffic(input, point, from, to, now);

test("historical peak uses actual hours, ignores declared totals, and preserves missing values", () => {
  for (const [count, risk] of [
    [0, "low"],
    [500, "low"],
    [501, "moderate"],
    [1500, "moderate"],
    [1501, "high"],
  ] as const) {
    const result = evaluate(dataset(profile(count)));
    assert.equal(result.risk, risk);
    assert.equal(result.profiles[0].availableHours, 1);
    assert.equal(result.profiles[0].peakVehiclesPerHour, count);
    assert.equal(result.profiles[0].hourlyVehicleCounts[0], null);
  }
  const missing = profile();
  missing.hourlyVehicleCounts.fill(null);
  assert.equal(evaluate(dataset(missing)).risk, "unknown");
  assert.equal(evaluate(dataset(profile(-1000))).risk, "unknown");
});

test("root and link provenance must exist, use HTTP(S), and cannot come from the future", () => {
  const missing = dataset() as Record<string, unknown>;
  delete missing.source;
  assert.equal(evaluate(missing).risk, "unknown");
  for (const changed of [
    { ...source, retrievedAt: "invalid" },
    { ...source, retrievedAt: new Date(+now + 1).toISOString() },
    { ...source, url: "file:///tmp/test" },
    { ...source, publisher: "" },
  ]) {
    assert.equal(evaluate({ ...dataset(), source: changed }).risk, "unknown");
    assert.equal(
      evaluate(dataset({ ...profile(), source: changed })).risk,
      "unknown",
    );
  }
});

test("historical weekday profiles respect trip weekdays and a three year maximum age", () => {
  assert.equal(
    evaluate(dataset(), location, "2026-10-24", "2026-10-26").risk,
    "unknown",
  );
  assert.equal(
    evaluate(dataset(), location, "2026-10-25", "2026-10-27").risk,
    "high",
  );
  assert.equal(
    evaluate(dataset(), location, "2027-10-25", "2027-10-26").risk,
    "high",
  );
  assert.equal(
    evaluate(dataset(), location, "2028-10-23", "2028-10-24").risk,
    "unknown",
  );
  assert.equal(
    evaluate(dataset(), location, "2023-10-23", "2023-10-24").risk,
    "unknown",
  );
  const future = {
    ...dataset({ ...profile(), referenceYear: 2027 }),
    referenceYear: 2027,
  };
  assert.equal(
    evaluate(future, location, "2027-10-25", "2027-10-26").risk,
    "unknown",
  );
  assert.equal(evaluate({ ...dataset(), dayType: "weekend" }).risk, "unknown");
  assert.equal(
    evaluate(dataset({ ...profile(), referenceYear: 2023 })).risk,
    "unknown",
  );
});

test("historical profiles use their own line geometry and distance modifies relative risk", () => {
  assert.equal(evaluate(dataset(), [129.16, 35.161]).risk, "moderate");
  assert.equal(evaluate(dataset(), [129.16, 35.162]).risk, "low");
  assert.equal(evaluate(dataset(), [129.16, 35.17]).risk, "unknown");
  const malformed = profile();
  malformed.geometry.coordinates = [[129.16, 35.16]];
  assert.equal(evaluate(dataset(malformed)).risk, "unknown");
});

test("sixth noise argument ranks historical background while matching status stays unknown", () => {
  for (const [count, risk] of [
    [100, "low"],
    [1000, "moderate"],
    [2000, "high"],
  ] as const) {
    const result = evaluateNoise(
      context(),
      location,
      checkIn,
      checkOut,
      now,
      dataset(profile(count)),
    );
    assert.equal(result.risk, risk);
    assert.equal(result.assessmentBasis, "historical");
    assert.equal(result.matchingStatus, "unknown");
  }
  const remoteContext = context();
  remoteContext.bbox = [129.01, 35.01, 129.02, 35.02];
  const result = evaluateNoise(
    remoteContext,
    location,
    checkIn,
    checkOut,
    now,
    dataset(),
  );
  assert.equal(result.risk, "high");
  assert.equal(result.matchingStatus, "unknown");
});

test("dated event mismatch takes priority over historical low counts", () => {
  const c = context();
  c.events.push({
    id: "event",
    name: "Test",
    eventType: "concert",
    status: "scheduled",
    startsAt: "2026-10-26T19:00:00+09:00",
    endsAt: "2026-10-26T20:00:00+09:00",
    timePrecision: "minute",
    geometry: { type: "Point", coordinates: location },
    influenceRadiusMeters: 500,
    noisePotential: "high",
    influenceBasis: "Synthetic radius",
    source,
    geometrySource: source,
    limitations: [],
  });
  const result = evaluateNoise(
    c,
    location,
    checkIn,
    checkOut,
    now,
    dataset(profile(0)),
  );
  assert.equal(result.risk, "high");
  assert.equal(result.assessmentBasis, "dated");
  assert.equal(result.matchingStatus, "mismatch");
});
