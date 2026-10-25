import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  airRequestUrl,
  normalizeAir,
  unknownAir,
  assessSafety,
  makeAssessment,
  aqiCategory,
  officialImportSchema,
  refreshAreaFreshness,
  evidenceContains,
  type OfficialEvidence,
} from "../shared/area";

const now = new Date("2026-10-24T09:00:00Z");
const raw = () => ({
  latitude: 35.2,
  longitude: 129.2,
  current_units: {
    time: "unixtime",
    pm2_5: "μg/m³",
    pm10: "μg/m³",
    nitrogen_dioxide: "μg/m³",
    us_aqi: "USAQI",
  },
  current: {
    time: +now / 1000,
    pm2_5: 7.1,
    pm10: 15,
    nitrogen_dioxide: 20,
    us_aqi: 42,
  },
});
const evidence = (): OfficialEvidence => ({
  id: "test-fixture",
  sourcePublisher: "TEST: official-format fixture, not actual statistics",
  sourceUrl: "https://www.safemap.go.kr/test-fixture",
  publishedAt: "2026-02-01",
  retrievedAt: "2026-10-24T08:00:00Z",
  period: { from: "2025-01-01", to: "2025-12-31" },
  geography: {
    name: "TEST polygon",
    code: "TEST",
    sourceUrl: "https://www.openstreetmap.org/relation/1",
    type: "Polygon",
    coordinates: [
      [
        [129, 35],
        [130, 35],
        [130, 36],
        [129, 36],
        [129, 35],
      ],
    ],
  },
  metric: "reported_incidents",
  metricLabel: "Synthetic incidents",
  sourceRecord: "Synthetic row, not an actual publication",
  value: 10,
  unit: "reported incidents",
  methodology: "Synthetic test fixture; never used as evidence in the app.",
  limitations: ["Synthetic test data."],
  verification: "operator-checked-official-source",
});

