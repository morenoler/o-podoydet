import test from "node:test";
import assert from "node:assert/strict";
import { databaseEnvironment } from "./backend.mjs";
import { isolatedSchema } from "./local-runtime.mjs";
import { differences, parseContractArguments } from "./contract.mjs";

test("explicit JDBC URL still isolates lab and demo schemas", () => {
  const original = { DATABASE_URL: "jdbc:postgresql://localhost:5432/test?sslmode=disable&currentSchema=public",
    DATABASE_USER: "test-user", DATABASE_PASSWORD: "test-password", DB_SCHEMA: "lab_case" };
  const result = databaseEnvironment(original);
  const url = new URL(result.DATABASE_URL.slice(5));
  assert.equal(url.searchParams.get("currentSchema"), "lab_case");
  assert.equal(url.searchParams.getAll("currentSchema").length, 1);
  assert.equal(url.searchParams.get("sslmode"), "disable");
  assert.equal(result.DATABASE_USER, "test-user");
  assert.equal(result.DATABASE_PASSWORD, "test-password");
  assert.ok(original.DATABASE_URL.endsWith("currentSchema=public"));
});

test("schema and database type validation fail before a child JVM starts", () => {
  for (const schema of ["public,private", "../demo", "x;drop schema public", "x".repeat(64)])
    assert.throws(() => databaseEnvironment({ DB_SCHEMA: schema }), /DB_SCHEMA/);
  assert.throws(() => databaseEnvironment({ DATABASE_URL: "jdbc:sqlite:demo.db" }), /PostgreSQL/);
  const fallback = databaseEnvironment({});
  assert.equal(fallback.DB_SCHEMA, "public");
  assert.equal(new URL(fallback.DATABASE_URL.slice(5)).searchParams.get("currentSchema"), "public");
});

test("default JDBC endpoint follows the Compose PostgreSQL port", () => {
  const child = databaseEnvironment({ POSTGRES_PORT: "55454", DB_SCHEMA: "isolated" });
  const url = new URL(child.DATABASE_URL.slice(5));
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55454");
  assert.equal(url.searchParams.get("currentSchema"), "isolated");
  for (const port of ["0", "65536", "5432/foo", "5432.5", "not-a-port"])
    assert.throws(() => databaseEnvironment({ POSTGRES_PORT: port }), /POSTGRES_PORT/);
  assert.equal(new URL(databaseEnvironment({ DATABASE_URL: "jdbc:postgresql://db.example:1234/test", POSTGRES_PORT: "unused" }).DATABASE_URL.slice(5)).port, "1234");
});

test("synthetic schemas reject public even when the main schema is custom", () => {
  for (const key of ["LAB_DB_SCHEMA", "DEMO_DB_SCHEMA"])
    for (const schema of ["public", "main_custom", "pg_catalog", "information_schema", "invalid,name"])
      assert.throws(() => isolatedSchema({ DB_SCHEMA: "main_custom", [key]: schema }, key, "lab"), /отдельная несистемная схема/);
  assert.equal(isolatedSchema({ DB_SCHEMA: "main_custom", LAB_DB_SCHEMA: "lab_review" }, "LAB_DB_SCHEMA", "lab"), "lab_review");
});

test("approved contract differences cannot hide a later incompatible field", () => {
  const expected = { approved: Array.from({ length: 50 }, () => false), result: "supported" };
  const actual = { approved: Array.from({ length: 50 }, () => true), result: "unknown" };
  assert.deepEqual(differences(expected, actual, "$", [], [], ["$.approved"]), ['$.result: "supported" → "unknown"']);
  assert.deepEqual(differences(expected, { ...actual, result: "supported" }, "$", [], [], ["$.approved"]), []);
  assert.deepEqual(differences(expected, { result: "supported" }, "$", [], [], ["$.approved"]), []);
});

test("contract subset typos fail instead of reporting a successful zero-of-zero check", () => {
  assert.throws(() => parseContractArguments(["check", "--base", "http://127.0.0.1:8089", "--only", "not-a-real-request"]), /Неизвестные имена/);
  assert.throws(() => parseContractArguments(["check", "--base", "--only", "health"]), /Ожидаются/);
  assert.throws(() => parseContractArguments(["check", "--base", "http://127.0.0.1:8089", "--unknown", "value"]), /Ожидаются/);
});
