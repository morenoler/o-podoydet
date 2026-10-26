import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type {
  AnswerClarification,
  ListingClarification,
} from "../../../shared/clarifications";
import { features } from "../../../shared/features";
import { bookingToday } from "../account/format";
import {
  clarificationDate as calendarDate,
  correctableStatements,
  plannedRecheckDate,
} from "./clarificationDates";
import { ErrorMessage } from "../../shared/ui/Feedback";

export function ClarificationAnswerForm({
  question,
  onSubmit,
  onCancel,
}: {
  question: ListingClarification;
  onSubmit: (input: AnswerClarification) => Promise<void>;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState<"yes" | "no" | "unknown">(
    question.answer?.value == null
      ? "unknown"
      : question.answer.value
        ? "yes"
        : "no",
  );
  const [text, setText] = useState(question.answer?.text || "");
  const [observedOn, setObservedOn] = useState(
    question.answer?.observedOn || "",
  );
  const [validFrom, setValidFrom] = useState(question.answer?.validFrom || "");
  const [validTo, setValidTo] = useState(question.answer?.validTo || "");
  const [validForDays, setValidForDays] = useState(30);
  const [supersedes, setSupersedes] = useState<string[]>([]);
  const [preview, setPreview] = useState<AnswerClarification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const related = correctableStatements(question);
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!!validFrom !== !!validTo || (validFrom && validTo < validFrom)) {
      setError(
        "Укажите обе даты действия ответа. Последняя дата должна быть не раньше первой.",
      );
      return;
    }
    if (observedOn && observedOn > bookingToday()) {
      setError("Дата проверки не может быть в будущем.");
      return;
    }
    setPreview({
      expectedVersion: question.version,
      requestKey: crypto.randomUUID(),
      value: value === "unknown" ? null : value === "yes",
      text: text.trim(),
      observedOn: observedOn || null,
      validFrom: validFrom || null,
      validTo: validTo || null,
      validForDays,
      supersedes,
    });
  }
  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(preview);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const recheckDate = preview
    ? plannedRecheckDate(
        preview.observedOn,
        preview.validForDays,
        bookingToday(),
      )
    : null;
  if (preview)
    return (
      <div className="clarification-answer-preview">
        <h3>Проверьте ответ перед сохранением</h3>
        <p>
          <strong>
            {features[question.feature].label}:{" "}
            {preview.value === null
              ? "пока неизвестно"
              : preview.value
                ? "да"
                : "нет"}
            .
          </strong>
        </p>
        <p className="clarification-answer-text">{preview.text}</p>
        <p className="clarification-guidance">
          Относится только к единице размещения в объявлении «
          {question.listingTitle}».
          {preview.value === null
            ? " Неизвестный ответ не подтвердит условие."
            : " В подборе появится как заявление отельера, без независимой проверки."}
        </p>
        <dl className="clarification-answer-meta">
          <div>
            <dt>Когда проверили</dt>
            <dd>
              {preview.observedOn
                ? calendarDate(preview.observedOn)
                : "Дата неизвестна"}
            </dd>
          </div>
          <div>
            <dt>Перепроверить до</dt>
            <dd>{calendarDate(recheckDate!)} (по времени Пусана)</dd>
          </div>
          {preview.validFrom && preview.validTo && (
            <div>
              <dt>Действует для проживания</dt>
              <dd>
                {calendarDate(preview.validFrom)} —{" "}
                {calendarDate(preview.validTo)}
              </dd>
            </div>
          )}
        </dl>
        {recheckDate! <= bookingToday() && (
          <p className="clarification-overdue" role="status">
            Срок перепроверки уже наступил. Ответ сохранится в истории, но не
            подтвердит актуальное условие для подбора. Укажите новую дату только
            после повторной проверки.
          </p>
        )}
        {!preview.observedOn && (
          <p className="clarification-guidance">
            Срок перепроверки считаем от даты записи. Дата проверки на месте
            остаётся неизвестной.
          </p>
        )}
        {!!preview.supersedes.length && (
          <p className="clarification-guidance">
            Заменяемые заявления: {preview.supersedes.length}. Они останутся в
            истории.
          </p>
        )}
        {error && (
          <>
            <ErrorMessage text={error} />
            <Link
              className="text-link"
              to={`/stays/${encodeURIComponent(question.listingId)}#listing-fit`}
            >
              Открыть актуальное объявление
            </Link>
          </>
        )}
        <div className="clarification-actions">
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? "Сохраняем…" : "Подтвердить и обновить подбор"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setPreview(null);
              setError("");
            }}
          >
            Изменить ответ
          </button>
        </div>
      </div>
    );
  return (
    <form className="account-form clarification-answer-form" onSubmit={prepare}>
      <fieldset className="clarification-answer-choice">
        <legend>{features[question.feature].label}</legend>
        {(["yes", "no", "unknown"] as const).map((choice) => (
          <label key={choice}>
            <input
              type="radio"
              name={`answer-${question.id}`}
              value={choice}
              checked={value === choice}
              onChange={() => setValue(choice)}
            />
            <span>
              {choice === "yes"
                ? "Да"
                : choice === "no"
                  ? "Нет"
                  : "Пока не знаю"}
            </span>
          </label>
        ))}
      </fieldset>
      <p className="clarification-guidance">
        Ответ относится к одному варианту из этого объявления. Если условие есть
        только у части номеров, выберите «Пока не знаю» и опишите, какие детали
        нужно уточнить.
      </p>
      <label className="field">
        <span>Пояснение гостю</span>
        <textarea
          required
          minLength={2}
          maxLength={3000}
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            question.feature === "step_free_access"
              ? "Например: от улицы до номера есть три ступени, пандуса нет."
              : "Укажите условия и ограничения именно этого размещения."
          }
        />
      </label>
      <div className="clarification-date-fields">
        <label className="field">
          <span>
            Когда вы проверили это <small>(необязательно)</small>
          </span>
          <input
            type="date"
            max={bookingToday()}
            value={observedOn}
            onChange={(event) => setObservedOn(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Перепроверить через, дней</span>
          <input
            type="number"
            min={1}
            max={90}
            required
            value={validForDays}
            onChange={(event) => setValidForDays(Number(event.target.value))}
          />
        </label>
      </div>
      <details className="clarification-validity">
        <summary>Условие действует только в определённые даты</summary>
        <p className="clarification-guidance">
          Заполните обе даты, если, например, доступный вход закрыт на ремонт в
          другое время.
        </p>
        <div className="clarification-date-fields">
          <label className="field">
            <span>Первая дата</span>
            <input
              type="date"
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Последняя дата</span>
            <input
              type="date"
              min={validFrom || undefined}
              value={validTo}
              onChange={(event) => setValidTo(event.target.value)}
            />
          </label>
        </div>
      </details>
      {!!related.length && (
        <fieldset className="clarification-supersedes">
          <legend>Исправляет ли ответ прежние заявления?</legend>
          <p className="clarification-guidance">
            Отметьте только те сведения, которые вы исправляете. Противоречащие
            ответы без исправления останутся конфликтом.
          </p>
          {related.map((statement) => (
            <label key={statement.id}>
              <input
                type="checkbox"
                checked={supersedes.includes(statement.id)}
                onChange={(event) =>
                  setSupersedes(
                    event.target.checked
                      ? [...supersedes, statement.id]
                      : supersedes.filter((id) => id !== statement.id),
                  )
                }
              />
              <span>
                {statement.value === null
                  ? "Неизвестно"
                  : statement.value
                    ? "Да"
                    : "Нет"}{" "}
                · записано {calendarDate(statement.recordedAt)}
                {statement.observedOn
                  ? `, проверено ${calendarDate(statement.observedOn)}`
                  : ", дата проверки неизвестна"}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {error && <ErrorMessage text={error} />}
      <div className="clarification-actions">
        <button
          className="button primary"
          disabled={busy || text.trim().length < 2}
        >
          Проверить ответ
        </button>
        {onCancel && (
          <button type="button" className="button secondary" onClick={onCancel}>
            Отмена
          </button>
        )}
      </div>
    </form>
  );
}
