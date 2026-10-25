import type { Question, Draft } from "../../../../shared/types";
import { useState } from "react";
import { api } from "../../../shared/api/client";
import { dateFull } from "../../../shared/lib/date";
import { Sparkles, Check } from "lucide-react";
import { features } from "../../../../shared/features";
import { ErrorMessage } from "../../../shared/ui/Feedback";

export function QuestionCard({
  question: q,
  onSaved,
}: {
  question: Question;
  onSaved: () => void;
}) {
  const [text, setText] = useState(""),
    [draft, setDraft] = useState<Draft | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [resolveConflict, setResolveConflict] = useState(false);
  async function preview() {
    setBusy(true);
    setError("");
    setDraft(null);
    try {
      setDraft(await api<Draft>(`/questions/${q.id}/preview`, { text }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await api(`/drafts/${draft.id}/confirm`, { resolveConflict });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="question-card">
      <div className="question-top">
        <span className={`tag ${q.status === "open" ? "pending" : ""}`}>
          {q.status === "open" ? "Ждёт ответа" : "Ответ сохранён"}
        </span>
        <small>{dateFull(q.createdAt)}</small>
      </div>
      <h2>{q.text}</h2>
      <details className="question-reason">
        <summary>Почему возник этот вопрос?</summary>
        {q.trace.map((t) => (
          <p key={t.step}>
            <strong>{t.step}:</strong> {t.detail}
          </p>
        ))}
      </details>
      {q.status === "answered" ? (
        <blockquote>{q.answer}</blockquote>
      ) : (
        <>
          <label className="field">
            <span>Ваш ответ для этой категории</span>
            <textarea
              rows={3}
              value={text}
              maxLength={1500}
              onChange={(e) => {
                setText(e.target.value);
                setDraft(null);
              }}
              placeholder={
                q.feature === "step_free_access"
                  ? "Например: перед входом три ступени, пандуса нет."
                  : "Ответьте, к какой стороне или условию относится эта категория."
              }
            />
          </label>
          <button
            className="button secondary"
            onClick={preview}
            disabled={busy || text.trim().length < 3}
          >
            {busy ? "Обрабатываем…" : "Разобрать ответ"}
            <Sparkles size={16} />
          </button>
          {draft && (
            <div className="extraction">
              <h3>Проверьте, правильно ли мы поняли</h3>
              {draft.extractions.map((e, i) => (
                <div key={i}>
                  <strong>
                    {features[e.feature].label}: {e.value ? "да" : "нет"}
                  </strong>
                  <blockquote>{e.quote}</blockquote>
                </div>
              ))}
              {draft.warnings.map((w) => (
                <p className="warning-text" key={w}>
                  {w}
                </p>
              ))}
              {draft.extractions.length > 0 && (
                <>
                  <label className="resolve-check">
                    <input
                      type="checkbox"
                      checked={resolveConflict}
                      onChange={(e) => setResolveConflict(e.target.checked)}
                    />
                    Этот ответ исправляет прежние сведения по этому условию.
                    Сохранить прежние значения в истории.
                  </label>
                  <p className="muted">
                    Без этой отметки противоречащие ответы останутся конфликтом
                    и потребуют уточнения.
                  </p>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={save}
                  >
                    Подтвердить и обновить подбор <Check size={17} />
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
      {error && <ErrorMessage text={error} />}
    </article>
  );
}
