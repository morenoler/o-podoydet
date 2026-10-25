import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Fact } from "../shared/types";
import { FactEvidence } from "../src/features/hotels/components/FactEvidence";

const fact: Fact = {
  id: "fixture-claim",
  hotelId: "account-listing:fixture",
  roomId: "fixture-room",
  feature: "step_free_access",
  value: false,
  source: "Ответ владельца объявления",
  quote: "Перед входом три ступени, пандуса нет.",
  method: "host",
  confidence: "medium",
  confidenceReason: "Сообщил владелец, независимой проверки нет.",
  obtainedAt: "2026-10-25",
  expiresAt: "2027-01-23",
  demo: false,
};

test("owner evidence never inherits OSM or independent-verification labels", () => {
  const html = renderToStaticMarkup(createElement(FactEvidence, { fact }));
  assert.match(html, /Со слов отельера/);
  assert.match(html, /Независимая проверка на месте не проведена/);
  assert.match(html, /Перед входом три ступени, пандуса нет/);
  assert.doesNotMatch(html, /Расчёт по OSM|Официальный источник/);
});

test("demo provenance remains visible even when a host is the alleged source", () => {
  const html = renderToStaticMarkup(
    createElement(FactEvidence, { fact: { ...fact, demo: true } }),
  );
  assert.match(html, /Демонстрация · не влияет на подбор/);
  assert.doesNotMatch(html, /Расчёт по OSM|Со слов отельера/);
});

import type { CriterionDecision, HotelMatch, RoomMatch } from "../shared/types";
import { CatalogClarificationPlan } from "../src/features/clarifications/CatalogClarificationPlan";
import {
  catalogQuestion,
  clarificationItems,
  ownerCanClarify,
} from "../src/features/clarifications/clarificationPresentation";
const unknownCriterion: CriterionDecision = {
  feature: "courtyard",
  required: false,
  status: "mismatch",
  evidenceStatus: "unknown",
  assumed: true,
  decisionBasis: "estimate",
  facts: [],
  explanation: "Нет сведений",
  sourceExplanation: "Нет сведений",
};
const testRoom: RoomMatch = {
  room: {
    id: "room-a",
    name: "Family twin",
    scope: "room_category",
    evidenceStatus: "verified",
    capacity: 3,
    demo: false,
  },
  criteria: [unknownCriterion],
  score: 0,
  status: "fits",
  provisional: true,
};
const testMatch: HotelMatch = {
  hotel: {
    id: "research-hotel",
    name: "Real hotel",
    address: "Пусан",
    coordinates: null,
    osmUrl: "",
    rooms: [testRoom.room],
    route: null,
    noise: [],
  },
  best: testRoom,
  rooms: [testRoom],
  preferences: [{ feature: "courtyard", required: true }],
};

test("catalog plan binds a draft to one category and never offers sending to an unconnected hotel", () => {
  const html = renderToStaticMarkup(
    createElement(CatalogClarificationPlan, {
      match: testMatch,
      room: testRoom,
    }),
  );
  assert.match(html, /Что уточнить до выбора/);
  assert.match(html, /Family twin/);
  assert.match(html, /Обязательно/);
  assert.match(html, /Подготовить вопрос/);
  assert.match(html, /Сервис его не отправляет/);
  assert.doesNotMatch(html, /Отправить вопрос|Вопрос отправлен/);
  assert.match(
    catalogQuestion(testMatch.hotel, testRoom.room, unknownCriterion),
    /Family twin.*Real hotel/,
  );
});

test("only selected conditions are prioritized, with mandatory unknowns ahead of optional ones", () => {
  const room = {
    ...testRoom,
    criteria: [
      unknownCriterion,
      { ...unknownCriterion, feature: "family" as const },
      { ...unknownCriterion, feature: "step_free_access" as const },
    ],
  };
  const items = clarificationItems(room, [
    { feature: "courtyard", required: false },
    { feature: "family", required: true },
  ]);
  assert.deepEqual(
    items.map((item) => item.feature),
    ["family", "courtyard"],
  );
  assert.equal(items[0].required, true);
  assert.equal(
    clarificationItems(
      {
        ...room,
        criteria: [
          { ...unknownCriterion, evidenceStatus: "match", assumed: false },
        ],
      },
      testMatch.preferences!,
    ).length,
    0,
  );
});

test("safety and environmental gaps ask for evidence rather than an owner's assertion", () => {
  for (const feature of [
    "area_safety",
    "clean_air",
    "low_noise",
    "step_free_route",
    "beach_walk",
  ] as const) {
    assert.equal(ownerCanClarify(feature), false);
    const room = { ...testRoom, criteria: [{ ...unknownCriterion, feature }] };
    const html = renderToStaticMarkup(
      createElement(CatalogClarificationPlan, {
        match: { ...testMatch, preferences: [{ feature, required: true }] },
        room,
      }),
    );
    assert.match(html, /Как проверить/);
    assert.doesNotMatch(html, /Подготовить вопрос|Скопировать вопрос/);
  }
});

