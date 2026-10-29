import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSnapshot, snapshotDigest } from "../scripts/contract-files.mjs";

for (const [directory, manifestName] of [
  ["snapshots", "snapshots-manifest.json"],
  ["legacy-snapshots", "legacy-manifest.json"],
]) test(`all 85 ${directory} retain their recorded decompressed SHA-256 and HTTP result`, () => {
  const manifest = JSON.parse(readFileSync(`contract/${manifestName}`, "utf8"));
  const spec = JSON.parse(readFileSync("contract/requests.json", "utf8"));
  assert.equal(Object.keys(manifest).length, spec.requests.length);
  for (const { name } of spec.requests) {
    const bytes = readSnapshot(`contract/${directory}`, name);
    assert.deepEqual(snapshotDigest(bytes), manifest[name], name);
    const snapshot = JSON.parse(bytes.toString("utf8"));
    assert.ok(Number.isInteger(snapshot.status), `${name}: HTTP status`);
    assert.ok(Object.hasOwn(snapshot, "body"), `${name}: body`);
  }
});

test("partial contract capture preserves the same manifest on CRLF and LF checkouts", () => {
  const lf = Buffer.from('{\n  "status": 200\n}\n');
  const crlf = Buffer.from(lf.toString().replace(/\n/g, "\r\n"));
  assert.deepEqual(snapshotDigest(crlf), snapshotDigest(lf));
});
