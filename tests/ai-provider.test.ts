import test from "node:test";
import assert from "node:assert/strict";
import { aiProviderHeaders, aiRequestTimeout, getAiProvider, parseAiProvider, setAiProvider } from "../src/shared/api/aiProvider";
import { api } from "../src/shared/api/client";
import { requestLabSnapshot } from "../src/features/lab/useLab";
import type { Trip } from "../shared/types";

test("provider selection is explicit, scoped to model operations, and can be reset", () => {
  try {
    setAiProvider(null);
    assert.deepEqual(aiProviderHeaders("/search", true), {});
    assert.equal(parseAiProvider("https://arbitrary-provider.example"), null);
    assert.equal(parseAiProvider("LOCAL"), null);
    for (const provider of ["deepseek", "local", "rules"] as const) {
      setAiProvider(provider);
      assert.equal(getAiProvider(), provider);
      for (const path of ["/search", "/search/conversation", "/lab/search", "/hotels/hotel/evaluate", "/questions/id/answer", "/drafts/id/confirm", "/v2/questions/id/answer", "/v2/host/hotel/simulate"])
        assert.deepEqual(aiProviderHeaders(path, true), { "X-AI-Provider": provider });
      assert.deepEqual(aiProviderHeaders("/advisor/config", false), {});
      assert.deepEqual(aiProviderHeaders("/catalog?region=Пусан", false), {});
      for (const path of ["/ai/config", "/auth/login", "/advisor/runs", "/advisor/runs/id/cancel", "/accounts/clarifications", "/health"])
        assert.deepEqual(aiProviderHeaders(path, true), {});
    }
  } finally { setAiProvider(null); }
});

test("lab rules snapshots never inherit a selected paid provider", async () => {
  const original = globalThis.fetch;
  const seen: {url: unknown; headers: HeadersInit | undefined}[] = [];
  globalThis.fetch = async (url, init) => {
    seen.push({url,headers:init?.headers});
    return new Response(JSON.stringify({searchId:'synthetic-snapshot'}), {status:200});
  };
  const trip: Trip = {region:'Пусан',checkIn:'2027-06-01',checkOut:'2027-06-04',adults:2,children:0,scenarios:[],preferences:[],text:'Синтетический запрос'};
  try {
    setAiProvider('deepseek');
    for (const testOnly of [false,true]) {
      const result=await requestLabSnapshot(trip,'rules',testOnly);
      assert.equal(result.searchId,'synthetic-snapshot');
      assert.deepEqual(seen.at(-1)?.headers, {'X-AI-Provider':'rules','Content-Type':'application/json'});
      assert.equal(seen.at(-1)?.url, testOnly ? '/api/lab/search' : '/api/search');
    }
    await requestLabSnapshot(trip,'local');
    assert.deepEqual(seen.at(-1)?.headers, {'X-AI-Provider':'local','Content-Type':'application/json'});
    assert.equal(getAiProvider(),'deepseek');
  } finally { globalThis.fetch=original;setAiProvider(null); }
});

test("API sends the selected provider on the next request and preserves content type", async () => {
  const original = globalThis.fetch;
  const seen: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => {
    seen.push(init!);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    setAiProvider("deepseek");
    await api("/search/conversation", { message: "synthetic test" });
    setAiProvider("local");
    await api("/search", { text: "synthetic test" });
    await api("/ai/config");
    assert.deepEqual(seen[0].headers, { "X-AI-Provider": "deepseek", "Content-Type": "application/json" });
    assert.deepEqual(seen[1].headers, { "X-AI-Provider": "local", "Content-Type": "application/json" });
    assert.deepEqual(seen[2].headers, {});
    assert.doesNotMatch(JSON.stringify(seen), /Authorization|API_KEY/);
    assert.ok(aiRequestTimeout("/search/conversation", true) > 360_000);
    assert.equal(aiRequestTimeout("/advisor/runs", true), 30_000);
  } finally { globalThis.fetch = original; setAiProvider(null); }
});
