import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { MessageCircleQuestion, RefreshCw, Send } from "lucide-react";
import type { Listing } from "../../../shared/account";
import type {
  ClarificationFeature,
  ListingClarification,
} from "../../../shared/clarifications";
import type { HotelMatch, Trip } from "../../../shared/types";
import { features } from "../../../shared/features";
import { useApp } from "../../app/providers/TripProvider";
import { api } from "../../shared/api/client";
import { useAuth } from "../auth/AuthProvider";
import { canSearch } from "../search/searchTrip";
import { SearchBar } from "../search/SearchBar";
import { MatchBadge } from "../hotels/components/MatchBadge";
import { CriterionLine } from "../hotels/components/CriterionLine";
import { CapacitySummary } from "../hotels/components/CapacitySummary";
import { PersonalWishesSummary } from "../hotels/components/PersonalWishesSummary";
import {
  AccountLoading,
  ResourceError,
} from "../account/components/AccountFeedback";
import { clarificationDate as calendarDate } from "./clarificationDates";
import { ErrorMessage } from "../../shared/ui/Feedback";
import {
  hasKnownRequiredMismatch,
  matchForSelectedPreferences,
} from "../../shared/lib/matchPresentation";
import { clarificationApi } from "./api";
import {
  clarificationItems,
  ownerClarifiableFeatures,
  withClarificationPreference,
} from "./clarificationPresentation";

export const privateQuestionText: Record<ClarificationFeature, string> = {
  courtyard:
    "Все окна именно предлагаемого варианта размещения выходят во двор? Уточните, если стороны окон различаются.",
  step_free_access:
    "Можно ли пройти от улицы до именно предлагаемого варианта размещения без ступеней, включая вход, путь к лифту и выход из него? Если есть препятствия, опишите их и доступный обход.",
  family:
    "Разрешено ли размещение с детьми именно в предлагаемом варианте? Укажите ограничения, если они есть; вместимость проверяется отдельно.",
};

