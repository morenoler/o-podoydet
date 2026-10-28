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
  await assert.rejects(api("/test"), /Сервер временно недоступен/);
  fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ error: "Выберите даты" }), { status: 400 }));
  await assert.rejects(api("/test"), /Выберите даты/);
  fetch.mock.mockImplementation(async () => Response.json({ ok: true }));
  assert.deepEqual(await api("/test"), { ok: true });
});
