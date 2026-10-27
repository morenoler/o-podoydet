import { useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import type { Listing } from "../../../shared/account";
import { useAuth } from "../auth/AuthProvider";
import { useApp } from "../../app/providers/TripProvider";
import { bookingLatestDate, bookingToday, price } from "../account/format";
import { listingsApi } from "./api";

function addDay(date: string, count = 1) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + count);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
export function BookingRequest({ listing }: { listing: Listing }) {
  const { user, loading } = useAuth();
  const { trip } = useApp();
  const location = useLocation();
  const [form, setForm] = useState({
    checkIn: trip.checkIn >= bookingToday(listing.city) ? trip.checkIn : "",
    checkOut: trip.checkIn >= bookingToday(listing.city) ? trip.checkOut : "",
    guests: Math.max(1, trip.adults + trip.children),
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const nights =
    form.checkIn && form.checkOut
      ? Math.round(
          (Date.parse(form.checkOut) - Date.parse(form.checkIn)) / 86400000,
        )
      : 0;
  const overCapacity = form.guests > listing.capacity;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    setBusy(true);
    setError("");
    try {
      await listingsApi.book(listing.id, { ...form, note: form.note.trim() });
      setSent(true);
    } catch (error) {
      setError((error as Error).message);
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="listing-booking account-panel"
      aria-labelledby="booking-title"
    >
      <h2 id="booking-title">Заявка на проживание</h2>
      <p className="listing-night-price">
        <strong>{price(listing.pricePerNight, listing.currency)}</strong>
        <span>за ночь</span>
      </p>
      {sent ? (
        <div className="listing-request-success" role="status">
          <CheckCircle2 size={30} aria-hidden="true" />
          <h3>Заявка отправлена</h3>
          <p>
            Отельер проверит даты и подтвердит возможность проживания. Статус
            заявки доступен в личном кабинете.
          </p>
          <Link className="button primary wide" to="/account">
            Перейти к моим поездкам
          </Link>
        </div>
      ) : loading ? (
        <p role="status">Проверяем вход…</p>
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
        <form className="account-form" onSubmit={submit}>
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
          <div className="field-row">
            <label className="field">
              <span>Заезд</span>
              <input
                type="date"
                required
                min={bookingToday(listing.city)}
                max={bookingLatestDate(listing.city)}
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
                min={form.checkIn ? addDay(form.checkIn) : bookingToday(listing.city)}
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
              Пожелания к заселению{" "}
              <span className="account-optional">(необязательно)</span>
            </span>
            <textarea
              maxLength={1500}
              rows={3}
              value={form.note}
              onChange={(event) =>
                setForm({ ...form, note: event.target.value })
              }
              placeholder="Например, время прибытия"
            />
          </label>
          {nights > 0 && nights <= 90 && (
            <div className="listing-total">
              <span>Всего за {nights} ноч.</span>
              <strong>{price(nights * listing.pricePerNight, listing.currency)}</strong>
            </div>
          )}
          <button
            className="button primary wide"
            disabled={busy || overCapacity}
          >
            {busy ? "Отправляем заявку…" : "Отправить заявку"}
          </button>
          <p className="listing-booking-note">
            Даты по местному времени ({listing.city}), до 90 ночей. Без списаний. Наличие номера
            подтверждает отельер.
          </p>
        </form>
      )}
    </section>
  );
}
