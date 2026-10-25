import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateNoise,
  noiseContextSchema,
  noiseTripWindow,
  trafficLoad,
  trafficNoiseRisk,
  distanceToNoiseGeometry,
  type NoiseContext,
  type NoiseEvent,
  type TrafficObservation,
} from "../shared/noise";
import type { Point } from "../shared/types";

// These observations are synthetic test cases, never public real-world fixtures.
const location: Point = [129.16, 35.16];
const now = new Date("2026-10-24T10:00:00Z");
const source = {
  url: "https://example.org/synthetic-test",
  publisher: "Synthetic test only",
  retrievedAt: now.toISOString(),
};
const geometry = {
  type: "Polygon" as const,
  coordinates: [
    [
      [129.14, 35.14],
      [129.18, 35.14],
      [129.18, 35.18],
      [129.14, 35.18],
      [129.14, 35.14],
    ] as Point[],
  ],
};
const period = {
  startsAt: "2026-10-23T00:00:00+09:00",
  endsAt: "2026-10-24T00:00:00+09:00",
};
const complete = {
  status: "complete" as const,
  reason:
    "Synthetic bounded coverage including complete road inventory and influencing events",
  sourceUrls: [source.url],
  verifiedAt: now.toISOString(),
  ...period,
  geometry,
  verificationSource: source,
};
function context(): NoiseContext {
  return noiseContextSchema.parse({
    schemaVersion: 1,
    region: "Пусан",
    timeZone: "Asia/Seoul",
    generatedAt: now.toISOString(),
    bbox: [129.14, 35.14, 129.18, 35.18],
    roads: [
      {
        id: "way-test",
        name: "Synthetic road",
        roadClass: "primary",
        geometry: [
          [129.15, 35.16],
          [129.17, 35.16],
        ],
        oneWay: false,
        source,
      },
    ],
    trafficObservations: [],
    events: [],
    coverage: {
      traffic: { status: "unavailable", reason: "No counts", sourceUrls: [] },
      events: {
        status: "partial",
        reason: "No complete calendar",
        sourceUrls: [],
        verifiedAt: now.toISOString(),
      },
    },
    assumptions: [],
  });
}
function observation(
  patch: Partial<TrafficObservation> = {},
): TrafficObservation {
  return {
    id: "test-observation",
    roadId: "way-test",
    ...period,
    vehicleCount: 2400,
    lanes: 2,
    direction: "both_directions",
    source,
    limitations: [],
    ...patch,
  };
}
function event(patch: Partial<NoiseEvent> = {}): NoiseEvent {
  return {
    id: "test-event",
    name: "Synthetic fireworks",
    eventType: "fireworks",
    startsAt: "2026-10-23T19:00:00+09:00",
    endsAt: "2026-10-23T20:00:00+09:00",
    timePrecision: "minute",
    geometry: { type: "Point", coordinates: location },
    influenceRadiusMeters: 1000,
    noisePotential: "high",
    influenceBasis: "Unverified synthetic radius",
    source,
    geometrySource: source,
    limitations: [],
    status: "scheduled",
    ...patch,
  };
}
const evaluate = (c: NoiseContext, p: Point = location) =>
  evaluateNoise(c, p, "2026-10-23", "2026-10-24", now);