test("a known mismatch stays a blocker and cannot be cleared by preparing an owner question", () => {
  const room = {
    ...testRoom,
    criteria: [
      {
        ...unknownCriterion,
        evidenceStatus: "mismatch" as const,
        assumed: false,
        sourceExplanation: "Окна выходят на улицу",
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(CatalogClarificationPlan, { match: testMatch, room }),
  );
  assert.match(html, /Есть несоответствие/);
  assert.match(html, /Окна выходят на улицу/);
  assert.doesNotMatch(html, /Подготовить вопрос/);
});

import { MemoryRouter } from "react-router-dom";
import type {
  ListingClarification,
  ClarificationAnswer,
  OwnerStatement,
} from "../shared/clarifications";
import { ClarificationAnswerForm } from "../src/features/clarifications/ClarificationAnswerForm";
import { ClarificationAnswerView } from "../src/features/clarifications/ClarificationsPanel";
import { CriterionLine } from "../src/features/hotels/components/CriterionLine";
import {
  clarificationDate,
  correctableStatements,
  plannedRecheckDate,
} from "../src/features/clarifications/clarificationDates";
const privateQuestion: ListingClarification = {
  scopeChanged: false,
  evidenceStatus: "unknown",
  id: "private-question",
  listingId: "listing-a",
  listingTitle: "Synthetic apartment",
  roomId: "listing-unit-a",
  feature: "step_free_access",
  text: "Можно ли пройти без ступеней?",
  note: "",
  createdAt: "2026-10-25T10:00:00Z",
  status: "open",
  version: 0,
  context: {
    checkIn: "2026-11-01",
    checkOut: "2026-11-05",
    adults: 2,
    children: 1,
  },
  answer: null,
  history: [],
};
const privateAnswer: ClarificationAnswer = {
  id: "answer-a",
  feature: "step_free_access",
  value: false,
  observedOn: null,
  recordedAt: "2026-10-25T10:00:00Z",
  validFrom: null,
  validTo: null,
  recheckAt: "2026-11-23T15:00:00Z",
  scope: "listing_unit",
  scopeId: "listing-a",
  state: "active",
  version: 1,
  text: "Перед входом три ступени, обхода нет.",
  supersedes: [],
};

test("owner answer form defaults to unknown and demands an explicit scoped decision", () => {
  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ClarificationAnswerForm, {
        question: privateQuestion,
        onSubmit: async () => {},
      }),
    ),
  );
  assert.match(html, /checked="" value="unknown"/);
  assert.doesNotMatch(html, /checked="" value="yes"/);
  assert.match(html, /одному варианту из этого объявления/);
  assert.match(html, /Пояснение гостю/);
  assert.match(html, /Проверить ответ/);
  assert.match(html, /min="1" max="90"/);
});

test("editing an answer starts with the actual previous value and text", () => {
  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ClarificationAnswerForm, {
        question: { ...privateQuestion, answer: privateAnswer, version: 1 },
        onSubmit: async () => {},
      }),
    ),
  );
  assert.match(html, /checked="" value="no"/);
  assert.match(html, /Перед входом три ступени, обхода нет/);
});

test("expired contradicting statements remain available for explicit correction", () => {
  const base: OwnerStatement = { ...privateAnswer, value: true };
  const statements: OwnerStatement[] = [
    { ...base, id: "active" },
    { ...base, id: "expired", state: "stale" },
    { ...base, id: "old-scope", state: "scope_changed" },
    { ...base, id: "replaced", state: "superseded" },
    { ...base, id: "other-listing", scopeId: "listing-b" },
    { ...base, id: "other-feature", feature: "family" },
  ];
  assert.deepEqual(
    correctableStatements({
      ...privateQuestion,
      relatedStatements: statements,
    }).map((statement) => statement.id),
    ["active", "expired"],
  );
});

test("deadline dates use Busan midnight and never pretend unknown source dates are verification dates", () => {
  assert.equal(
    clarificationDate("2026-11-23T15:00:00Z"),
    clarificationDate("2026-11-24"),
  );
  assert.equal(
    plannedRecheckDate("2026-09-01", 30, "2026-10-25"),
    "2026-10-01",
  );
  assert.equal(plannedRecheckDate(null, 30, "2026-10-25"), "2026-11-24");
  const html = renderToStaticMarkup(
    createElement(ClarificationAnswerView, { answer: privateAnswer }),
  );
  assert.match(html, /Когда отельер проверял условие — неизвестно/);
  assert.match(html, /24 ноября 2026/);
  assert.match(html, /Независимая проверка не проведена/);
});

