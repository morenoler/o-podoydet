import test from "node:test";
import assert from "node:assert/strict";
import { databaseEnvironment } from "./backend.mjs";

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
