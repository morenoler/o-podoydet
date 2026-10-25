import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import type { ListingQuestion } from "../../../shared/account";
import { useResource } from "../account/useResource";
import { useAuth } from "../auth/AuthProvider";
import {
  AccountLoading,
  ResourceError,
  SaveStatus,
} from "../account/components/AccountFeedback";
import { calendarDate } from "../account/format";
import { ErrorMessage } from "../../shared/ui/Feedback";
import { listingsApi } from "./api";

export function ListingQuestions({ listingId }: { listingId: string }) {
  const { user } = useAuth();
  const location = useLocation();
  const resource = useResource<ListingQuestion[]>(
    `/listings/${listingId}/questions`,
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSent(false);
    try {
      await listingsApi.ask(listingId, text.trim());
      setText("");
      setSent(true);
      resource.refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="listing-questions"
      aria-labelledby="listing-questions-title"
    >
      <h2 id="listing-questions-title">Вопросы об этом жилье</h2>
      <p className="account-muted">
        Уточните детали до отправки заявки. Ответы отельера видны другим гостям.
      </p>
      {resource.loading ? (
        <AccountLoading text="Загружаем вопросы…" />
      ) : resource.error ? (
        <ResourceError error={resource.error} onRetry={resource.refresh} />
      ) : !(resource.data || []).length ? (
        <p className="account-inline-empty">
          Ответов пока нет. Можно задать первый вопрос.
        </p>
      ) : (
        <div className="public-questions">
          {resource.data?.map((question) => (
            <article key={question.id}>
              <p className="account-record-meta">
                {question.guestName} · {calendarDate(question.createdAt)}
              </p>
              <h3>{question.text}</h3>
              {question.answer ? (
                <div className="question-answer">
                  <strong>Ответ отельера</strong>
                  <p>{question.answer}</p>
                </div>
              ) : (
                <p className="account-muted">Ожидает ответа отельера.</p>
              )}
            </article>
          ))}
        </div>
      )}
      {user?.role === "user" ? (
        <form className="account-form listing-question-form" onSubmit={submit}>
          <label className="field">
            <span>Ваш вопрос</span>
            <textarea
              required
              minLength={5}
              maxLength={2000}
              rows={3}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setSent(false);
              }}
              placeholder="Например, можно ли заселиться после 22:00?"
            />
          </label>
          <small className="account-muted">
            Не указывайте телефон, почту или другие личные данные: ответ
            появится в объявлении.
          </small>
          {error && <ErrorMessage text={error} />}
          {sent && (
            <SaveStatus>
              Вопрос отправлен. Ответ появится в разделе «Мои вопросы».
            </SaveStatus>
          )}
          <button
            className="button secondary"
            disabled={busy || text.trim().length < 5}
          >
            {busy ? "Отправляем…" : "Задать вопрос"}
          </button>
        </form>
      ) : !user ? (
        <Link
          className="button secondary"
          to={`/login?next=${encodeURIComponent(location.pathname)}`}
        >
          Войти и задать вопрос
        </Link>
      ) : (
        <Link className="text-link" to="/host/questions">
          Открыть вопросы гостей в кабинете
        </Link>
      )}
    </section>
  );
}