test("history retains outdated and changed-scope answers without presenting them as current confirmation", () => {
  for (const [state, label] of [
    ["stale", "Срок перепроверки прошёл"],
    ["scope_changed", "Объявление изменилось"],
    ["superseded", "Сохранено в истории"],
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(ClarificationAnswerView, {
        answer: { ...privateAnswer, state },
      }),
    );
    assert.ok(html.includes(label));
    assert.match(html, /Перед входом три ступени/);
  }
});

test("public criterion shows sanitized owner provenance and conflict without exposing dialogue fields", () => {
  const criterion: CriterionDecision = {
    ...unknownCriterion,
    evidenceStatus: "conflict",
    reportedEvidence: [
      {
        method: "owner_response",
        provenanceStatus: "reported",
        feature: "courtyard",
        value: true,
        evidenceStatus: "conflict",
        scope: "listing_unit",
        scopeId: "listing-a",
        recordedAt: privateAnswer.recordedAt,
        observedOn: null,
        validFrom: null,
        validTo: null,
        recheckAt: privateAnswer.recheckAt,
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(CriterionLine, { criterion, detailed: true }),
  );
  assert.match(html, /Со слов отельера · без независимой проверки/);
  assert.match(html, /Есть противоречащие сведения/);
  assert.match(html, /Дата проверки отельером неизвестна/);
  assert.doesNotMatch(
    html,
    /private-question|listing-a|Перед входом три ступени/,
  );
});

import {
  criterionNeedsClarification,
  matchLabel,
} from "../src/shared/lib/matchPresentation";

test("explicit fresh owner statements close the gap while retaining declared provenance", () => {
  const reported: CriterionDecision = {
    ...unknownCriterion,
    status: "match",
    evidenceStatus: "match",
    reportedEvidence: [
      {
        method: "owner_response",
        provenanceStatus: "reported",
        feature: "courtyard",
        value: true,
        evidenceStatus: "match",
        scope: "listing_unit",
        scopeId: "listing-a",
        recordedAt: privateAnswer.recordedAt,
        observedOn: null,
        validFrom: null,
        validTo: null,
        recheckAt: privateAnswer.recheckAt,
      },
    ],
  };
  assert.equal(criterionNeedsClarification(reported), false);
  assert.equal(
    matchLabel({
      ...testMatch,
      best: { ...testRoom, provisional: false, criteria: [reported] },
    }),
    "Подходит по сведениям отельера",
  );
  for (const evidenceStatus of ["unknown", "stale", "conflict"] as const)
    assert.equal(
      criterionNeedsClarification({ ...reported, evidenceStatus }),
      true,
    );
  assert.equal(
    criterionNeedsClarification({ ...reported, reportedEvidence: undefined }),
    true,
    "legacy assumed profile does not become a verified response",
  );
  assert.equal(
    criterionNeedsClarification({ ...reported, feature: "area_safety" }),
    true,
    "owner cannot close environmental evidence gaps",
  );
  const html = renderToStaticMarkup(
    createElement(CriterionLine, { criterion: reported, detailed: true }),
  );
  assert.match(html, /Со слов отельера · без независимой проверки/);
  assert.doesNotMatch(html, /class="assumption-label"/);
});

import {
  clarificationNeedsAttention,
  clarificationStatusLabel,
} from "../src/features/clarifications/clarificationDates";

test("attention queue retains answered unknown, stale, conflict and changed-scope questions", () => {
  for (const evidenceStatus of ["unknown", "stale", "conflict"] as const)
    assert.equal(
      clarificationNeedsAttention({
        ...privateQuestion,
        status: "answered",
        answer: privateAnswer,
        evidenceStatus,
      }),
      true,
    );
  for (const evidenceStatus of ["match", "mismatch"] as const)
    assert.equal(
      clarificationNeedsAttention({
        ...privateQuestion,
        status: "answered",
        answer: privateAnswer,
        evidenceStatus,
      }),
      false,
    );
  assert.equal(
    clarificationNeedsAttention({
      ...privateQuestion,
      status: "answered",
      evidenceStatus: "match",
      scopeChanged: true,
    }),
    true,
  );
  assert.equal(
    clarificationStatusLabel({
      ...privateQuestion,
      status: "answered",
      evidenceStatus: "conflict",
    }),
    "Есть противоречия",
  );
  assert.equal(
    clarificationStatusLabel({
      ...privateQuestion,
      status: "answered",
      evidenceStatus: "mismatch",
    }),
    "Не подходит по условию",
  );
  assert.equal(
    clarificationStatusLabel({
      ...privateQuestion,
      status: "answered",
      evidenceStatus: "match",
    }),
    "Условие заявлено владельцем",
  );
});

import { CapacitySummary } from "../src/features/hotels/components/CapacitySummary";
import {
  capacityNeedsClarification,
  matchForSelectedPreferences,
} from "../src/shared/lib/matchPresentation";

test("owner capacity is labelled as declared while missing capacity remains unknown", () => {
  const declared: RoomMatch = {
    ...testRoom,
    capacitySource: "owner",
    capacityStatus: "match",
    capacityEvidenceStatus: "match",
    capacityAssumed: true,
    provisional: false,
    criteria: [],
  };
  assert.equal(capacityNeedsClarification(declared), false);
  assert.equal(
    matchLabel({ ...testMatch, best: declared }),
    "Подходит по сведениям отельера",
  );
  const html = renderToStaticMarkup(
    createElement(CapacitySummary, { match: declared }),
  );
  assert.match(html, /Вместимость по объявлению/);
  assert.match(html, /По сведениям отельера: до 3 гостей/);
  assert.doesNotMatch(html, /Вместимость не подтверждена/);
  assert.equal(
    capacityNeedsClarification({
      ...declared,
      capacityEvidenceStatus: "unknown",
    }),
    true,
  );
  assert.equal(
    capacityNeedsClarification({ ...declared, capacitySource: "official" }),
    true,
    "official assumptions keep their existing unknown treatment",
  );
});

test("an old positive response with unknown applicability is not reassigned to the current unit", () => {
  const criterion: CriterionDecision = {
    ...unknownCriterion,
    reportedEvidence: [
      {
        method: "owner_response",
        provenanceStatus: "reported",
        feature: "courtyard",
        value: true,
        evidenceStatus: "unknown",
        scope: "listing_unit",
        scopeId: "listing-a",
        recordedAt: privateAnswer.recordedAt,
        observedOn: null,
        validFrom: null,
        validTo: null,
        recheckAt: privateAnswer.recheckAt,
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(CriterionLine, { criterion, detailed: true }),
  );
  assert.match(
    html,
    /не подтверждает условие для текущего варианта размещения и всех дат поездки/,
  );
  assert.doesNotMatch(html, /Относится к единице размещения в этом объявлении/);
});

import { withClarificationPreference } from "../src/features/clarifications/clarificationPresentation";

test("question importance explicitly updates exactly one preference without altering the rest of the trip", () => {
  const trip: import("../shared/types").Trip = {
    region: "Пусан",
    checkIn: "2026-11-01",
    checkOut: "2026-11-05",
    adults: 2,
    children: 1,
    scenarios: ["family"],
    admissionMode: "verified",
    text: "Original private search text",
    preferences: [
      { feature: "clean_air", required: true },
      { feature: "courtyard", required: false },
    ],
  };
  const original = structuredClone(trip);
  const changed = withClarificationPreference(trip, "courtyard", true);
  assert.deepEqual(changed, {
    ...trip,
    preferences: [
      { feature: "clean_air", required: true },
      { feature: "courtyard", required: true },
    ],
  });
  assert.deepEqual(trip, original);
  const added = withClarificationPreference(changed, "step_free_access", false);
  assert.equal(
    added.preferences.filter(
      (preference) => preference.feature === "step_free_access",
    ).length,
    1,
  );
  assert.deepEqual(added.preferences.slice(0, 2), changed.preferences);
  assert.deepEqual(
    withClarificationPreference(added, "step_free_access", true).preferences.at(
      -1,
    ),
    { feature: "step_free_access", required: true },
  );
});

test("detail badge evaluates selected conditions and preserves reference evidence and admission", () => {
  const selected: CriterionDecision = {
    ...unknownCriterion,
    feature: "step_free_access",
    status: "match",
    evidenceStatus: "match",
    assumed: false,
  };
  const evaluated: HotelMatch = {
    ...testMatch,
    best: {
      ...testRoom,
      provisional: false,
      capacitySource: "owner",
      capacityEvidenceStatus: "match",
      criteria: [selected, unknownCriterion],
    },
  };
  const display = matchForSelectedPreferences(evaluated, [
    { feature: "step_free_access", required: true },
  ]);
  assert.equal(matchLabel(display), "Подходит по сведениям отельера");
  assert.equal(display.best.status, evaluated.best.status);
  assert.equal(
    evaluated.best.criteria.length,
    2,
    "all reference conditions remain available in the detail",
  );
  assert.deepEqual(display.best.criteria, [selected]);
  const otherRoom = {
    ...evaluated.best,
    status: "excluded" as const,
    capacityEvidenceStatus: "mismatch" as const,
  };
  assert.equal(
    matchLabel(matchForSelectedPreferences(evaluated, [], otherRoom)),
    "Не подходит под фильтры",
  );
});
