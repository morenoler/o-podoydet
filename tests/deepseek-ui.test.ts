import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { advisorModeLabel, type AdvisorRun } from "../shared/advisor";
import { executionLabel, LabRunView } from "../src/features/lab/LabRunView";

function run(overrides: Partial<AdvisorRun> = {}): AdvisorRun {
  return {
    id: "synthetic-run", mode: "deepseek", model: "deepseek-flash", status: "completed", execution: "deepseek",
    createdAt: "2026-10-28T18:00:00Z", updatedAt: "2026-10-28T18:00:01Z",
    modelCalls: 2, inputTokens: 40, outputTokens: 10, warnings: [], events: [], diagnostics: [],
    report: { outcome: "clarification_needed", summary: "Нужно уточнение", candidateIds: [], scenarioIds: [], questionId: null, cautions: [], nextSteps: [] },
    context: { searchId: "synthetic-snapshot", trip: { region: "Пусан", checkIn: "2027-06-10", checkOut: "2027-06-17",
      adults: 2, children: 0, preferences: [], scenarios: [], text: "" },
      preferences: [], totalHotels: 0, fitCount: 0, conflicts: [], warnings: [], candidates: [], scenarios: [], questions: [], generatedAt: "2026-10-28T18:00:00Z" },
    ...overrides,
  };
}

test("remote runs are never labelled local or free, including while waiting", () => {
  assert.equal(advisorModeLabel("deepseek"), "DeepSeek API");
  for (const status of ["queued", "running", "completed"] as const) {
    const label = executionLabel(run({ status }));
    assert.match(label, /DeepSeek/);
    assert.doesNotMatch(label, /локальн|бесплат|без языковой модели/i);
  }
  assert.match(executionLabel(run({ execution: "rules_fallback" })), /по правилам/);
  assert.doesNotMatch(executionLabel(run({ status: "failed", execution: undefined })), /Локальный/);
});

test("lab shows remote history and only compares a model run with rules", () => {
  const remote = run();
  const rules = run({ id: "rules", mode: "rules", execution: "rules", modelCalls: 0 });
  const html = renderToStaticMarkup(createElement(LabRunView, { run: remote, counterpart: rules }));
  assert.match(html, /DeepSeek API/);
  assert.match(html, /Контроль по правилам/);
  assert.doesNotMatch(html, /Запуск с локальным ИИ/);
  const twoModels = renderToStaticMarkup(createElement(LabRunView, { run: remote,
    counterpart: run({ id: "old-local", mode: "local", execution: "local" }) }));
  assert.doesNotMatch(twoModels, /Контроль по правилам/);
});
