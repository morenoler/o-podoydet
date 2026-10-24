import { useState } from "react";
import type { AdvisorRun } from "../../../shared/advisor";
import {
  evidenceAudit,
  modelCandidates,
  record,
  selectedReferences,
  strings,
} from "./decisionAudit";

const evidenceLabels: Record<string, string> = {
  match: "подтверждено",
  mismatch: "не соответствует",
  unknown: "данных нет",
  stale: "сведения устарели",
  conflict: "источники противоречат",
};
const yesNo = (value: boolean | null) =>
  value === null ? "Нет результата" : value ? "Да" : "Нет";

export function LabDecisionSummary({ run }: { run: AdvisorRun }) {
  const selector = run.diagnostics?.find((item) => item.agent === "selector");
  const pool = modelCandidates(selector);
  const audit = evidenceAudit(run);
  return (
    <section className="lab-decision-summary" aria-label="Вклад правил и ИИ">
      <h3>Кто принял решение в этом запуске</h3>
      <dl>
        <div>
          <dt>Правила допустили</dt>
          <dd>
            {run.context.fitCount} из {run.context.totalHotels} объектов
          </dd>
        </div>
        <div>
          <dt>Вариантов у агента отбора</dt>
          <dd>{selector ? pool.length : "—"}</dd>
        </div>
        <div>
          <dt>Реальные попытки вызова модели</dt>
          <dd>{run.modelCalls} из 2</dd>
        </div>
      </dl>
      {pool.length === 1 && (
        <p className="lab-audit-note">
          <strong>Здесь нет выбора между несколькими вариантами.</strong>{" "}
          Правила оставили в пуле один вариант. ИИ получает его на отбор и
          проверку; признал его подходящим код подбора.
        </p>
      )}
      {pool.length > 1 && (
        <p>
          Правила подготовили и отсортировали пул. ИИ может выбрать до трёх
          вариантов и их порядок внутри этого пула. Он не может вернуть
          исключённый вариант как подходящий.
        </p>
      )}
      {run.report?.outcome === "no_matches" && (
        <p>
          Подходящих объектов нет. Переданные модели кандидаты — исключённые
          альтернативы для разбора причин. Их статус ИИ не меняет.
        </p>
      )}
      {!!audit.length &&
        (audit.some((row) => row.difference === "pending") ? (
          <p>Критик ещё не вернул ответ. Сверка предупреждений не завершена.</p>
        ) : (
          <p>
            Проверка критика по исходным данным: пропущено предупреждений —{" "}
            <strong>
              {audit.filter((row) => row.difference === "missed").length}
            </strong>
            , добавлено лишних —{" "}
            <strong>
              {audit.filter((row) => row.difference === "extra").length}
            </strong>
            . Подробности — на этапе «Проверка оснований».
          </p>
        ))}
      {run.execution === "rules_fallback" && (
        <p className="notice error">
          Ответ модели не принят. Итоговые рекомендации сформированы правилами;
          фактическая попытка ИИ доступна ниже.
        </p>
      )}
      {run.modelCalls === 0 && run.status === "completed" && (
        <p>
          В этом запуске языковая модель не вызывалась. Все решения принял код.
        </p>
      )}
    </section>
  );
}

