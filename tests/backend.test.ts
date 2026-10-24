import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { evaluate, rankHotels } from "../shared/matching";
import { tripSchema } from "../shared/validation";
import type {
  Dataset,
  Draft,
  Fact,
  Hotel,
  Preference,
  Trip,
} from "../shared/types";
import {
  extractAnswer,
  extractRules,
  interpretTrip,
  parseRules,
} from "../server/agents";
import { Store } from "../server/store";
import { createApp } from "../server/index";

const now = new Date("2026-10-24T12:00:00Z");
const trip: Trip = {
  region: "Адлер",
  checkIn: "2027-06-10",
  checkOut: "2027-06-17",
  adults: 2,
  children: 1,
  scenarios: [],
  preferences: [],
  text: "",
};
const hotel: Hotel = {
  id: "hotel-a",
  name: "Тестовый отель",
  address: "Тестовый адрес",
  coordinates: [39.9, 43.4],
  osmUrl: "https://www.openstreetmap.org/",
  rooms: [
    { id: "room-a", name: "Семейный во двор", capacity: 4, demo: true },
    { id: "room-b", name: "Семейный у входа", capacity: 4, demo: true },
  ],
  route: null,
  noise: [],
};
const seed: Dataset = {
  region: "Адлер",
  fetchedAt: now.toISOString(),
  sourceDate: now.toISOString(),
  attribution: "OSM",
  bbox: [39, 43, 40, 44],
  hotels: [hotel],
  facts: [],
  map: [],
};
function fact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: "fact-a",
    hotelId: hotel.id,
    roomId: "room-a",
    feature: "courtyard",
    value: true,
    source: "Демо",
    quote: "Окна во двор",
    method: "demo",
    confidence: "low",
    confidenceReason: "Демонстрация",
    obtainedAt: "2026-10-01T00:00:00Z",
    expiresAt: "2030-01-01T00:00:00Z",
    demo: true,
    ...overrides,
  };
}
function pref(feature: Preference["feature"], required = true): Preference {
  return { feature, required };
}
function question(store: Store) {
  return store.ask({
    hotelId: hotel.id,
    roomId: "room-a",
    feature: "courtyard",
    text: "Куда выходят все окна?",
    trace: [],
  });
}
function draft(questionId: string, id = "draft-a", value = true): Draft {
  return {
    id,
    questionId,
    text: value ? "Все окна во двор." : "Окна на улицу.",
    extractions: [
      {
        feature: "courtyard",
        value,
        quote: value ? "Все окна во двор." : "Окна на улицу.",
      },
    ],
    warnings: [],
    mode: "rules",
  };
}

test("date validation rejects rollover dates, reversed range, invalid guests and duplicate wishes", () => {
  assert.ok(tripSchema.safeParse(trip).success);
  for (const change of [
    { checkIn: "2027-02-30" },
    { checkOut: trip.checkIn },
    { checkOut: "2027-06-09" },
    { adults: 0 },
    { children: 0.5 },
    { region: "Сочи" },
    { scenarios: ["sea", "sea"] },
    { preferences: [pref("courtyard"), pref("courtyard")] },
  ])
    assert.equal(
      tripSchema.safeParse({ ...trip, ...change }).success,
      false,
      JSON.stringify(change),
    );
});

test("unknown, expired, invalid and out-of-period evidence never becomes a match", () => {
  for (const [facts, status] of [
    [[], "unknown"],
    [[fact({ expiresAt: "2026-10-23T00:00:00Z" })], "stale"],
    [[fact({ value: "unknown" })], "unknown"],
    [[fact({ validTo: "2027-06-12" })], "unknown"],
    [[fact({ supersededBy: "new" })], "unknown"],
  ] as const) {
    assert.equal(
      evaluate([...facts], pref("courtyard"), hotel.rooms[0], trip, now).status,
      status,
    );
  }
  const result = rankHotels([hotel], [], [pref("courtyard")], trip, now)[0];
  assert.equal(result.best.status, "clarify");
});