test("road geometry proximity is independent of measured load", () => {
  const result = evaluate(context());
  assert.ok(result.baseline.roads[0].meters < 1); // endpoints are ~900m away
  assert.equal(result.baseline.exposure, "high");
  assert.equal(result.traffic.status, "unknown");
  assert.equal(result.risk, "unknown");
});
test("counts are normalized by interval and counted lanes; speed is not volume", () => {
  assert.equal(trafficLoad(observation())?.vehiclesPerLaneHour, 50);
  assert.equal(
    trafficLoad(observation({ vehicleCount: undefined, speedKph: 10 })),
    null,
  );
  assert.equal(trafficLoad(observation({ direction: "unknown" })), null);
  assert.equal(trafficLoad(observation({ lanes: undefined })), null);
  for (const [v, level] of [
    [300, "low"],
    [301, "moderate"],
    [700, "moderate"],
    [701, "high"],
  ] as const)
    assert.equal(
      trafficLoad(observation({ vehicleCount: v * 48 }))?.level,
      level,
    );
  assert.equal(trafficNoiseRisk("high", 75), "high");
  assert.equal(trafficNoiseRisk("high", 76), "moderate");
  assert.equal(trafficNoiseRisk("high", 151), "low");
});
test("observed heavy traffic overlaps only its actual dates", () => {
  const c = context();
  c.trafficObservations = [observation({ vehicleCount: 48000 })];
  assert.equal(evaluate(c).risk, "high");
  assert.equal(
    evaluateNoise(c, location, "2026-10-25", "2026-10-26", now).risk,
    "unknown",
  );
});
test("future observations and future road source cannot support assessment", () => {
  const c = context();
  c.trafficObservations = [
    observation({
      vehicleCount: 48000,
      source: { ...source, retrievedAt: "2026-10-25T10:00:00Z" },
    }),
  ];
  assert.equal(evaluate(c).risk, "unknown");
  c.trafficObservations = [observation({ vehicleCount: 48000 })];
  c.roads[0].source = { ...source, retrievedAt: "2026-10-25T10:00:00Z" };
  assert.equal(evaluate(c).risk, "unknown");
});
test("low requires both bounded verified coverage and every road's full observation interval", () => {
  const c = context();
  c.trafficObservations = [observation()];
  c.coverage.events = structuredClone(complete);
  assert.equal(evaluate(c).risk, "unknown"); // even all observed roads do not prove inventory completeness
  c.coverage.traffic = structuredClone(complete);
  assert.equal(evaluate(c).risk, "low");
  assert.equal(evaluate(c).matchingStatus, "match");
  c.roads.push({ ...structuredClone(c.roads[0]), id: "way-unobserved" });
  assert.equal(evaluate(c).risk, "unknown");
});
test("gaps, only one direction, and stale or future coverage cannot confirm low", () => {
  for (const fault of ["gap", "direction", "stale", "future", "boundary"]) {
    const c = context();
    c.coverage = {
      traffic: structuredClone(complete),
      events: structuredClone(complete),
    };
    c.trafficObservations = [observation()];
    if (fault === "gap")
      c.trafficObservations[0].endsAt = "2026-10-23T23:59:00+09:00";
    if (fault === "direction")
      c.trafficObservations[0].direction = "one_direction";
    if (fault === "stale")
      c.coverage.events.verifiedAt = "2026-10-24T03:59:59Z";
    if (fault === "future")
      c.coverage.traffic.verificationSource = {
        ...source,
        retrievedAt: "2026-10-24T10:00:01Z",
      };
    if (fault === "boundary")
      c.coverage.traffic.geometry = {
        type: "Polygon",
        coordinates: [
          [
            [129.16, 35.15],
            [129.17, 35.15],
            [129.17, 35.17],
            [129.16, 35.17],
            [129.16, 35.15],
          ],
        ],
      };
    assert.equal(evaluate(c).risk, "unknown", fault);
  }
});
test("contiguous observations can cover a one-way road", () => {
  const c = context();
  c.roads[0].oneWay = true;
  c.coverage = {
    traffic: structuredClone(complete),
    events: structuredClone(complete),
  };
  c.trafficObservations = [
    observation({
      endsAt: "2026-10-23T12:00:00+09:00",
      direction: "one_direction",
    }),
    observation({
      id: "test-2",
      startsAt: "2026-10-23T12:00:00+09:00",
      direction: "one_direction",
    }),
  ];
  assert.equal(evaluate(c).risk, "low");
});

