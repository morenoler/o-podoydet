import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdvisorRun } from "../shared/advisor";
import {
  evidenceAudit,
  selectedReferences,
} from "../src/features/lab/decisionAudit";
import {
  LabDecisionSummary,
  LabStageCheck,
} from "../src/features/lab/LabDecisionAudit";

function fixture(): AdvisorRun {
  const candidate = {
    id: "original-a",
    hotelId: "lab-demo-match",
    hotelName: "Одинаковое имя",
    roomId: "room-a",
    roomName: "Номер",
    score: 1,
    status: "fits" as const,
    criteria: [
      {
        id: "fact-safe",
        feature: "family" as const,
        label: "Семейное размещение",
        required: true,
        status: "match" as const,
        evidenceStatus: "match",
        assumed: false,
        explanation: "Да",
        sources: [],
      },
      {
        id: "fact-risk",
        feature: "courtyard" as const,
        label: "Окна во двор",
        required: false,
        status: "mismatch" as const,
        evidenceStatus: "unknown",
        assumed: true,
        explanation: "Нет данных",
        sources: [],
      },
    ],
  };
  const input = {
    candidates: [
      {
        id: "c1",
        hotelName: candidate.hotelName,
        roomName: "Номер",
        criteria: candidate.criteria.map((item, i) => ({
          ...item,
          id: `e${i + 1}`,
        })),
      },
    ],
  };
  const references = {
    candidates: { c1: candidate.id },
    evidence: {
      e1: [candidate.id, "fact-safe"] as [string, string],
      e2: [candidate.id, "fact-risk"] as [string, string],
    },
    scenarios: {},
    questions: {},
  };
  return {
    id: "run",
    mode: "local",
    status: "completed",
    execution: "rules_fallback",
    createdAt: "2026-10-24T00:00:00Z",
    updatedAt: "2026-10-24T00:00:01Z",
    context: {
      searchId: "snapshot",
      trip: {
        region: "Пусан",
        checkIn: "2026-11-01",
        checkOut: "2026-11-04",
        adults: 2,
        children: 1,
        scenarios: [],
        preferences: [],
        text: "",
      },
      preferences: [],
      totalHotels: 6,
      fitCount: 1,
      conflicts: [],
      warnings: [],
      candidates: [
        candidate,
        { ...candidate, id: "original-b", roomId: "room-b" },
      ],
      testCases: [candidate],
      scenarios: [],
      questions: [],
      generatedAt: "2026-10-24T00:00:00Z",
    },
    report: {
      outcome: "shortlist",
      summary: "Правила",
      candidateIds: [candidate.id],
      scenarioIds: [],
      questionId: null,
      cautions: [{ candidateId: candidate.id, evidenceIds: ["fact-risk"] }],
      nextSteps: [],
    },
    diagnostics: [
      {
        id: "call-1",
        agent: "selector",
        model: "local",
        status: "completed",
        startedAt: "2026-10-24T00:00:00Z",
        input,
        references,
        output: { candidateIds: ["c1"], scenarioIds: [], questionId: null },
      },
      {
        id: "call-2",
        agent: "critic",
        model: "local",
        status: "failed",
        startedAt: "2026-10-24T00:00:01Z",
        input,
        references,
        output: { cautions: { c1: ["e1"] } },
        error: "Пропуск",
      },
    ],
    events: [],
    warnings: [],
    modelCalls: 2,
    inputTokens: 100,
    outputTokens: 20,
  };
}

test("audit separates actual critic mistakes from final guards and resolves IDs not duplicate names", () => {
  const run = fixture();
  assert.equal(selectedReferences(run)[0].candidate?.id, "original-a");
  const [safe, risk] = evidenceAudit(run);
  assert.deepEqual(
    [safe.modelMarked, safe.finalMarked, safe.difference],
    [true, false, "extra"],
  );
  assert.deepEqual(
    [risk.modelMarked, risk.finalMarked, risk.difference],
    [false, true, "missed"],
  );
  const markup = renderToStaticMarkup(
    createElement(LabStageCheck, { run, stage: "critic" }),
  );
  assert.match(markup, /ИИ пропустил предупреждение/);
  assert.match(markup, /ИИ добавил лишнее/);
  assert.match(markup, /В итоговом отчёте/);
});

test("pending critic output does not become a clean audit or a model refusal", () => {
  const run = fixture();
  run.status = "running";
  run.report = null;
  delete run.diagnostics![1].output;
  for (const row of evidenceAudit(run)) {
    assert.equal(row.modelMarked, null);
    assert.equal(row.finalMarked, null);
    assert.equal(row.difference, "pending");
  }
});

test("old diagnostic records remain readable without inventing original ID associations", () => {
  const run = fixture();
  for (const call of run.diagnostics!) delete call.references;
  assert.equal(selectedReferences(run)[0].candidate, undefined);
  assert.ok(evidenceAudit(run).every((row) => row.finalMarked === null));
  run.diagnostics![1].output = {
    cautions: [{ candidateId: "c1", evidenceIds: ["e2"] }],
  };
  assert.equal(evidenceAudit(run)[1].modelMarked, true);
});

test("single-choice and fallback labels do not exaggerate model autonomy", () => {
  const run = fixture();
  const markup = renderToStaticMarkup(
    createElement(LabDecisionSummary, { run }),
  );
  assert.match(markup, /нет выбора между несколькими вариантами/);
  assert.match(markup, /Итоговые рекомендации сформированы правилами/);
  const view = renderToStaticMarkup(
    createElement(LabStageCheck, { run, stage: "java" }),
  );
  assert.match(view, /Допущено к подбору/);
  assert.match(view, /Модель включила в ответ/);
  assert.match(view, /резервный выбор по правилам/);
  run.mode = "rules";
  run.execution = "rules";
  run.modelCalls = 0;
  run.diagnostics = [];
  assert.match(
    renderToStaticMarkup(createElement(LabDecisionSummary, { run })),
    /языковая модель не вызывалась/,
  );
});
