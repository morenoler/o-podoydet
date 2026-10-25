import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  root,
  seedDemoDatabase,
  setupDemoDatabase,
  validateDemoDatabase,
} from "./demo-data.mjs";

function temporary(run) {
  const directory = resolve(root, ".local");
  mkdirSync(directory, { recursive: true });
  const path = mkdtempSync(join(directory, "demo-check-"));
  try {
    run(path);
  } finally {
    assert.ok(resolve(path).startsWith(directory + sep + "demo-check-"));
    rmSync(path, { recursive: true });
  }
}
const digest = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

test("synthetic seed has exact status counts, valid foreign keys and Java-compatible passwords", () =>
  temporary((path) => {
    const result = seedDemoDatabase({
      output: join(path, "fixture.sqlite3"),
      date: "2026-10-25",
    });
    assert.equal(result.counts.account_sessions, 0);
    assert.equal(result.counts.advisor_runs, 0);
    assert.equal(result.counts.account_bookings, 6);
    assert.equal(result.counts.account_questions, 6);
    assert.ok(!existsSync(result.path + "-wal"));
    assert.ok(!existsSync(result.path + "-shm"));
  }));

test("seed and setup refuse to overwrite any existing database", () =>
  temporary((path) => {
    const source = seedDemoDatabase({
      output: join(path, "fixture.sqlite3"),
      date: "2026-10-25",
    }).path;
    const original = digest(source);
    assert.throws(
      () => seedDemoDatabase({ output: source }),
      /Перезапись запрещена/,
    );
    assert.equal(digest(source), original);
    const target = setupDemoDatabase({
      source,
      output: join(path, "copy.sqlite3"),
      date: "2026-11-01",
    }).path;
    const copied = digest(target);
    assert.throws(
      () => setupDemoDatabase({ source, output: target }),
      /Перезапись запрещена/,
    );
    assert.equal(digest(target), copied);
  }));

test("setup rebases only the new copy, preserving relative past and future trips", () =>
  temporary((path) => {
    const source = seedDemoDatabase({
      output: join(path, "fixture.sqlite3"),
      date: "2026-10-25",
    }).path;
    const original = digest(source);
    const target = setupDemoDatabase({
      source,
      output: join(path, "copy.sqlite3"),
      date: "2028-02-29",
    }).path;
    assert.equal(digest(source), original);
    assert.equal(validateDemoDatabase(target).seedDate, "2028-02-29");
    const db = new DatabaseSync(target, { readOnly: true });
    try {
      assert.equal(
        db
          .prepare(
            "SELECT MIN(check_in) AS date FROM account_bookings WHERE status='pending'",
          )
          .get().date,
        "2028-03-07",
      );
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM account_bookings WHERE status='completed' AND check_out<'2028-02-29'",
          )
          .get().n,
        2,
      );
    } finally {
      db.close();
    }
  }));

test("invalid dates and paths to the main database are rejected before writing", () =>
  temporary((path) => {
    const output = join(path, "invalid.sqlite3");
    assert.throws(
      () => seedDemoDatabase({ output, date: "2027-02-29" }),
      /Некорректная/,
    );
    assert.equal(existsSync(output), false);
    assert.throws(
      () => seedDemoDatabase({ output: ".local/busan.sqlite3" }),
      /Основные базы недоступны/,
    );
  }));
