import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import type { ListingQuestion } from "../../../../shared/account";
import { accountApi } from "../api";
import { calendarDate } from "../format";
import { useResource } from "../useResource";
import { ErrorMessage } from "../../../shared/ui/Feedback";
import { AccountEmpty, AccountLoading, ResourceError } from "./AccountFeedback";
import { ClarificationsPanel } from "../../clarifications/ClarificationsPanel";
import "../../clarifications/clarifications.css";

export function QuestionsPanel({ host = false }: { host?: boolean }) {
  return (
    <div className="account-stack">
      <ClarificationsPanel host={host} />
      <section
        className="public-questions-section"
        aria-labelledby="public-questions-title"
      >
        <h2 id="public-questions-title">Общие вопросы об объявлении</h2>
        <p className="account-muted">
          Это публичный раздел: ответы отельера доступны другим гостям.
        </p>
        <PublicQuestionsPanel host={host} />
      </section>
    </div>
  );
}

function PublicQuestionsPanel({ host = false }: { host?: boolean }) {
  const resource = useResource<ListingQuestion[]>(
    host ? "/host/questions" : "/account/questions",
  );
  const [openOnly, setOpenOnly] = useState(false);
  if (resource.loading) return <AccountLoading text="Загружаем вопросы…" />;
  if (resource.error)
    return <ResourceError error={resource.error} onRetry={resource.refresh} />;
  const questions = resource.data || [];
  if (!questions.length)
    return (
      <AccountEmpty
        icon={<MessageCircle size={32} />}
        title={
          host ? "Гости ещё не задавали вопросов" : "Здесь будет ваша переписка"
        }
        action={
          <Link className="button secondary" to={host ? "/host" : "/stays"}>
            {host ? "Мои объявления" : "Посмотреть объявления"}
          </Link>
        }
      >
        {host
          ? "Вопросы к вашим объявлениям появятся здесь. Ваши ответы будут доступны в карточке объявления."
          : "Уточните условия проживания в карточке объявления. Ответ отельера появится здесь и в самом объявлении."}
      </AccountEmpty>
    );
  const visible = questions.filter(
    (question) => !openOnly || question.status === "open",
  );
  return (
    <div className="account-stack">
      <div
        className="account-filter-row"
        role="group"
        aria-label="Фильтр вопросов"
      >
        <button
          className={`account-filter${!openOnly ? " selected" : ""}`}
          aria-pressed={!openOnly}
          onClick={() => setOpenOnly(false)}
        >
          Все вопросы ({questions.length})
        </button>
        <button
          className={`account-filter${openOnly ? " selected" : ""}`}
          aria-pressed={openOnly}
          onClick={() => setOpenOnly(true)}
        >
          Без ответа (
          {questions.filter((question) => question.status === "open").length})
        </button>
      </div>
      {!visible.length ? (
        <p className="account-inline-empty">На все вопросы уже есть ответы.</p>
      ) : (
        <div className="account-records">
          {visible.map((question) => (
            <QuestionItem
              key={question.id}
              question={question}
              host={host}
              onSaved={resource.refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionItem({
  question,
  host,
  onSaved,
}: {
  question: ListingQuestion;
  host: boolean;
  onSaved: () => void;
}) {
  const [answer, setAnswer] = useState(question.answer || "");
  const [editing, setEditing] = useState(!question.answer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await accountApi.answer(question.id, answer.trim());
      onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="account-record question-record">
      <div className="account-record-heading">
        <h2>
          <Link to={`/stays/${question.listingId}`}>
            {question.listingTitle}
          </Link>
        </h2>
        <span
          className={`account-status ${question.answer ? "status-completed" : "status-pending"}`}
        >
          {question.answer ? "Ответ получен" : "Ожидает ответа"}
        </span>
      </div>
      <p className="account-record-meta">
        {host ? question.guestName : "Ваш вопрос"} ·{" "}
        {calendarDate(question.createdAt)}
      </p>
      <p className="question-text">{question.text}</p>
      {host && question.answer && !editing && (
        <div className="question-answer">
          <strong>Ваш ответ</strong>
          <p>{question.answer}</p>
          {question.answeredAt && (
            <small>{calendarDate(question.answeredAt)}</small>
          )}
        </div>
      )}
      {!host && question.answer && (
        <div className="question-answer">
          <strong>Ответ отельера</strong>
          <p>{question.answer}</p>
          {question.answeredAt && (
            <small>{calendarDate(question.answeredAt)}</small>
          )}
        </div>
      )}
      {host && editing && (
        <form className="account-form question-reply" onSubmit={submit}>
          <label className="field">
            <span>Ваш ответ гостю</span>
            <textarea
              rows={3}
              value={answer}
              required
              minLength={2}
              maxLength={3000}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Расскажите об условиях проживания"
            />
          </label>
          {error && <ErrorMessage text={error} />}
          <div className="account-form-actions">
            <button
              className="button primary"
              disabled={busy || !answer.trim()}
            >
              {busy ? "Отправляем…" : "Отправить ответ"}
            </button>
            {question.answer && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setEditing(false);
                  setAnswer(question.answer || "");
                }}
              >
                Отмена
              </button>
            )}
          </div>
        </form>
      )}
      {host && !editing && (
        <button
          className="text-link account-edit-answer"
          onClick={() => setEditing(true)}
        >
          Изменить ответ
        </button>
      )}
    </article>
  );
}
