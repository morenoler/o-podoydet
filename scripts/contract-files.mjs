import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

export function readSnapshot(directory, name) {
  const plain = join(directory, `${name}.json`);
  const compressed = `${plain}.gz`;
  if (existsSync(plain) && existsSync(compressed)) throw new Error(`Два эталона ${name}: удалите неоднозначность`);
  if (existsSync(compressed)) return gunzipSync(readFileSync(compressed));
  if (existsSync(plain)) return readFileSync(plain);
  throw new Error(`Нет эталона ${name}: сравнение неполно`);
}

export function writeSnapshot(directory, name, snapshot) {
  const bytes = Buffer.from(JSON.stringify(snapshot, null, 2) + "\n");
  const plain = join(directory, `${name}.json`);
  const compressed = `${plain}.gz`;
  if (bytes.length >= 50_000) {
    writeFileSync(compressed, gzipSync(bytes, { level: 9 }));
    rmSync(plain, { force: true });
  } else {
    writeFileSync(plain, bytes);
    rmSync(compressed, { force: true });
  }
}

export function snapshotDigest(bytes) {
  // Text snapshots can be checked out with CRLF; the manifest always describes canonical Git LF.
  const canonical = Buffer.from(Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n"));
  return { bytes: canonical.length, sha256: createHash("sha256").update(canonical).digest("hex") };
}