test("incomplete spatial margin or invalid omitted road prevents low", () => {
  const c = context();
  c.coverage = {
    traffic: structuredClone(complete),
    events: structuredClone(complete),
  };
  c.trafficObservations = [observation()];
  c.coverage.traffic.geometry = {
    type: "Polygon",
    coordinates: [
      [
        [129.159, 35.15],
        [129.17, 35.15],
        [129.17, 35.17],
        [129.159, 35.17],
        [129.159, 35.15],
      ],
    ],
  };
  assert.equal(evaluate(c).risk, "unknown"); // less than 300m to coverage edge
  c.coverage.traffic = structuredClone(complete);
  c.roads.push({
    ...structuredClone(c.roads[0]),
    id: "future-road",
    source: { ...source, retrievedAt: "2027-01-01T00:00:00Z" },
  });
  assert.equal(evaluate(c).risk, "unknown");
});
test("events require both date overlap and distance, with explicit attenuation", () => {
  const c = context();
  c.events = [event()];
  assert.equal(evaluate(c).risk, "high");
  assert.equal(evaluate(c, [129.16, 35.167]).risk, "moderate");
  assert.equal(evaluate(c, [129.16, 35.172]).risk, "unknown");
  assert.equal(
    evaluateNoise(c, location, "2026-10-24", "2026-10-25", now).risk,
    "unknown",
  );
  c.events = [
    event({ noisePotential: "low", eventType: "light_installation" }),
  ];
  assert.equal(evaluate(c).risk, "unknown"); // a light installation alone cannot establish total quiet
});
test("cancelled, tentative, national holidays and future evidence do not create local noise", () => {
  for (const patch of [
    { status: "cancelled" },
    { status: "tentative" },
    { eventType: "holiday" },
    { source: { ...source, retrievedAt: "2027-01-01T00:00:00Z" } },
    { geometrySource: { ...source, retrievedAt: "2027-01-01T00:00:00Z" } },
  ] as Partial<NoiseEvent>[]) {
    const c = context();
    c.events = [event(patch)];
    assert.equal(evaluate(c).risk, "unknown");
  }
});
test("polygon distances respect holes and include venue boundary", () => {
  assert.equal(distanceToNoiseGeometry(location, geometry), 0);
  const hole: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ] = [
    [129.159, 35.159],
    [129.161, 35.159],
    [129.161, 35.161],
    [129.159, 35.161],
    [129.159, 35.159],
  ];
  assert.ok(
    distanceToNoiseGeometry(location, {
      type: "Polygon",
      coordinates: [...geometry.coordinates, hole],
    }) > 80,
  );
});
test("Korean midnight interval is end-exclusive, with strict real calendar dates", () => {
  assert.equal(
    noiseTripWindow("2026-10-23", "2026-10-24").startsAt,
    "2026-10-22T15:00:00.000Z",
  );
  const c = context();
  c.events = [
    event({ startsAt: period.endsAt, endsAt: "2026-10-24T01:00:00+09:00" }),
  ];
  assert.equal(evaluate(c).risk, "unknown");
  assert.throws(() => noiseTripWindow("2026-02-30", "2026-03-02"));
  c.events = [event({ startsAt: "2026-02-30T19:00:00+09:00" })];
  assert.equal(noiseContextSchema.safeParse(c).success, false);
});
test("import rejects unverifiable complete coverage, missing road, bad count and unclosed polygon", () => {
  for (const mutate of [
    (c: NoiseContext) => {
      c.coverage.traffic.status = "complete";
    },
    (c: NoiseContext) => {
      c.trafficObservations = [observation({ roadId: "missing" })];
    },
    (c: NoiseContext) => {
      c.trafficObservations = [observation({ vehicleCount: -1 })];
    },
    (c: NoiseContext) => {
      c.events = [
        event({
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [129, 35],
                [130, 35],
                [130, 36],
                [129, 36],
              ],
            ],
          },
        }),
      ];
    },
    (c: NoiseContext) => {
      c.roads[0].source.url = "file:///tmp/pretend";
    },
  ]) {
    const c = context();
    mutate(c);
    assert.equal(noiseContextSchema.safeParse(c).success, false);
  }
});
test("real saved context has official dated events and never fabricated traffic", () => {
  const saved = noiseContextSchema.parse(
    JSON.parse(readFileSync("data/noise-context.json", "utf8")),
  );
  assert.equal(saved.region, "Пусан");
  assert.ok(saved.roads.length > 100);
  assert.equal(saved.trafficObservations.length, 0);
  assert.equal(saved.coverage.traffic.status, "unavailable");
  const fireworks = saved.events.find(
    (e) => e.id === "busan-fireworks-2026-dongbaek",
  )!;
  assert.equal(fireworks.startsAt, "2026-11-07T19:00:00+09:00");
  assert.match(fireworks.source.url, /busan\.go\.kr\/eng\/bsevents\/1752782/);
  assert.equal(
    evaluateNoise(
      saved,
      [129.1520862, 35.1540639],
      "2026-11-07",
      "2026-11-08",
      new Date(saved.generatedAt),
    ).risk,
    "high",
  );
  assert.equal(
    evaluateNoise(
      saved,
      location,
      "2026-10-25",
      "2026-10-26",
      new Date(saved.generatedAt),
    ).risk,
    "unknown",
  );
});
