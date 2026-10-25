import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ambientMeasurementsSchema, evaluateNoise, noiseContextSchema } from "../shared/noise";

const measurements = JSON.parse(readFileSync("data/noise-measurements-busan-2025.json", "utf8"));
test("real Busan monitoring tables preserve 2025 columns and unmapped station scope", () => {
  const source = ambientMeasurementsSchema.parse(measurements);
  assert.deepEqual(source.observations.map(o => [o.dayDbA, o.nightDbA]), [[66,61],[69,64],[67,61],[63,57],[72,71]]);
  assert.equal(source.source.pdfPage, 33);
  assert.equal(source.usableForHotelMatching, false);
  assert.throws(() => ambientMeasurementsSchema.parse({...source, usableForHotelMatching:true}));
  assert.throws(() => ambientMeasurementsSchema.parse({...source, observations:[{...source.observations[0],hotelIds:["way-464824628"]}]}));
});
test("ambient measurements do not change hotel noise matching or historical risk", () => {
  const context = noiseContextSchema.parse(JSON.parse(readFileSync("data/noise-context.json", "utf8")));
  const now = new Date("2026-10-25T12:00:00Z");
  const withMeasurements = evaluateNoise({...context, ambientMeasurements:measurements}, [129.1586863,35.15983896], "2026-11-02", "2026-11-03", now);
  const without = evaluateNoise({...context,ambientMeasurements:undefined}, [129.1586863,35.15983896], "2026-11-02", "2026-11-03", now);
  assert.equal(withMeasurements.matchingStatus, "unknown");
  assert.equal(withMeasurements.matchingStatus, without.matchingStatus);
  assert.equal(withMeasurements.risk, without.risk);
  assert.equal(withMeasurements.ambientMeasurements?.observations.length, 5);
});
