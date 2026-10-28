import { useId, useRef, useState } from "react";
import { Check, Copy, MessageCircle, SearchCheck } from "lucide-react";
import type { HotelMatch, RoomMatch } from "../../../shared/types";
import { features } from "../../../shared/features";
import { isAmenityId } from "../../../shared/amenities";
import {
  catalogQuestion,
  clarificationItems,
  clarificationState,
  independentCheck,
  ownerCanClarify,
} from "./clarificationPresentation";

/** Research catalog entries have no connected owner: preparing a draft never sends it. */
export function CatalogClarificationPlan({
  match,
  room,
}: {
  match: HotelMatch;
  room: RoomMatch;
}) {
  const headingId = useId();
  const items = clarificationItems(room, match.preferences || []);
  if (!items.length) return null;
  return (
    <section className="clarification-plan" aria-labelledby={headingId}>
      <h3 id={headingId}>Что уточнить до выбора</h3>
      <p className="clarification-intro">
        {room.room.scope === "room_category" &&
        room.room.evidenceStatus === "verified"
          ? `Для категории «${room.room.name}». Ответ о другом номере не подтвердит эти условия.`
          : "Категория номера пока неизвестна. Сначала уточните, какой вариант размещения вам предлагают."}
      </p>
      <ul className="clarification-items">
        {items.map((criterion) => (
          <li key={criterion.feature}>
            <div className="clarification-item-heading">
              <strong>{features[criterion.feature].label}</strong>
              {criterion.required && (
                <span className="clarification-required">Обязательно</span>
              )}
            </div>
            <p className="clarification-state">
              {clarificationState(criterion)}
            </p>
            {criterion.evidenceStatus === "mismatch" ? (
              <p className="clarification-guidance">
                {criterion.sourceExplanation || criterion.explanation} Выберите
                другой вариант или измените пожелание, если это допустимо для
                вашей поездки.
              </p>
            ) : ownerCanClarify(criterion.feature) || isAmenityId(criterion.feature) ? (
              <CatalogDraft
                key={`${room.room.id}:${criterion.feature}`}
                question={catalogQuestion(match.hotel, room.room, criterion)}
                label={features[criterion.feature].label}
              />
            ) : (
              <details className="clarification-source-check">
                <summary>
                  <SearchCheck size={17} aria-hidden="true" /> Как проверить
                </summary>
                <p>{independentCheck(criterion.feature)}</p>
              </details>
            )}
          </li>
        ))}
      </ul>
      <p className="clarification-boundary">
        У этого объекта нет подключённого кабинета отельера. Здесь можно
        подготовить текст для самостоятельного уточнения. Сервис его не
        отправляет.
      </p>
    </section>
  );
}

function CatalogDraft({
  question,
  label,
}: {
  question: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(question);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">(
    "idle",
  );
  const field = useRef<HTMLTextAreaElement>(null);
  const contentId = useId();
  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      field.current?.focus();
      field.current?.select();
      setCopyState("manual");
    }
  }
  return (
    <div className="clarification-draft">
      <button
        type="button"
        className="text-link"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
      >
        <MessageCircle size={17} aria-hidden="true" />
        {open ? "Скрыть черновик" : "Подготовить вопрос"}
      </button>
      {open && (
        <div id={contentId} className="clarification-draft-content">
          <label className="field">
            <span>Черновик: {label.toLocaleLowerCase("ru-RU")}</span>
            <textarea
              ref={field}
              value={text}
              rows={6}
              maxLength={2000}
              onChange={(event) => {
                setText(event.target.value);
                setCopyState("idle");
              }}
            />
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={!text.trim()}
            onClick={() => void copy()}
          >
            {copyState === "copied" ? (
              <Check size={17} aria-hidden="true" />
            ) : (
              <Copy size={17} aria-hidden="true" />
            )}
            {copyState === "copied" ? "Текст скопирован" : "Скопировать вопрос"}
          </button>
          {copyState === "manual" && (
            <p role="status" className="clarification-guidance">
              Автоматическое копирование недоступно. Текст выделен: скопируйте
              его вручную.
            </p>
          )}
          {copyState === "copied" && (
            <span className="sr-only" role="status">
              Черновик скопирован. Вопрос не отправлен.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
