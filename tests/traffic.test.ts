import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  normalizeTraffic,
  TRAFFIC_URL,
  type TrafficProvenance,
} from "../scripts/fetch-traffic";

const rawText = readFileSync("data/traffic-ktdb-2024.raw.geojson", "utf8");
const raw = JSON.parse(rawText);
const source = JSON.parse(
  readFileSync("data/traffic-ktdb-2024.provenance.json", "utf8"),
) as TrafficProvenance;
test("saved raw response is linked to its exact source by hash", () => {
  assert.equal(source.url, TRAFFIC_URL);
  assert.equal(
    source.sha256,
    createHash("sha256").update(rawText).digest("hex"),
  );
  assert.match(source.url, /Link_ObservedTrafficVolume_total_weekday/);
});
test("normalization retains real counts and their own geometry without future dates", () => {
  const result = normalizeTraffic(raw, source);
  assert.equal(result.referenceYear, 2024);
  assert.equal(result.coverage.returnedLinks, 86);
  assert.equal(result.historicalTrafficProfiles.length, 10);
  assert.equal(
    result.historicalTrafficProfiles.reduce((n, p) => n + p.availableHours, 0),
    184,
  );
  const p = result.historicalTrafficProfiles.find(
    (p) => p.sourceLinkId === "8207700",
  )!;
  assert.deepEqual(p.hourlyVehicleCounts.slice(6, 9), [135, 211, 473]);
  assert.equal(p.reportedTotal, 5846);
  assert.equal(p.availableHours, 16);
  assert.equal(p.hourlyVehicleCounts[0], null);
  assert.equal(p.hourlyVehicleCounts[23], null);
  assert.equal(p.lanes, null);
  assert.equal(p.direction, "source_link_unspecified");
  assert.equal("startsAt" in p, false);
  assert.equal("roadId" in p, false);
  assert.deepEqual(
    p.geometry,
    raw.features.find(
      (f: { properties: { link_id: number } }) =>
        f.properties.link_id === 8207700,
    ).geometry,
  );
});
test("missing values never become zero and all-missing roads are not observations", () => {
  const result = normalizeTraffic(raw, source);
  for (const p of result.historicalTrafficProfiles) {
    assert.ok(p.hourlyVehicleCounts.every((v) => v === null || v >= 0));
    assert.equal(
      p.reportedTotal,
      p.hourlyVehicleCounts.reduce<number>((a, v) => a + (v ?? 0), 0),
    );
  }
  const allMissing = structuredClone(raw);
  for (const f of allMissing.features)
    for (let h = 1; h <= 24; h++)
      f.properties[`t${String(h).padStart(2, "0")}`] = -1000;
  assert.throws(() => normalizeTraffic(allMissing, source), /No real counts/);
});
test("truncated, duplicate, invalid or geographically wrong responses fail instead of replacing data", () => {
  for (const mutate of [
    (r: typeof raw) => r.numberMatched++,
    (r: typeof raw) => {
      r.features[1].properties.link_id = r.features[0].properties.link_id;
    },
    (r: typeof raw) => {
      r.features[0].properties.t01 = -999;
    },
    (r: typeof raw) => {
      r.features[0].properties.sido_id = 11000000;
    },
    (r: typeof raw) => {
      r.features[0].properties.aadt++;
    },
  ]) {
    const changed = structuredClone(raw);
    mutate(changed);
    assert.throws(() => normalizeTraffic(changed, source));
  }
  assert.throws(() => normalizeTraffic("<html>503 unavailable</html>", source));
});
