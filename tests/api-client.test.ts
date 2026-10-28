import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/shared/api/client";

test("API transport reports readable network, timeout and malformed response errors", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch");
  fetch.mock.mockImplementation(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(api("/test"), /Не удалось связаться с сервером/);
  fetch.mock.mockImplementation(async () => { throw new DOMException("expired", "TimeoutError"); });
  await assert.rejects(api("/test"), /Сервер не успел ответить/);
  fetch.mock.mockImplementation(async () => new Response("", { status: 502 }));
  await assert.rejects(api("/test"), /Сервис временно недоступен/);
  fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ error: "Выберите даты" }), { status: 400 }));
  await assert.rejects(api("/test"), /Выберите даты/);
  fetch.mock.mockImplementation(async () => Response.json({ ok: true }));
  assert.deepEqual(await api("/test"), { ok: true });
});
test("proxy failures produce a readable retry message and preserve server validation errors", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 502 }));
  await assert.rejects(api("/catalog"), /Сервис временно недоступен/);
  context.mock.restoreAll();
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "Проверьте дату" }), { status: 400 }));
  await assert.rejects(api("/search", {}), /Проверьте дату/);
});

test("search abort signal is forwarded without losing the request body", async (context) => {
  const controller = new AbortController();
  let received: RequestInit | undefined;
  context.mock.method(globalThis, "fetch", async (_: unknown, options: RequestInit) => {
    received = options;
    return new Response("{}");
  });
  await api("/search", { region: "Пусан" }, controller.signal);
  controller.abort();
  assert.equal(received?.signal?.aborted, true);
  assert.equal(received?.body, JSON.stringify({ region: "Пусан" }));
});

test("a cancelled stale search remains an abort rather than a network failure", async (context) => {
  const controller = new AbortController();
  controller.abort();
  const error = new DOMException("cancelled", "AbortError");
  context.mock.method(globalThis, "fetch", async () => { throw error; });
  await assert.rejects(api("/search", {}, controller.signal), (cause) => cause === error);
});
