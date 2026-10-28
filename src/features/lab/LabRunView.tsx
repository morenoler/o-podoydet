import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  ClipboardList,
  Code2,
  Download,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import type { AdvisorRun } from "../../../shared/advisor";
import { advisorModeLabel } from "../../../shared/advisor";
import { AdvisorReportView } from "../advisor/AdvisorReportView";
import { advisorIsActive } from "../advisor/useAdvisor";
import { LabDecisionSummary, LabStageCheck } from "./LabDecisionAudit";

export function executionLabel(run: AdvisorRun) {
  if (run.mode !== "rules" && advisorIsActive(run))
    return run.status === "queued"
      ? `${advisorModeLabel(run.mode)} ожидает запуска`
      : `${advisorModeLabel(run.mode)} выполняется · ожидаем результат`;
  if (run.execution === "rules_fallback")
    return "ИИ не завершил работу · результат по правилам";
  if (run.execution === "local" || run.execution === "deepseek")
    return `${advisorModeLabel(run.execution)}${run.model ? ` · ${run.model}` : ""}`;
  if (run.execution === "rules" || run.mode === "rules")
    return "Правила · без языковой модели";
  return advisorIsActive(run)
    ? `Запрошен ${advisorModeLabel(run.mode)} · ожидаем результат`
    : "Исполнение ИИ не подтверждено";
}

const stages = [
  { id: "input", title: "Ваша поездка", kind: "Вход", Icon: ClipboardList },
  {
    id: "java",
    title: "Условия и кандидаты",
    kind: "Java · правила",
    Icon: SlidersHorizontal,
  },
  { id: "needs", title: "Разбор задачи", kind: "Агент · правила", Icon: Code2 },
  { id: "selector", title: "Выбор вариантов", kind: "Агент отбора", Icon: Bot },
  {
    id: "critic",
    title: "Проверка оснований",
    kind: "Агент проверки",
    Icon: ShieldCheck,
  },
  {
    id: "result",
    title: "Итог и защита",
    kind: "Координатор · правила",
    Icon: Check,
  },
] as const;
type Stage = (typeof stages)[number]["id"];