test("room facts cannot combine different room advantages or leak between hotels", () => {
  const facts = [
    fact(),
    fact({ id: "access-b", roomId: "room-b", feature: "step_free_access" }),
  ];
  const result = rankHotels(
    [hotel],
    facts,
    [pref("courtyard"), pref("step_free_access")],
    trip,
    now,
  )[0];
  assert.equal(result.best.status, "clarify");
  assert.ok(
    result.rooms.every(
      (r) => r.criteria.filter((c) => c.status === "match").length === 1,
    ),
  );
  const other = rankHotels(
    [{ ...hotel, id: "other" }],
    facts,
    [pref("courtyard")],
    trip,
    now,
  )[0];
  assert.equal(other.best.criteria[0].status, "unknown");
  assert.equal(
    evaluate(
      [fact({ roomId: undefined })],
      pref("courtyard"),
      hotel.rooms[0],
      trip,
      now,
    ).status,
    "unknown",
  );
});

test("conflicting active evidence requires clarification; expired evidence does not overrule current fact", () => {
  const yes = fact(),
    no = fact({ id: "no", value: false });
  assert.equal(
    evaluate([yes, no], pref("courtyard"), hotel.rooms[0], trip, now).status,
    "conflict",
  );
  assert.equal(
    evaluate(
      [yes, { ...no, expiresAt: "2026-01-01T00:00:00Z" }],
      pref("courtyard"),
      hotel.rooms[0],
      trip,
      now,
    ).status,
    "match",
  );
});

test("mandatory mismatches and capacity shortages are excluded without relaxing constraints", () => {
  const distance = fact({
    roomId: undefined,
    feature: "beach_walk",
    value: 1500,
  });
  assert.equal(
    rankHotels([hotel], [distance], [pref("beach_walk")], trip, now)[0].best
      .status,
    "excluded",
  );
  assert.equal(
    rankHotels([hotel], [distance], [pref("beach_walk", false)], trip, now)[0]
      .best.status,
    "fits",
  );
  assert.equal(
    rankHotels([hotel], [], [], { ...trip, adults: 5 }, now)[0].best.status,
    "excluded",
  );
  assert.equal(
    evaluate(
      [fact({ roomId: undefined, feature: "beach_walk", value: -4 })],
      pref("beach_walk"),
      hotel.rooms[0],
      trip,
      now,
    ).status,
    "unknown",
  );
});

test("text interpretation keeps mandatory selections and isolates negations to each wish", () => {
  const result = parseRules("Тишина не нужна, нужен семейный номер.", [
    pref("courtyard"),
  ]);
  assert.equal(
    result.preferences.find((p) => p.feature === "courtyard")?.required,
    true,
  );
  assert.ok(result.conflicts.length);
  assert.ok(result.preferences.some((p) => p.feature === "family"));
  assert.equal(
    parseRules("Не обязательно тихий номер", []).preferences[0]?.required,
    false,
  );
  assert.equal(
    parseRules("Нужен тихий номер", [pref("courtyard")]).preferences[0]
      .required,
    true,
  );
  assert.ok(
    parseRules("Хочу выспаться", []).warnings.some((w) =>
      w.includes("не гарантирует"),
    ),
  );
});

test("rules extraction refuses uncertain, partial and mixed-room statements", () => {
  for (const [text, feature] of [
    ["Лифт есть.", "step_free_access"],
    ["Лифта нет.", "step_free_access"],
    ["Вход без ступеней.", "step_free_access"],
    ["Перед входом три ступени, есть обход по пандусу.", "step_free_access"],
    ["Номер 203 выходит во двор.", "courtyard"],
    ["Некоторые окна во двор, другие на улицу.", "courtyard"],
    ["Возможно, все окна во двор.", "courtyard"],
    ["Не все окна во двор.", "courtyard"],
    ["Подходит.", "family"],
    ["С детьми не знаю.", "family"],
    ["От входа до номера без ступеней.", "step_free_access"],
  ] as const)
    assert.deepEqual(extractRules(text, feature).extractions, [], text);
});

test("rules extraction distinguishes explicit negatives and retains exact evidence", () => {
  for (const [text, feature, value] of [
    ["Все окна во двор.", "courtyard", true],
    ["Окна не во двор.", "courtyard", false],
    ["Окна не на улицу, а во двор.", "courtyard", true],
    ["От улицы до номера можно пройти без ступеней.", "step_free_access", true],
    [
      "Лифт есть, но перед входом три ступени, пандуса нет.",
      "step_free_access",
      false,
    ],
    ["Этот номер не семейный.", "family", false],
    ["Семейных номеров нет.", "family", false],
    ["Можно размещаться с детьми.", "family", true],
  ] as const) {
    assert.deepEqual(
      extractRules(text, feature).extractions,
      [{ feature, value, quote: text }],
      text,
    );
  }
});