export function ListingClarificationPanel({ listing }: { listing: Listing }) {
  const { trip, setTrip, revision, refresh } = useApp();
  const validTrip = canSearch(trip);
  const tripKey = JSON.stringify(trip);
  const [match, setMatch] = useState<HotelMatch | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setMatch(null);
    setError("");
    if (!validTrip) {
      setBusy(false);
      return;
    }
    setBusy(true);
    api<HotelMatch>(
      `/hotels/${encodeURIComponent(`account-listing:${listing.id}`)}/evaluate`,
      trip,
    )
      .then((result) => {
        if (active) setMatch(result);
      })
      .catch((failure) => {
        if (active) setError((failure as Error).message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [listing.id, listing.updatedAt, tripKey, revision, validTrip]);
  return (
    <section
      id="listing-fit"
      className="listing-clarification-section"
      aria-labelledby="listing-fit-title"
    >
      <div className="clarification-section-heading">
        <div>
          <h2 id="listing-fit-title">Подойдёт ли вам это жильё?</h2>
          <p>
            Проверим один вариант из этого объявления. Вопрос и ответ будут
            связаны именно с ним.
          </p>
        </div>
        {validTrip && (
          <button
            type="button"
            className="text-link"
            onClick={refresh}
            disabled={busy}
          >
            <RefreshCw size={17} aria-hidden="true" />
            Перепроверить
          </button>
        )}
      </div>
      <SearchBar trip={trip} onSearch={setTrip} />
      {!validTrip ? (
        <p className="clarification-guidance">
          Укажите даты и гостей. После этого можно проверить пожелания и задать
          личный вопрос отельеру.
        </p>
      ) : busy ? (
        <AccountLoading text="Проверяем условия объявления…" />
      ) : error ? (
        <ResourceError error={error} onRetry={refresh} />
      ) : (
        match && (
          <>
            <div className="listing-fit-summary">
              <MatchBadge
                match={matchForSelectedPreferences(
                  match,
                  match.preferences || trip.preferences,
                )}
              />
              <CapacitySummary match={match.best} />
              <Link className="text-link" to="/results">
                Изменить пожелания в подборе
              </Link>
            </div>
            <div className="listing-fit-criteria">
              {match.best.criteria
                .filter((criterion) =>
                  (match.preferences || trip.preferences).some(
                    (preference) => preference.feature === criterion.feature,
                  ),
                )
                .map((criterion) => (
                  <CriterionLine
                    key={criterion.feature}
                    criterion={criterion}
                    detailed
                  />
                ))}
            </div>
            <PersonalWishesSummary match={match} />
            <PrivateQuestionComposer
              key={`${listing.id}:${tripKey}`}
              listing={listing}
              trip={trip}
              match={match}
            />
          </>
        )
      )}
    </section>
  );
}

function PrivateQuestionComposer({
  listing,
  trip,
  match,
}: {
  listing: Listing;
  trip: Trip;
  match: HotelMatch;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const priorities = clarificationItems(
    match.best,
    match.preferences || trip.preferences,
  ).filter(
    (item) =>
      ownerClarifiableFeatures.some((feature) => feature === item.feature) &&
      item.evidenceStatus !== "match" &&
      item.evidenceStatus !== "mismatch",
  );
  const requestedFeature = new URLSearchParams(location.search).get("clarify");
  const [feature, setFeature] = useState<ClarificationFeature>(
    ownerClarifiableFeatures.find((item) => item === requestedFeature) ||
      (priorities[0]?.feature as ClarificationFeature | undefined) ||
      "step_free_access",
  );
  const [note, setNote] = useState("");
  const [required, setRequired] = useState(() => {
    const requestedImportance = new URLSearchParams(location.search).get(
      "importance",
    );
    if (
      requestedImportance === "required" ||
      requestedImportance === "optional"
    )
      return requestedImportance === "required";
    return (
      (match.preferences || trip.preferences).find(
        (preference) => preference.feature === feature,
      )?.required || false
    );
  });
  const [open, setOpen] = useState(location.hash === "#listing-fit-question");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<ListingClarification | null>(null);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setSent(
        await clarificationApi.ask(listing.id, {
          feature,
          trip: withClarificationPreference(trip, feature, required),
          note: note.trim(),
          requestKey,
        }),
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (sent)
    return (
      <div className="clarification-sent" role="status">
        <MessageCircleQuestion size={26} aria-hidden="true" />
        <div>
          <h3>Уточнение отправлено отельеру</h3>
          <p>
            Ответ появится в личном кабинете. Он поможет пересчитать подбор по
            тем же пожеланиям.
          </p>
          <Link className="button secondary" to="/account/questions">
            Открыть мои уточнения
          </Link>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setSent(null);
              setNote("");
              setRequestKey(crypto.randomUUID());
              setOpen(false);
            }}
          >
            Уточнить ещё одно условие
          </button>
        </div>
      </div>
    );
  return (
    <div className="private-question-composer" id="listing-fit-question">
      <h3>Что ещё нужно узнать?</h3>
      {hasKnownRequiredMismatch(match) && (
        <p className="clarification-overdue">
          У этого варианта уже есть несоответствие обязательным условиям.
          Уточнение другого пожелания само по себе его не устранит.
        </p>
      )}
      <p className="clarification-guidance">
        Отельер может уточнить условия номера. Безопасность района, воздух и
        внешний шум проверяются по отдельным источникам.
      </p>
      {!open ? (
        <button
          type="button"
          className="button secondary"
          onClick={() => setOpen(true)}
        >
          <MessageCircleQuestion size={18} aria-hidden="true" />
          Подготовить личный вопрос
        </button>
      ) : (
        <form className="account-form" onSubmit={send}>
          <label className="field">
            <span>Условие для уточнения</span>
            <select
              value={feature}
              disabled={busy}
              onChange={(event) => {
                setFeature(event.target.value as ClarificationFeature);
                setRequired(
                  (match.preferences || trip.preferences).find(
                    (preference) => preference.feature === event.target.value,
                  )?.required || false,
                );
                setRequestKey(crypto.randomUUID());
              }}
            >
              {ownerClarifiableFeatures.map((item) => (
                <option key={item} value={item}>
                  {features[item].label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="clarification-answer-choice">
            <legend>Насколько важно это условие?</legend>
            <label>
              <input
                type="radio"
                name="clarification-importance"
                checked={!required}
                disabled={busy}
                onChange={() => {
                  setRequired(false);
                  setRequestKey(crypto.randomUUID());
                }}
              />
              <span>Желательно</span>
            </label>
            <label>
              <input
                type="radio"
                name="clarification-importance"
                checked={required}
                disabled={busy}
                onChange={() => {
                  setRequired(true);
                  setRequestKey(crypto.randomUUID());
                }}
              />
              <span>Обязательно</span>
            </label>
          </fieldset>
          <p className="clarification-guidance">
            При пересчёте учтём «{features[feature].label}»{" "}
            {required
              ? "как обязательное условие: известное несоответствие исключит этот вариант."
              : "как пожелание: оно повлияет на порядок вариантов."}{" "}
            Остальные параметры поездки сохранятся.
          </p>
          <div className="clarification-question-preview">
            <strong>Вопрос о «{listing.title}»</strong>
            <p>{privateQuestionText[feature]}</p>
            <small>
              Даты: {calendarDate(trip.checkIn)} — {calendarDate(trip.checkOut)}
              . Взрослых: {trip.adults}, детей: {trip.children}.
            </small>
          </div>
          {user?.role === "user" && (
            <label className="field">
              <span>
                Личное дополнение <small>(необязательно, до 1000 знаков)</small>
              </span>
              <textarea
                maxLength={1000}
                rows={3}
                value={note}
                disabled={busy}
                onChange={(event) => {
                  setNote(event.target.value);
                  setRequestKey(crypto.randomUUID());
                }}
                placeholder="Что ещё важно уточнить по этому условию?"
              />
            </label>
          )}
          <p className="clarification-privacy">
            Вопрос и дополнение увидит только владелец этого объявления.
            Свободный текст исходного поискового запроса ему не передаётся.
          </p>
          {error && <ErrorMessage text={error} />}
          {loading ? (
            <p role="status">Проверяем вход…</p>
          ) : !user ? (
            <Link
              className="button primary"
              to={`/login?next=${encodeURIComponent(`${location.pathname}?clarify=${feature}&importance=${required ? "required" : "optional"}#listing-fit-question`)}`}
            >
              Войти и дополнить вопрос
            </Link>
          ) : user.role !== "user" ? (
            <p className="clarification-guidance">
              Вы вошли как отельер. Уточнения отправляют путешественники; ответы
              доступны в <Link to="/host/questions">кабинете отельера</Link>.
            </p>
          ) : (
            <button className="button primary" disabled={busy}>
              <Send size={17} aria-hidden="true" />
              {busy ? "Отправляем…" : "Отправить личное уточнение"}
            </button>
          )}
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Скрыть черновик
          </button>
        </form>
      )}
    </div>
  );
}