function JsonDetails({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="lab-json">
      <summary>{label}</summary>
      <pre tabIndex={0}>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function Comparison({
  run,
  counterpart,
}: {
  run: AdvisorRun;
  counterpart?: AdvisorRun;
}) {
  if (!counterpart || (run.mode === "rules") === (counterpart.mode === "rules")) return null;
  const local = run.mode !== "rules" ? run : counterpart;
  const rules = run.mode === "rules" ? run : counterpart;
  return (
    <section className="lab-comparison">
      <div className="lab-section-heading">
        <h3>Один подбор, два способа выбора</h3>
        <span>Снимок {run.context.searchId.slice(0, 8)}</span>
      </div>
      <p className="lab-muted">
        Одинаковые исходные условия и кандидаты. Сравниваются фактические
        ответы.
      </p>
      {local.status === "completed" && rules.status === "completed" && (
        <p className="lab-audit-note">
          {local.execution !== "local" && local.execution !== "deepseek"
            ? "ИИ-ответ не принят: здесь сопоставлены резервный результат и контроль по правилам. Исходная попытка модели видна в её этапах."
            : JSON.stringify(local.report?.candidateIds) ===
                JSON.stringify(rules.report?.candidateIds)
              ? "Выбор и порядок вариантов совпали. Это не доказывает преимущество ИИ; факт его работы подтверждают два сохранённых модельных вызова."
              : "Выбор или порядок вариантов различаются. Сверьте списки и предупреждения: отличие само по себе не означает улучшение."}
        </p>
      )}
      <div className="lab-comparison-columns">
        {[local, rules].map((item) => (
          <article key={item.id}>
            <h4>
              {item.mode !== "rules"
                ? `Запуск с ${advisorModeLabel(item.mode)}`
                : "Контроль по правилам"}
            </h4>
            <p className="lab-muted">{executionLabel(item)}</p>
            <dl>
              <div>
                <dt>Кандидаты в отчёте</dt>
                <dd>{item.report?.candidateIds.length ?? "—"}</dd>
              </div>
              <div>
                <dt>Замечания проверяющего</dt>
                <dd>
                  {item.report?.cautions.reduce(
                    (sum, caution) => sum + caution.evidenceIds.length,
                    0,
                  ) ?? "—"}
                </dd>
              </div>
              <div>
                <dt>Вызовы модели</dt>
                <dd>{item.modelCalls}</dd>
              </div>
            </dl>
            <ul>
              {item.report?.candidateIds.map((id) => {
                const candidate = item.context.candidates.find(
                  (value) => value.id === id,
                );
                return (
                  <li key={id}>
                    {candidate
                      ? `${candidate.hotelName} · ${candidate.roomName}`
                      : id}
                  </li>
                );
              })}
            </ul>
            {!item.report && <p>Отчёт ещё не готов.</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

export function LabRunView({
  run,
  counterpart,
}: {
  run: AdvisorRun;
  counterpart?: AdvisorRun;
}) {
  const [stage, setStage] = useState<Stage>("java");
  const [note, setNote] = useState("");
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    try {
      setNote(localStorage.getItem(`o-lab-note-${run.id}`) || "");
      setStorageError("");
    } catch {
      setNote("");
    }
  }, [run.id]);
  const diagnostic = run.diagnostics?.find((item) => item.agent === stage);
  const event = [...run.events]
    .reverse()
    .find(
      (item) => item.agent === (stage === "result" ? "coordinator" : stage),
    );
  const actualModel = diagnostic
    ? "Локальная модель"
    : stage === "selector" || stage === "critic"
      ? run.mode === "rules" ||
        (!advisorIsActive(run) &&
          (run.execution === "rules" || run.execution === "rules_fallback"))
        ? "Правила"
        : "Вызов модели ещё не зафиксирован"
      : "Детерминированная обработка";
  const input =
    stage === "input"
      ? run.context.trip
      : stage === "java"
        ? { trip: run.context.trip, preferences: run.context.preferences }
        : (diagnostic?.input ??
          (stage === "needs"
            ? {
                preferences: run.context.preferences,
                conflicts: run.context.conflicts,
                questions: run.context.questions,
              }
            : run.context));
  const output =
    stage === "input"
      ? undefined
      : stage === "java"
        ? {
            fitCount: run.context.fitCount,
            totalHotels: run.context.totalHotels,
            candidates: run.context.candidates,
            scenarios: run.context.scenarios,
          }
        : diagnostic
          ? diagnostic.output
          : stage === "result"
            ? run.report
            : stage === "needs"
              ? event?.detail
              : stage === "selector" && run.report
                ? {
                    candidateIds: run.report.candidateIds,
                    scenarioIds: run.report.scenarioIds,
                    questionId: run.report.questionId,
                  }
                : stage === "critic" && run.report
                  ? run.report.cautions
                  : undefined;
  const fallback = run.execution === "rules_fallback";

  function saveNote(value: string) {
    setNote(value);
    try {
      localStorage.setItem(`o-lab-note-${run.id}`, value);
      setStorageError("");
    } catch {
      setStorageError(
        "Браузер не разрешил сохранить заметку. Она попадёт в экспорт текущего запуска.",
      );
    }
  }
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            run,
            comparison: counterpart || null,
            feedback: note,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `o-podoydet-lab-${run.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="lab-run-view">
      <div className="lab-run-heading">
        <div>
          <h2>Путь от пожелания к ответу</h2>
          <p className="lab-muted">{executionLabel(run)}</p>
          <p className="lab-muted">
            Снимок подбора:{" "}
            {new Date(run.context.generatedAt).toLocaleString("ru-RU")}.
            Изменения формы применятся к новому запуску.
          </p>
        </div>
        <span className={`lab-status lab-status-${run.status}`} role="status">
          {
            {
              queued: "В очереди",
              running: "Выполняется",
              completed: "Завершён",
              failed: "Ошибка",
              cancelled: "Остановлен",
            }[run.status]
          }
        </span>
      </div>
      {fallback && (
        <div className="lab-fallback" role="status">
          <strong>Это ответ по правилам, а не успешный ответ ИИ.</strong>
          <p>
            Локальная модель не завершила обработку. Проверьте события и ошибки
            ниже перед оценкой качества.
          </p>
        </div>
      )}
      {run.error && (
        <p className="notice error" role="alert">
          {run.error}
        </p>
      )}
      <LabDecisionSummary run={run} />
      <ol className="lab-pipeline">
        {stages.map(({ id, title, kind, Icon }, index) => {
          const item = run.diagnostics?.find((value) => value.agent === id);
          const step = [...run.events]
            .reverse()
            .find(
              (value) => value.agent === (id === "result" ? "coordinator" : id),
            );
          const state =
            id === "input" || id === "java"
              ? "completed"
              : id === "result"
                ? run.status === "completed" && run.report
                  ? "completed"
                  : advisorIsActive(run)
                    ? run.report
                      ? "running"
                      : "waiting"
                    : run.status === "failed"
                      ? "failed"
                      : "skipped"
                : item?.status ||
                  step?.status ||
                  (advisorIsActive(run) ? "waiting" : "skipped");
          return (
            <li key={id}>
              <button
                type="button"
                className={`lab-stage ${stage === id ? "selected" : ""}`}
                onClick={() => setStage(id)}
                aria-pressed={stage === id}
              >
                <Icon size={19} aria-hidden="true" />
                <strong>{title}</strong>
                <small>
                  {(id === "selector" || id === "critic") &&
                  (run.mode === "rules" ||
                    (!advisorIsActive(run) && run.execution === "rules"))
                    ? "Агент · правила"
                    : kind}
                </small>
                <span className={`lab-stage-status ${state}`}>
                  {state === "completed"
                    ? "Готово"
                    : state === "failed"
                      ? "Ошибка"
                      : state === "warning"
                        ? "Ограничение"
                        : state === "running" && advisorIsActive(run)
                          ? "В работе"
                          : state === "skipped"
                            ? "Не запускался"
                            : state === "running"
                              ? "Остановлен"
                              : "Ожидает"}
                </span>
              </button>
              {index < stages.length - 1 && (
                <ArrowRight
                  size={14}
                  className="lab-stage-arrow"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
      <section className="lab-inspector" aria-label="Данные выбранного этапа">
        <div className="lab-section-heading">
          <h3>{stages.find((item) => item.id === stage)?.title}</h3>
          <span>{actualModel}</span>
        </div>
        <p>
          {event?.detail ||
            (stage === "input"
              ? "Параметры поездки переданы без изменения обязательных условий."
              : stage === "java"
                ? `Из ${run.context.totalHotels} объектов текущие условия прошли ${run.context.fitCount}. Модель выбирает только из подготовленных кандидатов.`
                : "Выберите завершённый этап, чтобы увидеть его фактический результат.")}
        </p>
        {diagnostic && (
          <div className="lab-call-metrics">
            <span>
              Модель: <strong>{diagnostic.model}</strong>
            </span>
            <span>
              Время:{" "}
              <strong>
                {diagnostic.durationMs === undefined
                  ? "ещё не измерено"
                  : `${(diagnostic.durationMs / 1000).toFixed(1)} с`}
              </strong>
            </span>
            <span>
              Токены:{" "}
              <strong>
                {diagnostic.inputTokens ?? "—"} /{" "}
                {diagnostic.outputTokens ?? "—"}
              </strong>
            </span>
          </div>
        )}
        {diagnostic?.error && (
          <p className="notice error">{diagnostic.error}</p>
        )}
        <LabStageCheck stage={stage} run={run} />
        <JsonDetails label="Входные данные этапа" value={input} />
        {output !== undefined && output !== null && (
          <JsonDetails label="Полученный результат" value={output} />
        )}
        <p className="lab-inspector-note">
          Здесь только входы, выходы и события инструментов. Скрытые рассуждения
          модели не отображаются.
        </p>
      </section>
      <Comparison run={run} counterpart={counterpart} />
      {run.report && run.status === "completed" && (
        <details className="lab-report">
          <summary>Ответ, который увидит пользователь</summary>
          <AdvisorReportView run={run} />
        </details>
      )}
      <details className="lab-events">
        <summary>События и ограничения · {run.events.length}</summary>
        <ol>
          {run.events.map((item, index) => (
            <li key={index}>
              <span>
                {new Date(item.at).toLocaleTimeString("ru-RU")} · {item.agent}
              </span>
              <p>{item.detail}</p>
            </li>
          ))}
        </ol>
        {run.warnings.map((warning, index) => (
          <p key={index} className="lab-muted">
            {warning}
          </p>
        ))}
      </details>
      <section className="lab-feedback">
        <label className="field">
          <span>Что исправить в этом запуске</span>
          <textarea
            rows={3}
            value={note}
            maxLength={6000}
            onChange={(event) => saveNote(event.target.value)}
            placeholder="Например: не хватает объяснения, почему выбран этот номер"
          />
        </label>
        <div>
          <p className="lab-muted">
            Заметка хранится в этом браузере. Экспорт содержит диагностику и ваш
            отзыв, никуда их не отправляет.
          </p>
          <button type="button" className="button secondary" onClick={download}>
            <Download size={16} aria-hidden="true" />
            Скачать диагностику
          </button>
        </div>
        {storageError && <p role="status">{storageError}</p>}
      </section>
    </div>
  );
}
