import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import type { Listing } from "../../../shared/account";
import { useAuth } from "../auth/AuthProvider";
import { useApp } from "../../app/providers/TripProvider";
import { bookingLatestDate, bookingToday, price, dateRange } from "../account/format";
import { listingsApi } from "./api";
import { availabilityQuestion } from "../clarifications/decisionSteps";
import "../clarifications/decision-steps.css";

function addDay(date: string, count = 1) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + count);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
export function BookingRequest({ listing }: { listing: Listing }) {
  const { user } = useAuth();
  return <BookingRequestForm key={`${listing.id}:${user?.id || "guest"}`} listing={listing} />;
}

function BookingRequestForm({ listing }: { listing: Listing }) {
  const { user, loading } = useAuth();
  const { trip, effectivePreferences } = useApp();
  const location = useLocation();
  const [form, setForm] = useState({
    checkIn: trip.checkIn >= bookingToday() ? trip.checkIn : "",
    checkOut: trip.checkIn >= bookingToday() ? trip.checkOut : "",
    guests: Math.max(1, trip.adults + trip.children),
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ checkIn: string; checkOut: string; guests: number } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setForm((previous) => ({ ...previous,
      checkIn: trip.checkIn >= bookingToday() ? trip.checkIn : "",
      checkOut: trip.checkIn >= bookingToday() ? trip.checkOut : "",
      guests: Math.max(1, trip.adults + trip.children),
    }));
    setSent(null);
    setError("");
  }, [trip.checkIn, trip.checkOut, trip.adults, trip.children]);
  const errorRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const nights =
    form.checkIn && form.checkOut
      ? Math.round(
          (Date.parse(form.checkOut) - Date.parse(form.checkIn)) / 86400000,
        )
      : 0;
  const overCapacity = form.guests > listing.capacity;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (overCapacity) {
      setError(
        `В этом жилье могут разместиться максимум ${listing.capacity} гостей. Выберите другое объявление или измените состав поездки.`,
      );
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    if (nights < 1 || nights > 90) {
      setError(
        "Выберите проживание от 1 до 90 ночей. Выезд должен быть позже заезда.",
      );
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await listingsApi.book(listing.id, { ...form, note: form.note.trim() });
      setSent({ checkIn: form.checkIn, checkOut: form.checkOut, guests: form.guests });
    } catch (error) {
      setError((error as Error).message);
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      id="listing-booking"
      className="listing-booking account-panel"
      aria-labelledby="booking-title"
    >
      <h2 id="booking-title">Уточнить наличие и стоимость</h2>
      <p className="listing-night-price">
        <strong>{price(listing.pricePerNight)}</strong>
        <span>за ночь</span>
      </p>
      <p className="listing-booking-note">Цена из объявления. Наличие, обязательные сборы и условия отмены подтвердит отельер в ответ на заявку.</p>
      {loading ? (
        <p role="status">Проверяем вход…</p>
      ) : sent ? (
        <div className="listing-request-success" role="status">
          <CheckCircle2 size={30} aria-hidden="true" />
          <h3>Заявка отправлена</h3>
          <p>{dateRange(sent.checkIn, sent.checkOut)} · гостей: {sent.guests}</p>
          <p>
            Отельер проверит даты и подтвердит возможность проживания. Статус
            заявки доступен в личном кабинете.
          </p>
          <Link className="button primary wide" to="/account">
            Перейти к моим поездкам
          </Link>
        </div>
      ) : !user ? (
        <div className="account-stack">
          <p>
            Войдите, чтобы отправить заявку отельеру и отслеживать её статус.
          </p>
          <Link
            className="button primary wide"
            to={`/login?next=${encodeURIComponent(location.pathname)}`}
          >
            Войти и отправить заявку
          </Link>
        </div>
      ) : user.role === "host" ? (
        <p className="account-muted">
          Вы вошли как отельер. Отправлять заявки могут пользователи с аккаунтом
          путешественника.
        </p>
      ) : (
        <form className="account-form" onSubmit={submit} aria-busy={busy}>
          {error && (
            <div
              className="account-form-error"
              ref={errorRef}
              tabIndex={-1}
              role="alert"
            >
              {error}
            </div>
          )}
          <fieldset className="booking-fields" disabled={busy}>
          <div className="field-row">
            <label className="field">
              <span>Заезд</span>
              <input
                type="date"
                required
                min={bookingToday()}
                max={bookingLatestDate()}
                value={form.checkIn}
                onChange={(event) =>
                  setForm({
                    ...form,
                    checkIn: event.target.value,
                    checkOut:
                      form.checkOut <= event.target.value ? "" : form.checkOut,
                  })
                }
              />
            </label>
            <label className="field">
              <span>Выезд</span>
              <input
                type="date"
                required
                min={form.checkIn ? addDay(form.checkIn) : bookingToday()}
                max={form.checkIn ? addDay(form.checkIn, 90) : undefined}
                value={form.checkOut}
                onChange={(event) =>
                  setForm({ ...form, checkOut: event.target.value })
                }
              />
            </label>
          </div>
          <label className="field">
            <span>Количество гостей</span>
            <select
              value={form.guests}
              aria-invalid={overCapacity || undefined}
              aria-describedby={
                overCapacity ? "booking-capacity-warning" : undefined
              }
              onChange={(event) =>
                setForm({ ...form, guests: Number(event.target.value) })
              }
            >
              {overCapacity && (
                <option value={form.guests}>
                  {form.guests} — больше вместимости
                </option>
              )}
              {Array.from({ length: listing.capacity }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>
            {overCapacity && (
              <small id="booking-capacity-warning">
                В вашей поездке {form.guests} гостей, а жильё рассчитано
                максимум на {listing.capacity}. Выберите другое жильё или явно
                измените число гостей.
              </small>
            )}
          </label>
          <label className="field">
            <span>
              Вопросы и пожелания отельеру{" "}
              <span className="account-optional">(необязательно)</span>
            </span>
            <textarea
              maxLength={1500}
              rows={3}
              value={form.note}
              onChange={(event) =>
                setForm({ ...form, note: event.target.value })
              }
              placeholder="Уточните полную стоимость, условия отмены и важные вам удобства"
            />
          </label>
          <div className="booking-request-context">
            <p>Можно добавить запрос о наличии, полной стоимости и выбранных удобствах. Текст будет виден вам и отельеру.</p>
            <button type="button" className="text-link" onClick={() => {
              const question = availabilityQuestion(listing.title, { ...trip, preferences: effectivePreferences, checkIn: form.checkIn, checkOut: form.checkOut }, undefined, undefined, form.guests, false);
              const next = [form.note.trim(), question].filter(Boolean).join("\n\n");
              if (next.length > 1500) { setError("В сообщении недостаточно места для всего запроса. Сократите текст до добавления пожеланий."); requestAnimationFrame(() => errorRef.current?.focus()); return; }
              setForm({ ...form, note: next }); setError("");
            }}>Добавить вопросы из моей поездки</button>
          </div>
          {nights > 0 && nights <= 90 && (
            <div className="listing-total">
              <span>По цене объявления за {nights} ноч.</span>
              <strong>{price(nights * listing.pricePerNight)}</strong>
            </div>
          )}
          <button
            className="button primary wide"
            disabled={busy || overCapacity}
          >
            {busy ? "Отправляем заявку…" : "Отправить запрос отельеру"}
          </button>
          <p className="listing-booking-note">
            Даты по времени Пусана, до 90 ночей. Без списаний. Наличие номера
            подтверждает отельер.
          </p>
          </fieldset>
        </form>
      )}
    </section>
  );
}