test("air keeps provider time, exact concentrations and model resolution; never a station measurement", () => {
  const url = airRequestUrl([129.16, 35.16]),
    result = normalizeAir(raw(), now.toISOString(), url, now, [129.16, 35.16]);
  assert.equal(result.status, "available");
  assert.equal(result.pm25, 7.1);
  assert.equal(result.usAqi, 42);
  assert.equal(result.time, now.toISOString());
  assert.equal(result.resolutionKm, 45);
  assert.equal(result.temporalResolutionHours, 3);
  assert.match(url, /domains=cams_global/);
  assert.match(result.limitations.join(" "), /не измерение станции/);
});
test("partial null invalid or incorrectly unit-labelled air values never become zero", () => {
  const r = raw();
  (r.current as any).pm2_5 = null;
  r.current.pm10 = -1;
  r.current_units.nitrogen_dioxide = "ppb";
  const result = normalizeAir(r, now.toISOString(), "test", now);
  assert.equal(result.status, "partial");
  assert.equal(result.pm25, null);
  assert.equal(result.pm10, null);
  assert.equal(result.no2, null);
  assert.equal(result.usAqi, 42);
  (r.current as any).us_aqi = NaN;
  assert.equal(
    normalizeAir(r, now.toISOString(), "test", now).status,
    "unknown",
  );
});
test("old air remains dated and stale; malformed or future time and wrong point are unknown", () => {
  assert.equal(
    normalizeAir(raw(), "2026-10-23T00:00:00Z", "test", now).status,
    "stale",
  );
  const r = raw();
  r.current.time += 7200;
  assert.equal(
    normalizeAir(r, now.toISOString(), "test", now).status,
    "unknown",
  );
  assert.equal(
    normalizeAir(raw(), now.toISOString(), "test", now, [39.9, 43.4]).status,
    "unknown",
  );
  assert.equal(normalizeAir(raw(), "broken", "test", now).status, "unknown");
  assert.equal(
    normalizeAir(
      { error: true, reason: "provider unavailable" },
      now.toISOString(),
      "test",
      now,
    ).status,
    "unknown",
  );
});
test("AQI categories use provider index boundaries without deriving index from PM concentration", () => {
  assert.equal(aqiCategory(50), "Хороший");
  assert.equal(aqiCategory(51), "Умеренный");
  assert.equal(aqiCategory(101), "Нездоровый для чувствительных групп");
  assert.equal(aqiCategory(301), "Опасный");
  assert.equal(aqiCategory(null), null);
  assert.equal(aqiCategory(-1), null);
});
test("saved snapshot becomes stale at read time without changing source timestamps or persisted object", () => {
  const a = makeAssessment(
    { hotelId: "test", name: "test", coordinates: [129.16, 35.16] },
    normalizeAir(raw(), now.toISOString(), "test", now),
    [],
    now,
  );
  const later = refreshAreaFreshness(a, new Date(+now + 7 * 3600000));
  assert.equal(later.airQuality.status, "stale");
  assert.equal(a.airQuality.status, "available");
  assert.equal(later.airQuality.time, a.airQuality.time);
});
test("no crime evidence yields unknown, with no proxy score and no demographic inputs", () => {
  const a = makeAssessment(
    { hotelId: "test", name: "test", coordinates: [129.16, 35.16] },
    unknownAir("test"),
    [],
    now,
  );
  assert.equal(a.safety.status, "unknown");
  assert.equal(a.safety.evidence.length, 0);
  assert.equal("score" in a.safety, false);
  assert.match(a.safety.limitations.join(" "), /демографический/);
});
test("official import requires source period geometry methodology and rejects proxy metrics or extra fields", () => {
  assert.equal(
    officialImportSchema.safeParse({ version: 1, records: [evidence()] })
      .success,
    true,
  );
  for (const bad of [
    { ...evidence(), sourceUrl: "https://example.com/crime" },
    { ...evidence(), period: { from: "2026-01-02", to: "2025-01-01" } },
    { ...evidence(), metric: "cctv_count" },
    { ...evidence(), ethnicity: "test" },
    { ...evidence(), metric: "crime_density_grade", value: 11 },
  ])
    assert.equal(
      officialImportSchema.safeParse({ version: 1, records: [bad] }).success,
      false,
    );
});
test("official evidence applies only inside exact polygon, excluding holes, boundaries and future publication", () => {
  const e = evidence();
  assert.equal(assessSafety([129.2, 35.2], [e], now).status, "evidence");
  assert.equal(assessSafety([128, 35.2], [e], now).status, "unknown");
  assert.equal(assessSafety([129, 35.2], [e], now).status, "unknown");
  if (e.geography.type === "Polygon")
    e.geography.coordinates.push([
      [129.1, 35.1],
      [129.3, 35.1],
      [129.3, 35.3],
      [129.1, 35.3],
      [129.1, 35.1],
    ]);
  assert.equal(assessSafety([129.2, 35.2], [e], now).status, "unknown");
  assert.equal(assessSafety([129.1, 35.2], [e], now).status, "unknown");
  assert.equal(
    assessSafety([129.5, 35.5], [{ ...e, publishedAt: "2027-01-01" }], now)
      .status,
    "unknown",
  );
});
test("packaged historical Haeundae values match source CSV and the identified administrative polygon", async () => {
  const imported = officialImportSchema.parse(
    JSON.parse(await readFile("data/official-safety-evidence.json", "utf8")),
  );
  const bytes = await readFile("data/korea-crime-2025.csv"),
    rows = new TextDecoder("euc-kr")
      .decode(bytes)
      .trim()
      .split(/\r?\n/)
      .map((r) => r.split(","));
  const column = rows[0].indexOf("부산 해운대구");
  assert.ok(column > 0);
  for (const record of imported.records) {
    const minor = record.id.endsWith("theft") ? "절도범죄" : "강도",
      row = rows.find((r) => r[1] === minor)!;
    assert.equal(record.value, Number(row[column]));
    assert.equal(
      record.sourceFileSha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
    assert.equal(record.geography.code, "2635000000");
    assert.match(record.geography.sourceUrl, /relation\/4062934$/);
    assert.equal(record.period.from, "2025-01-01");
    assert.equal(record.period.to, "2025-12-31");
    assert.equal(evidenceContains(record, [129.16, 35.16]), true);
    assert.equal(evidenceContains(record, [129.05, 35.16]), false);
  }
});
test("offline CLI batch preserves per-hotel values, skips invalid coordinates and reports missing responses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "o-area-"));
  try {
    const input = join(dir, "input.json"),
      offline = join(dir, "offline.json"),
      output = join(dir, "output.json");
    await writeFile(
      input,
      JSON.stringify({
        region: "Пусан",
        hotels: [
          { id: "a", name: "A", coordinates: [129.16, 35.16] },
          { id: "b", name: "B", coordinates: [129.17, 35.17] },
          { id: "bad", name: "Invalid", coordinates: [null, 200] },
        ],
      }),
    );
    await writeFile(
      offline,
      JSON.stringify({
        responses: { a: { fetchedAt: now.toISOString(), response: raw() } },
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("scripts/assess-area.ts"),
        "--input",
        input,
        "--offline",
        offline,
        "--now",
        now.toISOString(),
        "--output",
        output,
      ],
      { encoding: "utf8", timeout: 15000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(await readFile(output, "utf8"));
    assert.equal(data.assessments.length, 2);
    assert.equal(data.skipped.length, 1);
    assert.equal(data.assessments[0].airQuality.status, "available");
    assert.equal(data.assessments[1].airQuality.status, "unknown");
    assert.equal(data.region, "Пусан");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