function TestCaseDecision({ run }: { run: AdvisorRun }) {
  const cases = run.context.testCases;
  const [selected, setSelected] = useState("");
  const item =
    cases?.find((candidate) => candidate.id === selected) || cases?.[0];
  const selector = run.diagnostics?.find((call) => call.agent === "selector");
  if (!item)
    return (
      <p>
        В этом снимке нет полного разбора тестовых объявлений. Запустите один из
        экспериментов сверху: история старых запусков не пересчитывается задним
        числом.
      </p>
    );
  const alias = modelCandidates(selector)
    .map((candidate) => String(candidate.id))
    .find((id) => selector?.references?.candidates[id] === item.id);
  const output = record(selector?.output);
  const hasSelection = Array.isArray(output.candidateIds);
  const rawChosen =
    alias && hasSelection ? strings(output.candidateIds).includes(alias) : null;
  const finalChosen =
    run.status === "completed" && run.report
      ? run.report.candidateIds.includes(item.id)
      : null;
  return (
    <div className="lab-case-audit">
      <label className="field">
        <span>Проверьте конкретное тестовое объявление</span>
        <select
          value={item.id}
          onChange={(event) => setSelected(event.target.value)}
        >
          {cases?.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.hotelName}
            </option>
          ))}
        </select>
      </label>
      <div className="lab-decision-columns">
        <article>
          <span className="lab-owner">1 · Правила Java</span>
          <h4>
            {item.status === "fits"
              ? "Допущено к подбору"
              : "Исключено из подбора"}
          </h4>
          <ul>
            {item.criteria.map((criterion) => (
              <li key={criterion.id}>
                <strong>{criterion.label}</strong>:{" "}
                {criterion.status === "match"
                  ? "фильтр выполнен"
                  : "фильтр не выполнен"}
                ;{" "}
                {evidenceLabels[criterion.evidenceStatus] ||
                  criterion.evidenceStatus}
                {criterion.assumed ? ", есть предположение" : ""}
                {criterion.required ? ", обязательно" : ", желательно"}.
              </li>
            ))}
          </ul>
          <p>ИИ не вычисляет эти статусы и не меняет обязательность условий.</p>
        </article>
        <article>
          <span className="lab-owner lab-owner-model">2 · Ответ ИИ</span>
          <h4>
            {!selector
              ? "Модель ещё не вызывалась"
              : !selector.references
                ? "Старый запуск без связей ID"
                : !alias
                  ? "Не передано модели"
                  : rawChosen === null
                    ? "Ответ ещё не получен"
                    : rawChosen
                      ? "Модель включила в ответ"
                      : "Модель не включила в ответ"}
          </h4>
          <p>
            {alias
              ? `Входной идентификатор модели: ${alias}. Смотрите исходный выбор на этапе «Выбор вариантов».`
              : "Пул модели ограничен правилами и лимитом кандидатов. Отсутствие в пуле не является отказом ИИ."}
          </p>
          {rawChosen && run.execution === "rules_fallback" && (
            <p>
              Это попытка выбора. После ошибки проверки итог пересчитан
              правилами.
            </p>
          )}
        </article>
        <article>
          <span className="lab-owner">3 · Итог после проверки</span>
          <h4>
            {finalChosen === null
              ? "Итог ещё не готов"
              : finalChosen
                ? item.status === "excluded"
                  ? "Показано как исключённая альтернатива"
                  : "В итоговом списке"
                : "В итоговый список не включено"}
          </h4>
          <p>
            {run.status !== "completed"
              ? "Проверка ещё не дала окончательного результата."
              : !alias && selector?.references
                ? "Этот вариант не передавался модели. Его отсутствие в итоговом списке следует из правил подготовки пула, а не решения ИИ."
                : run.execution === "local"
                  ? "Принят выбор модели. Ограничения, предупреждения и текст отчёта проверены или сформированы кодом."
                  : run.execution === "rules_fallback"
                    ? "Использован резервный выбор по правилам."
                    : "При запуске без модели выбор и отчёт формирует код."}
          </p>
        </article>
      </div>
    </div>
  );
}

function SelectorDecision({ run }: { run: AdvisorRun }) {
  const call = run.diagnostics?.find((item) => item.agent === "selector");
  if (!call)
    return (
      <p>
        Модель отбора не вызывалась. Выбор в режиме правил не является ответом
        ИИ.
      </p>
    );
  const selected = selectedReferences(run);
  const output = record(call.output);
  const scenarioIds = strings(output.scenarioIds);
  const questionId =
    typeof output.questionId === "string"
      ? call.references?.questions[output.questionId]
      : undefined;
  return (
    <div className="lab-readable-output">
      <h4>Что фактически вернула модель</h4>
      {!call.references && (
        <p>
          Этот старый запуск не сохранял соответствия коротких ID. Для
          расшифровки названий запустите эксперимент заново; исходный JSON
          доступен ниже.
        </p>
      )}
      {Array.isArray(output.candidateIds) ? (
        <ol>
          {selected.map((item, index) => (
            <li key={`${item.alias}-${index}`}>
              {item.candidate
                ? `${item.candidate.hotelName} · ${item.candidate.roomName}`
                : `Не сопоставленная ссылка ${item.alias}`}
            </li>
          ))}
        </ol>
      ) : (
        <p>Структурированный выбор пока не получен.</p>
      )}
      <p>
        Сценарии:{" "}
        {scenarioIds.length
          ? scenarioIds
              .map(
                (alias) =>
                  run.context.scenarios.find(
                    (item) => item.id === call.references?.scenarios[alias],
                  )?.label || alias,
              )
              .join("; ")
          : "не выбраны"}
        .
      </p>
      <p>
        Вопрос модели:{" "}
        {run.context.questions.find((item) => item.id === questionId)?.text ||
          (output.questionId === null
            ? "не выбран (null)"
            : "ещё не получен или ссылка не распознана")}
        .
      </p>
      {output.questionId === null && run.report?.questionId && (
        <p className="lab-audit-note">
          Итоговый вопрос добавили правила:{" "}
          {
            run.context.questions.find(
              (item) => item.id === run.report?.questionId,
            )?.text
          }
        </p>
      )}
      <p>
        Модель возвращает ссылки на готовые варианты. Названия, объяснения
        свойств и текст итогового отчёта берутся из данных и шаблонов.
        Собственного текстового объяснения выбора этот агент не генерирует.
      </p>
    </div>
  );
}

