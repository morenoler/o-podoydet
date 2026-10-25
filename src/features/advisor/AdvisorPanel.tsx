import { useState } from "react";
import { Bot, Play, RefreshCw, Square } from "lucide-react";
import type { AdvisorMode, AdvisorStatus } from "../../../shared/advisor";
import type { Trip } from "../../../shared/types";
import { ErrorMessage } from "../../shared/ui/Feedback";
import { advisorIsActive, useAdvisor } from "./useAdvisor";
import { AdvisorReportView } from "./AdvisorReportView";
import "./advisor.css";

const stages = [
  { id: "needs", name: "Пожелания" },
  { id: "selector", name: "Отбор вариантов" },
  { id: "critic", name: "Проверка оснований" },
  { id: "coordinator", name: "Вывод и следующий шаг" },
] as const;
const statuses: Record<AdvisorStatus, string> = {
  queued: "В очереди",
  running: "Разбираемся в вариантах",
  completed: "Разбор готов",
  failed: "Не удалось закончить разбор",
  cancelled: "Разбор остановлен",
};

export function AdvisorPanel({
  trip,
  searchId,
  noMatches,
  needsClarification,
  onRefreshSearch,
}: {
  trip: Trip;
  searchId?: string;
  noMatches: boolean;
  needsClarification: boolean;
  onRefreshSearch: () => void;
}) {
  const advisor = useAdvisor(trip, searchId);
  const [mode, setMode] = useState<AdvisorMode>("rules");
  const active = advisorIsActive(advisor.run);
  const { run } = advisor;

  return (
    <section className="advisor-panel" aria-labelledby="advisor-heading">
      <div className="advisor-heading">
        <span className="advisor-icon">
          <Bot size={25} aria-hidden="true" />
        </span>
        <div>
          <p className="advisor-eyebrow">Помощник по выбору · бесплатно</p>
          <h2 id="advisor-heading">
            {needsClarification
              ? "Разберёмся в пожеланиях"
              : noMatches
                ? "Разберёмся, почему ничего не подошло"
                : "Поможем выбрать среди вариантов"}
          </h2>
          <p className="advisor-muted">
            Агенты разберут пожелания, сравнят категории и проверят ограничения.
            Обязательные условия меняете только вы.
          </p>
        </div>
      </div>
      {!run && (
        <p className="advisor-intro">
          {needsClarification
            ? "Поможем найти противоречие в пожеланиях и выбрать, что уточнить первым."
            : noMatches
              ? "Покажем, какие условия исключили варианты, где не хватает данных и что стоит уточнить первым."
              : "Выделим до трёх вариантов и объясним, на какие подтверждения и предположения стоит обратить внимание."}
        </p>
      )}
      <div className="advisor-controls">
        <label className="field">
          <span>Как выполнить разбор</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as AdvisorMode)}
            disabled={active || !!advisor.busy || advisor.loading}
          >
            {(advisor.config?.modes || ["rules"]).map((item) => (
              <option key={item} value={item}>
                {item === "rules"
                  ? "По правилам · без модели и API"
                  : "Локальная модель · без платы за API"}
              </option>
            ))}
          </select>
        </label>
        {!active && searchId && (
          <button
            type="button"
            className="button primary"
            disabled={!advisor.config || !!advisor.busy || advisor.loading}
            onClick={() => void advisor.start(mode)}
          >
            <Play size={16} aria-hidden="true" />
            {advisor.busy === "start"
              ? "Запускаем…"
              : run
                ? "Разобрать ещё раз"
                : noMatches
                  ? "Разобраться в причинах"
                  : "Помочь с выбором"}
          </button>
        )}
        {active && (
          <button
            type="button"
            className="button secondary"
            disabled={!!advisor.busy}
            onClick={() => void advisor.cancel()}
          >
            <Square size={14} aria-hidden="true" />
            {advisor.busy === "cancel" ? "Останавливаем…" : "Остановить разбор"}
          </button>
        )}
      </div>
      {!searchId && (
        <div className="advisor-error">
          <p className="advisor-muted">
            Для разбора нужен свежий результат подбора. Обновите поиск, чтобы
            помощник использовал те же данные, что и выдача.
          </p>
          <button
            type="button"
            className="button secondary"
            onClick={onRefreshSearch}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Обновить подбор
          </button>
        </div>
      )}
      {advisor.loading && (
        <p role="status" className="advisor-muted">
          Подключаем помощника…
        </p>
      )}
      {advisor.error && (
        <div className="advisor-error">
          <ErrorMessage text={advisor.error} />
          <button
            type="button"
            className="button secondary"
            onClick={advisor.reload}
            disabled={advisor.loading || !!advisor.busy}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Обновить состояние
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={onRefreshSearch}
            disabled={!!advisor.busy}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Повторить подбор со свежими данными
          </button>
        </div>
      )}
      {run && (
        <>
          <p className="advisor-run-status" role="status" aria-atomic="true">
            {statuses[run.status]} ·{" "}
            {run.mode === "local" && active
              ? run.status === "queued"
                ? "локальный ИИ ожидает запуска"
                : "локальный ИИ выполняется"
              : run.execution === "rules_fallback"
                ? "резервный ответ по правилам, ИИ не завершил работу"
                : run.execution === "local"
                  ? "локальная модель"
                  : run.mode === "rules" || run.execution === "rules"
                    ? "без модели"
                    : "локальный ИИ запрошен, исполнение ещё не подтверждено"}
          </p>
          <ol className="advisor-stages" aria-label="Работа агентов">
            {stages.map((stage) => {
              const event = [...run.events]
                .reverse()
                .find((item) => item.agent === stage.id);
              const state =
                stage.id === "coordinator"
                  ? run.status === "completed" && run.report
                    ? "completed"
                    : active
                      ? "waiting"
                      : "stopped"
                  : event?.status || (active ? "waiting" : "skipped");
              const label =
                state === "completed"
                  ? "Выполнено"
                  : state === "warning"
                    ? "Есть ограничения"
                    : state === "running" && active
                      ? "В работе"
                      : state === "stopped" || state === "running"
                        ? "Остановлено"
                        : state === "skipped"
                          ? "Не запускался"
                          : "Ожидает";
              return (
                <li
                  className={`advisor-stage advisor-stage-${state}`}
                  key={stage.id}
                >
                  <strong>{stage.name}</strong>
                  <span>{label}</span>
                </li>
              );
            })}
          </ol>
          {run.error && <ErrorMessage text={run.error} />}
          {run.warnings.length > 0 && (
            <div className="advisor-warnings">
              <h3>Ограничения разбора</h3>
              <ul>
                {run.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          {run.status === "completed" && run.report && (
            <AdvisorReportView run={run} />
          )}
          <details className="advisor-disclosure">
            <summary>Как агенты пришли к выводу</summary>
            <ol className="advisor-log">
              {run.events.map((event, index) => (
                <li key={index}>
                  <strong>
                    {stages.find((stage) => stage.id === event.agent)?.name}
                  </strong>
                  <p>{event.detail}</p>
                </li>
              ))}
            </ol>
            <p className="advisor-footnote">
              Вызовов модели: {run.modelCalls}. Входных токенов:{" "}
              {run.inputTokens}, выходных: {run.outputTokens}.
            </p>
          </details>
        </>
      )}
      {advisor.config && !advisor.config.modes.includes("local") && (
        <details className="advisor-setup">
          <summary>Бесплатная локальная модель</summary>
          <p>
            Разбор по правилам уже доступен без установки модели. Для локального
            ИИ установите Ollama, загрузите модель и укажите её имя в{" "}
            <code>ADVISOR_LOCAL_MODEL</code> файла <code>.env</code>. После
            перезапуска Java-сервера появится второй режим. Внешние платные API
            помощник не использует.
          </p>
        </details>
      )}
    </section>
  );
}
