import test from "node:test";
import assert from "node:assert/strict";
import { envelope, fetchAirSource, parseAirSource, sha256, MAX_AIR_RESPONSE_BYTES } from "../scripts/air-source";

const url = "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=35.16&longitude=129.16";
const fetchedAt = "2026-10-25T09:00:00Z";

test("cache binds exact response bytes to requested URL and retrieval time", () => {
  const body = '{ "units": "μg/m³", "value": 1.5 }\n';
  const source = envelope(body, url, fetchedAt);
  assert.equal(parseAirSource(source, url).body, body);
  assert.equal(source.sha256, sha256(Buffer.from(body)));
  for (const changed of [
    { ...source, body: body.trim() },
    { ...source, requestUrl: url + "0" },
    { ...source, fetchedAt: "2026-10-25T09:00:00" },
    { fetchedAt, response: { value: 1.5 } },
    { ...source, body: "{}", sha256: "0".repeat(64) },
  ]) assert.throws(() => parseAirSource(changed, url));
  assert.throws(() => envelope("x".repeat(MAX_AIR_RESPONSE_BYTES + 1), url, fetchedAt));
});

test("HTTP fetch preserves body and rejects redirects, invalid JSON, wrong types and large streams", async (t) => {
  let body = '{"value":1}\n';
  let type = "application/json";
  let status = 200;
  const fetchMock = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(_url, url);
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    return new Response(body, { status, headers: { "content-type": type } });
  });
  const source = await fetchAirSource(url);
  assert.equal(source.body, body);
  assert.equal(source.sha256, sha256(body));
  assert.equal(parseAirSource(source, url).requestUrl, url);
  body = "not-json";
  await assert.rejects(fetchAirSource(url), SyntaxError);
  body = "\uFEFF{}";
  await assert.rejects(fetchAirSource(url), SyntaxError);
  body = "{}"; type = "text/html";
  await assert.rejects(fetchAirSource(url), /did not return JSON/);
  type = "application/json"; status = 429;
  await assert.rejects(fetchAirSource(url), /HTTP 429/);
  status = 200; body = JSON.stringify({ value: "x".repeat(MAX_AIR_RESPONSE_BYTES) });
  await assert.rejects(fetchAirSource(url), /exceeds 1 MiB/);
  assert.equal(fetchMock.mock.callCount(), 6);
});