function CriticDecision({ run }: { run: AdvisorRun }) {
  const rows = evidenceAudit(run);
  if (!rows.length)
    return (
      <p>
        Нет входных данных модельного критика. Предупреждения в отчёте по
        правилам не означают, что их нашёл ИИ.
      </p>
    );
  return (
    <div className="lab-critic-audit">
      <h4>Сверка каждого условия с ответом критика</h4>
      <p>
        Предупреждение нужно при предположении, несовпадении или
        неподтверждённом источнике. Это правило проверки. Колонка «ИИ отметил»
        берётся из настоящего ответа модели.
      </p>
      {rows.map((row) => (
        <article
          key={row.key}
          className={`lab-evidence-check lab-evidence-${row.difference}`}
        >
          <h4>
            {row.candidateName} · {row.label}
          </h4>
          <p>
            {evidenceLabels[row.status] || row.status}
            {row.assumed ? " · предположение" : ""}
            {row.required ? " · обязательное условие" : ""}
          </p>
          <dl>
            <div>
              <dt>Нужно по правилу</dt>
              <dd>{yesNo(row.needsWarning)}</dd>
            </div>
            <div>
              <dt>ИИ отметил</dt>
              <dd>{yesNo(row.modelMarked)}</dd>
            </div>
            <div>
              <dt>В итоговом отчёте</dt>
              <dd>{yesNo(row.finalMarked)}</dd>
            </div>
          </dl>
          <strong>
            {row.difference === "missed"
              ? "ИИ пропустил предупреждение: ответ нельзя принять."
              : row.difference === "extra"
                ? "ИИ добавил лишнее: программная проверка убирает это замечание."
                : row.difference === "pending"
                  ? "Ожидаем фактический ответ ИИ."
                  : "Ответ ИИ совпал с проверкой этого условия."}
          </strong>
        </article>
      ))}
    </div>
  );
}

export function LabStageCheck({
  stage,
  run,
}: {
  stage: string;
  run: AdvisorRun;
}) {
  const guidance: Record<string, { task: string; check: string }> = {
    input: {
      task: "Пользователь задаёт даты, гостей и обязательные пожелания.",
      check:
        "Сверьте сохранённые входные данные с формой. Изменение формы не переписывает уже выполненный запуск.",
    },
    java: {
      task: "Java проверяет вместимость, факты и обязательные условия. Вычисляет допуск, количество вариантов и сценарии изменения пожеланий.",
      check:
        "Выберите каждое из шести объявлений. Для трёх гостей номер на двоих должен быть исключён до ИИ; неполные и противоречивые сведения должны оставаться видимыми.",
    },
    needs: {
      task: "Агент потребностей работает по правилам: обрабатывает противоречия и подготавливает уточнения. Это не отдельный вызов ИИ.",
      check:
        "Запустите «Конфликт пожеланий». Должно появиться уточнение, рекомендаций и модельных вызовов быть не должно.",
    },
    selector: {
      task: "Агент отбора — первый вызов модели. Выбирает до трёх вариантов, сценарии и вопрос из подготовленного пула.",
      check:
        "В эксперименте с несколькими вариантами сравните входной пул и полученный список. Затем выполните «Сравнить с правилами» на том же снимке. Совпадение списков означает совпадение результата, а не отсутствие вызова модели.",
    },
    critic: {
      task: "Агент-критик — второй, отдельный вызов той же модели. Получает выбранные варианты и указывает условия, требующие предупреждения.",
      check:
        "Сверьте строки ниже: пропуск должен привести к резервному ответу по правилам; лишнее замечание должно быть убрано с пояснением. Ошибки ИИ остаются в диагностике.",
    },
    result: {
      task: "Координатор и защита работают по правилам. Проверяют ссылки и предупреждения, формируют итог по шаблону. Автоматически пожелания не меняют.",
      check:
        "Сверьте итог с исходным ответом ИИ. При rules_fallback весь выбор заменён правилами; при local принят выбор модели, но текст и обязательные предупреждения контролирует код.",
    },
  };
  const instruction = guidance[stage];
  return (
    <div className="lab-stage-check">
      {instruction && (
        <>
          <p>
            <strong>Задача:</strong> {instruction.task}
          </p>
          <p>
            <strong>Как проверить:</strong> {instruction.check}
          </p>
        </>
      )}
      {stage === "java" && <TestCaseDecision run={run} />}
      {stage === "selector" && <SelectorDecision run={run} />}
      {stage === "critic" && <CriticDecision run={run} />}
      {stage === "needs" && (
        <>
          <p>
            Противоречий в снимке: {run.context.conflicts.length}.
            Подготовленных вопросов: {run.context.questions.length}.
          </p>
          <ul>
            {run.context.conflicts.map((text) => (
              <li key={text}>{text}</li>
            ))}
            {run.context.questions.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
        </>
      )}
      {stage === "result" && (
        <p>
          Итог:{" "}
          {run.status !== "completed"
            ? "ещё не сформирован"
            : run.execution === "local"
              ? "выбор ИИ принят после программной проверки"
              : run.execution === "rules_fallback"
                ? "ответ ИИ отклонён, использованы правила"
                : "полностью сформирован правилами"}
          .
        </p>
      )}
    </div>
  );
}