test("LLM outage falls back honestly and never loses parser warnings", async (t) => {
  const key = process.env.LLM_API_KEY,
    model = process.env.LLM_MODEL;
  process.env.LLM_API_KEY = "test-only";
  process.env.LLM_MODEL = "test-only";
  t.after(() => {
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
    if (model === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = model;
  });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("offline");
  });
  const result = await interpretTrip({ ...trip, text: "Тихий номер" });
  assert.equal(result.mode, "rules");
  assert.ok(result.warnings.some((w) => w.includes("недоступен")));
  assert.ok(result.warnings.some((w) => w.includes("не гарантирует")));
  const answer = await extractAnswer("Лифт есть.", "step_free_access");
  assert.deepEqual(answer.extractions, []);
  assert.equal(answer.mode, "rules");
  assert.ok(answer.warnings.length > 1);
});

test("unsupported LLM quote is rejected before saving a fact", async (t) => {
  const key = process.env.LLM_API_KEY,
    model = process.env.LLM_MODEL;
  process.env.LLM_API_KEY = "test-only";
  process.env.LLM_MODEL = "test-only";
  t.after(() => {
    if (key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = key;
    if (model === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = model;
  });
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    extractions: [
                      {
                        feature: "step_free_access",
                        value: true,
                        quote: "Нет ступеней на всём пути",
                      },
                    ],
                    warnings: [],
                  }),
                },
              ],
            },
          ],
        }),
      ),
  );
  const answer = await extractAnswer("Лифт есть.", "step_free_access");
  assert.deepEqual(answer.extractions, []);
  assert.equal(answer.mode, "rules");
});

test("questions are deduplicated and confirmation cannot replay a draft or resurrect other previews", (t) => {
  const store = new Store(":memory:", seed);
  t.after(() => store.db.close());
  const q = question(store);
  assert.equal(question(store).id, q.id);
  assert.equal(store.questions().length, 1);
  store.draft(draft(q.id));
  store.draft(draft(q.id, "draft-b", false));
  const saved = store.confirm("draft-a", false);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].demo, true);
  assert.equal(saved[0].roomId, "room-a");
  assert.equal(store.question(q.id)?.status, "answered");
  assert.throws(() => store.confirm("draft-a", false));
  assert.equal(store.facts().length, 1);
  question(store);
  assert.equal(store.getDraft("draft-b"), undefined);
  assert.throws(() => store.confirm("draft-b", false));
});

test("store rejects unsupported extraction feature, quote, multiple facts and closed questions", (t) => {
  const store = new Store(":memory:", seed);
  t.after(() => store.db.close());
  const q = question(store),
    d = draft(q.id);
  assert.throws(() =>
    store.draft({
      ...d,
      extractions: [{ feature: "family", value: true, quote: d.text }],
    }),
  );
  assert.throws(() =>
    store.draft({
      ...d,
      extractions: [
        { feature: "courtyard", value: true, quote: "выдуманная цитата" },
      ],
    }),
  );
  assert.throws(() =>
    store.draft({ ...d, extractions: [...d.extractions, ...d.extractions] }),
  );
  store.draft(d);
  store.confirm(d.id, false);
  assert.throws(() => store.draft({ ...d, id: "another" }));
});

test("saving without resolution preserves a conflict; explicit resolution supersedes only same scope", (t) => {
  const other = fact({ id: "other-room", roomId: "room-b" });
  const store = new Store(":memory:", { ...seed, facts: [fact(), other] });
  t.after(() => store.db.close());
  let q = question(store);
  store.draft(draft(q.id, "negative", false));
  store.confirm("negative", false);
  assert.equal(
    evaluate(store.facts(), pref("courtyard"), hotel.rooms[0], trip).status,
    "conflict",
  );
  q = question(store);
  store.draft(draft(q.id, "resolved"));
  store.confirm("resolved", true);
  assert.equal(
    evaluate(store.facts(), pref("courtyard"), hotel.rooms[0], trip).status,
    "match",
  );
  assert.equal(
    store.facts().find((f) => f.id === other.id)?.supersededBy,
    undefined,
  );
});

