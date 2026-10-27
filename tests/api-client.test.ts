import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/shared/api/client";

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
