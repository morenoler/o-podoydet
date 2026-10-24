import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLabDataset, labScenarios, writeLabDataset } from "../scripts/lab-data";
import type { Dataset } from "../shared/types";

const now = new Date("2026-10-24T12:00:00Z");
const source: Dataset = {
  evidencePolicy: "verified-only",
  region: "Пусан",
  fetchedAt: "2026-10-01T00:00:00Z",
  sourceDate: "2026-10-01",
  attribution: "Original map attribution",
  bbox: [129.15, 35.15, 129.17, 35.17],
  hotels: [{
    id: "real-original", name: "Real original", address: "Original address",
    coordinates: [129.16, 35.16], osmUrl: "https://www.openstreetmap.org/",
    rooms: [{ id: "real-room", name: "Original room", capacity: 2, demo: false }],
    route: null, noise: [],
  }],
  facts: [],
  map: [{ coordinates: [[129.15, 35.15], [129.17, 35.17]], kind: "road" }],
};

test("lab dataset keeps original evidence untouched and clearly separates six fictional listings", () => {
  const original = structuredClone(source);
  const lab = createLabDataset(source, now);
  assert.deepEqual(source, original);
  assert.equal(lab.evidencePolicy, "demo");
  assert.equal(source.evidencePolicy, "verified-only");
  assert.deepEqual(lab.hotels.slice(0, source.hotels.length), source.hotels);
  assert.deepEqual(lab.map, source.map);
  assert.equal(lab.fetchedAt, source.fetchedAt);
  assert.equal(lab.attribution, source.attribution);
  assert.deepEqual(lab.lab.listingIds, labScenarios.map((scenario) => `lab-demo-${scenario}`));
  for (const hotel of lab.hotels.slice(source.hotels.length)) {
    assert.equal(hotel.synthetic, true);
    assert.match(hotel.name, /^ДЕМО · /);
    assert.ok(hotel.dataNotes?.some((note) => note.includes("Вымышленное объявление")));
    assert.equal(hotel.osmUrl, "");
    assert.equal(hotel.route, null);
    assert.deepEqual(hotel.noise, []);
    assert.ok(hotel.rooms.every((room) => room.demo && !room.sourceUrl));
  }
  for (const fact of lab.facts) {
    assert.equal(fact.method, "demo");
    assert.equal(fact.demo, true);
    assert.equal(fact.sourceUrl, undefined);
    assert.ok(["family", "courtyard", "step_free_access"].includes(fact.feature));
  }
  lab.hotels[0].name = "Changed clone";
  assert.equal(source.hotels[0].name, "Real original");
});

test("fixture evidence covers known positive, negative, missing, expired, conflicting and capacity cases", () => {
  const lab = createLabDataset(source, now);
  const courtyard = (scenario: string) => lab.facts.filter((fact) =>
    fact.hotelId === `lab-demo-${scenario}` && fact.feature === "courtyard");
  assert.deepEqual(courtyard("match").map((fact) => fact.value), [true]);
  assert.deepEqual(courtyard("mismatch").map((fact) => fact.value), [false]);
  assert.deepEqual(courtyard("unknown"), []);
  assert.ok(Date.parse(courtyard("stale")[0].expiresAt) < +now);
  assert.deepEqual(courtyard("conflict").map((fact) => fact.value), [true, false]);
  assert.ok(courtyard("conflict").every((fact) => Date.parse(fact.expiresAt) > +now));
  assert.equal(lab.hotels.find((hotel) => hotel.id === "lab-demo-capacity")?.rooms[0].capacity, 2);
  assert.equal(new Set(lab.facts.map((fact) => fact.id)).size, lab.facts.length);
  assert.ok(lab.facts.every((fact) => lab.hotels.some((hotel) =>
    hotel.id === fact.hotelId && hotel.rooms.some((room) => room.id === fact.roomId))));
});

test("lab generation rejects invalid dates, source policy and reserved IDs", () => {
  assert.throws(() => createLabDataset(source, new Date("invalid")));
  assert.throws(() => createLabDataset({ ...source, evidencePolicy: "demo" }, now));
  const collision = structuredClone(source);
  collision.hotels[0].id = "lab-demo-existing";
  assert.throws(() => createLabDataset(collision, now));
});

test("writer does not overwrite source and persists a separate generated dataset", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ostrovok-lab-data-"));
  const input = join(directory, "source.json");
  const output = join(directory, "generated", "lab.json");
  const original = JSON.stringify(source);
  await writeFile(input, original);
  await assert.rejects(writeLabDataset(input, input, now));
  const generated = await writeLabDataset(input, output, now);
  assert.equal(await readFile(input, "utf8"), original);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), generated);
});