test("failed confirmation rolls back facts, supersession and question status atomically", (t) => {
  const store = new Store(":memory:", { ...seed, facts: [fact()] });
  t.after(() => store.db.close());
  const q = question(store);
  store.draft(draft(q.id, "fail", false));
  store.db.exec(
    "CREATE TRIGGER reject_answer BEFORE UPDATE ON questions BEGIN SELECT RAISE(ABORT, 'test rollback'); END",
  );
  assert.throws(() => store.confirm("fail", true), /test rollback/);
  assert.equal(store.facts().length, 1);
  assert.equal(store.facts()[0].supersededBy, undefined);
  assert.equal(store.question(q.id)?.status, "open");
  assert.ok(store.getDraft("fail"));
  store.db.exec("DROP TRIGGER reject_answer");
  assert.equal(store.confirm("fail", true).length, 1);
});

test("confirmed answers persist across SQLite restart", () => {
  const folder = mkdtempSync(join(tmpdir(), "o-podoydet-test-"));
  const path = join(folder, "test.sqlite");
  let store: Store | undefined;
  try {
    store = new Store(path, seed);
    const q = question(store);
    store.draft(draft(q.id));
    const saved = store.confirm("draft-a", false);
    store.db.close();
    store = undefined;
    store = new Store(path, seed);
    assert.equal(store.facts()[0].id, saved[0].id);
    assert.equal(store.question(q.id)?.status, "answered");
  } finally {
    store?.db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("HTTP API validates input and runs question → preview → confirm → updated matching", async (t) => {
  const key = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  t.after(() => {
    if (key !== undefined) process.env.LLM_API_KEY = key;
  });
  const store = new Store(":memory:", seed),
    server = createApp(seed, store).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    store.db.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function post(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }
  assert.equal(
    (await post("/api/search", { ...trip, checkIn: "2027-02-30" })).status,
    400,
  );
  assert.equal(
    (await post("/api/search", trip, { Origin: "https://external.test" }))
      .status,
    403,
  );
  assert.equal(
    (await post("/api/search", trip, { Origin: "bad origin" })).status,
    403,
  );
  const request = {
    hotelId: hotel.id,
    roomId: "room-a",
    feature: "courtyard",
    trip,
  };
  assert.equal(
    (await post("/api/questions", { ...request, roomId: "nonexistent" }))
      .status,
    404,
  );
  const route = await (
    await post("/api/questions", { ...request, feature: "step_free_route" })
  ).json();
  assert.equal(route.question, null);
  assert.ok(route.message.includes("не найден"));
  const q = (await (await post("/api/questions", request)).json()).question;
  assert.equal(
    (await (await post("/api/questions", request)).json()).question.id,
    q.id,
  );
  const before = await (
    await post("/api/search", { ...trip, preferences: [pref("courtyard")] })
  ).json();
  assert.equal(before.results[0].best.status, "clarify");
  const preview = await (
    await post(`/api/questions/${q.id}/preview`, { text: "Все окна во двор." })
  ).json();
  assert.equal(preview.extractions.length, 1);
  assert.equal(store.facts().length, 0);
  assert.equal(
    (
      await post(`/api/drafts/${preview.id}/confirm`, {
        resolveConflict: "true",
      })
    ).status,
    400,
  );
  const confirmation = await (
    await post(`/api/drafts/${preview.id}/confirm`, { resolveConflict: false })
  ).json();
  assert.equal(confirmation.facts[0].demo, true);
  const after = await (
    await post("/api/search", { ...trip, preferences: [pref("courtyard")] })
  ).json();
  assert.equal(after.results[0].best.status, "fits");
  assert.equal(after.results[0].best.room.id, "room-a");
  assert.equal(
    (
      await post(`/api/drafts/${preview.id}/confirm`, {
        resolveConflict: false,
      })
    ).status,
    400,
  );
  assert.equal(
    (await post(`/api/questions/${q.id}/preview`, { text: "Окна на улицу." }))
      .status,
    404,
  );
  const conflict = await (
    await post("/api/search", {
      ...trip,
      preferences: [pref("courtyard")],
      text: "Тихий номер не нужен.",
    })
  ).json();
  assert.equal(conflict.results.length, 0);
  assert.ok(conflict.conflicts.length);
});
