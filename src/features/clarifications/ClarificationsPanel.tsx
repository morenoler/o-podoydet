import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MessageCircleQuestion, RefreshCw } from "lucide-react";
import type {
  ClarificationAnswer,
  ListingClarification,
} from "../../../shared/clarifications";
import { features } from "../../../shared/features";
import { useApp } from "../../app/providers/TripProvider";
import { useResource } from "../account/useResource";
import {
  clarificationDate as calendarDate,
  clarificationNeedsAttention,
  clarificationStatusLabel,
} from "./clarificationDates";
import {
  AccountLoading,
  ResourceError,
} from "../account/components/AccountFeedback";
import { ClarificationAnswerForm } from "./ClarificationAnswerForm";
import { clarificationApi } from "./api";

export function ClarificationsPanel({ host = false }: { host?: boolean }) {
  const resource = useResource<ListingClarification[]>(
    host ? "/host/clarifications" : "/account/clarifications",
  );
  const { refresh } = useApp();
  const [openOnly, setOpenOnly] = useState(false);
  const [saved, setSaved] = useState(false);
  const questions = resource.data || [];
  const visible = questions.filter(
    (question) => !openOnly || clarificationNeedsAttention(question),
  );
  return (
    <section
      className="private-clarifications"
      aria-labelledby="private-clarifications-title"
    >
      <div className="clarification-section-heading">
        <div>
          <h2 id="private-clarifications-title">
            <MessageCircleQuestion size={23} aria-hidden="true" /> Уточнения для
            подбора
          </h2>
          <p>
            {host
              ? "Ответьте об условиях именно вашего объявления. Ответ можно учесть в новом подборе гостя."
              : "Здесь вопросы об условиях выбранного жилья и ответы, которые можно учесть в подборе."}
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={resource.loading}
          onClick={resource.refresh}
        >
          <RefreshCw size={17} aria-hidden="true" />
          Обновить
        </button>
      </div>
      <p className="clarification-privacy">
        Переписку видят только путешественник и владелец объявления. В общий
        подбор попадают только условие, ответ «да / нет / неизвестно» и даты.
      </p>
      {saved && (
        <p role="status" className="account-success">
          Ответ сохранён. Новые поиски учитывают его как заявление отельера.
          Прежние результаты не переписаны.
        </p>
      )}
      {resource.loading ? (
        <AccountLoading text="Загружаем уточнения…" />
      ) : resource.error ? (
        <ResourceError error={resource.error} onRetry={resource.refresh} />
      ) : !questions.length ? (
        <div className="clarification-empty">
          <p>
            {host
              ? "Новых уточнений пока нет. Гости смогут задать их из карточки вашего объявления."
              : "Вы ещё не отправляли уточнений. Откройте объявление, чтобы проверить его под свои пожелания."}
          </p>
          <Link className="text-link" to={host ? "/host" : "/results"}>
            {host ? "К моим объявлениям" : "К подбору жилья"}
          </Link>
        </div>
      ) : (
        <>
          <div
            className="account-filter-row"
            role="group"
            aria-label="Фильтр личных уточнений"
          >
            <button
              type="button"
              className={`account-filter${!openOnly ? " selected" : ""}`}
              aria-pressed={!openOnly}
              onClick={() => setOpenOnly(false)}
            >
              Все ({questions.length})
            </button>
            <button
              type="button"
              className={`account-filter${openOnly ? " selected" : ""}`}
              aria-pressed={openOnly}
              onClick={() => setOpenOnly(true)}
            >
              Требуют внимания (
              {questions.filter(clarificationNeedsAttention).length})
            </button>
          </div>
          {!visible.length ? (
            <p className="account-inline-empty">
              Нет открытых вопросов, устаревших или противоречащих сведений.
            </p>
          ) : (
            <div className="clarification-conversations">
              {visible.map((question) => (
                <ClarificationConversation
                  key={`${question.id}:${question.version}:${question.scopeChanged}:${question.evidenceStatus}`}
                  question={question}
                  host={host}
                  onSaved={() => {
                    setSaved(true);
                    resource.refresh();
                    refresh();
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ClarificationConversation({
  question,
  host,
  onSaved,
}: {
  question: ListingClarification;
  host: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(!question.answer);
  const { setTrip, refresh } = useApp();
  const navigate = useNavigate();
  const scopeChanged =
    question.scopeChanged || question.answer?.state === "scope_changed";
  function recalculate() {
    if (!question.trip) return;
    setTrip(question.trip);
    refresh();
    navigate("/results");
  }
  return (
    <article className="clarification-conversation">
      <div className="clarification-conversation-heading">
        <h3>
          <Link
            to={`/stays/${encodeURIComponent(question.listingId)}#listing-fit`}
          >
            {question.listingTitle}
          </Link>
        </h3>
        <span
          className={`clarification-status is-${question.scopeChanged ? "unknown" : question.evidenceStatus}`}
        >
          {clarificationStatusLabel(question)}
        </span>
      </div>
      <p className="clarification-context">
        {features[question.feature].label} · {calendarDate(question.createdAt)}
      </p>
      <p className="clarification-context">
        {calendarDate(question.context.checkIn)} —{" "}
        {calendarDate(question.context.checkOut)} · взрослых:{" "}
        {question.context.adults}, детей: {question.context.children}
      </p>
      <p className="clarification-question-text">{question.text}</p>
      {!scopeChanged && question.evidenceStatus === "conflict" && (
        <p className="clarification-overdue">
          Ответы или сведения в объявлении противоречат друг другу. Пока отельер
          не уточнит, какие заявления исправлены, условие не считается
          выполненным.
          {host && (
            <>
              {" "}
              <Link to={`/host?edit=${encodeURIComponent(question.listingId)}`}>
                Проверить сведения объявления
              </Link>
            </>
          )}
        </p>
      )}
      {question.note && (
        <div className="clarification-private-note">
          <strong>Личное дополнение путешественника</strong>
          <p>{question.note}</p>
        </div>
      )}
      {question.answer && <ClarificationAnswerView answer={question.answer} />}
      {scopeChanged ? (
        <div className="clarification-recalculate">
          <p>
            Условия объявления изменились. Для актуального варианта нужно новое
            уточнение.
          </p>
          <Link
            className="button secondary"
            to={`/stays/${encodeURIComponent(question.listingId)}#listing-fit`}
          >
            {host
              ? "Открыть актуальное объявление"
              : "Подготовить новый вопрос"}
          </Link>
        </div>
      ) : host && editing ? (
        <ClarificationAnswerForm
          question={question}
          onSubmit={async (input) => {
            await clarificationApi.answer(question.id, input);
            onSaved();
          }}
          onCancel={question.answer ? () => setEditing(false) : undefined}
        />
      ) : (
        host && (
          <button
            type="button"
            className="text-link"
            onClick={() => setEditing(true)}
          >
            Уточнить свой ответ
          </button>
        )
      )}
      {!host && question.answer && question.trip && (
        <div className="clarification-recalculate">
          <p>
            Проверим ответ вместе с остальными условиями. Требования вашей
            исходной поездки сохранятся.
          </p>
          <button
            type="button"
            className="button primary"
            onClick={recalculate}
          >
            <RefreshCw size={17} aria-hidden="true" />
            Пересчитать подбор
          </button>
        </div>
      )}
      {question.history.length > 1 && (
        <details className="clarification-history">
          <summary>История ответов ({question.history.length})</summary>
          {question.history.map((answer) => (
            <ClarificationAnswerView key={answer.id} answer={answer} compact />
          ))}
        </details>
      )}
    </article>
  );
}

export function ClarificationAnswerView({
  answer,
  compact = false,
}: {
  answer: ClarificationAnswer;
  compact?: boolean;
}) {
  const state =
    answer.state === "stale"
      ? "Срок перепроверки прошёл"
      : answer.state === "scope_changed"
        ? "Объявление изменилось, ответ требует перепроверки"
        : answer.state === "superseded"
          ? "Сохранено в истории, заменено новым ответом"
          : "Со слов отельера";
  return (
    <div
      className={`clarification-owner-answer${compact ? " is-history" : ""}`}
    >
      <strong>
        {features[answer.feature].label}:{" "}
        {answer.value === null ? "неизвестно" : answer.value ? "да" : "нет"}
      </strong>
      <p className="clarification-answer-text">{answer.text}</p>
      <p className="clarification-context">
        {state}. Записано {calendarDate(answer.recordedAt)}.
      </p>
      <p className="clarification-context">
        {answer.observedOn
          ? `Проверено отельером ${calendarDate(answer.observedOn)}`
          : "Когда отельер проверял условие — неизвестно"}
        . Перепроверить до {calendarDate(answer.recheckAt)}.
      </p>
      {answer.validFrom && answer.validTo && (
        <p className="clarification-context">
          Для проживания с {calendarDate(answer.validFrom)} по{" "}
          {calendarDate(answer.validTo)}.
        </p>
      )}
      {!compact && (
        <p className="clarification-guidance">
          Независимая проверка не проведена. Ответ относится к единице
          размещения в этом объявлении.
        </p>
      )}
    </div>
  );
}
