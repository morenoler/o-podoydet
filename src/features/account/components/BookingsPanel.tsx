import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, MapPin, UsersRound } from "lucide-react";
import type {
  Booking,
  BookingStatus,
  ListingQuestion,
} from "../../../../shared/account";
import { useResource } from "../useResource";
import { accountApi } from "../api";
import {
  bookingLabels,
  bookingToday,
  calendarDate,
  countLabel,
  dateRange,
  price,
} from "../format";
import { ErrorMessage } from "../../../shared/ui/Feedback";
import {
  AccountCallout,
  AccountEmpty,
  AccountLoading,
  ResourceError,
} from "./AccountFeedback";
import { AccommodationPhoto } from "../../../shared/ui/AccommodationPhoto";

type Filter = "active" | "history";
function isCurrent(booking: Booking, host: boolean) {
  return (
    ["pending", "confirmed"].includes(booking.status) &&
    (host || booking.checkOut > bookingToday())
  );
}

export function BookingsPanel({ host = false }: { host?: boolean }) {
  const resource = useResource<Booking[]>(
    host ? "/host/bookings" : "/account/bookings",
  );
  const [filter, setFilter] = useState<Filter>("active");
  if (resource.loading) return <AccountLoading text="Загружаем поездки…" />;
  if (resource.error)
    return <ResourceError error={resource.error} onRetry={resource.refresh} />;
  const bookings = resource.data || [];
  if (!bookings.length)
    return (
      <AccountEmpty
        icon={<CalendarDays size={32} />}
        title={host ? "Заявок пока нет" : "Ваша первая поездка ещё впереди"}
        action={
          <Link className="button primary" to={host ? "/host" : "/stays"}>
            {host ? "Перейти к объявлениям" : "Найти жильё"}
          </Link>
        }
      >
        {host
          ? "Когда гость отправит заявку на ваше объявление, здесь появятся даты, состав гостей и возможность подтвердить проживание."
          : "Выберите объявление и отправьте заявку. Здесь будут её статус, детали проживания и история ваших поездок."}
      </AccountEmpty>
    );
  const current = bookings.filter((booking) => isCurrent(booking, host));
  const history = bookings.filter((booking) => !isCurrent(booking, host));
  const visible = filter === "active" ? current : history;
  const filters: { value: Filter; label: string; count: number }[] = [
    {
      value: "active",
      label: host ? "Текущие заявки" : "Предстоящие",
      count: current.length,
    },
    { value: "history", label: "История", count: history.length },
  ];
  return (
    <div className="account-bookings">
      <div
        className="account-section-tabs"
        role="group"
        aria-label="Фильтр поездок"
      >
        {filters.map(({ value, label, count }) => (
          <button
            key={value}
            className={filter === value ? "selected" : ""}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
            <span>{count}</span>
          </button>
        ))}
      </div>
      <div className="account-mobile-section-heading">
        <h2>
          {filter === "history"
            ? "История поездок"
            : host
              ? "Заявки гостей"
              : "Предстоящие поездки"}
        </h2>
        <p>
          {countLabel(
            visible.length,
            host
              ? ["заявка", "заявки", "заявок"]
              : ["поездка", "поездки", "поездок"],
          )}
        </p>
      </div>
      {!visible.length ? (
        <p className="account-inline-empty">
          В этом разделе пока нет поездок. Выберите другой фильтр.
        </p>
      ) : (
        <div className="account-records">
          {visible.map((booking) => (
            <BookingCard
              key={booking.id}
              booking={booking}
              host={host}
              onSaved={resource.refresh}
            />
          ))}
        </div>
      )}
      {!host && <TravelerQuestionNotice />}
      <p className="account-page-footnote">
        Наличие подтверждает отельер. Оплата через сервис не принимается.
      </p>
    </div>
  );
}

function TravelerQuestionNotice() {
  const resource = useResource<ListingQuestion[]>("/account/questions");
  if (!resource.data?.some((question) => question.status === "answered"))
    return null;
  return (
    <AccountCallout
      title="Есть ответ на ваш вопрос"
      action={
        <Link className="button secondary" to="/account/questions">
          Мои вопросы
        </Link>
      }
    >
      Отельер ответил о деталях проживания. Посмотрите ответ перед поездкой.
    </AccountCallout>
  );
}

function BookingCard({
  booking,
  host,
  onSaved,
}: {
  booking: Booking;
  host: boolean;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const active = ["pending", "confirmed"].includes(booking.status);
  const canCancel =
    host || booking.status === "pending" || booking.checkIn >= bookingToday();
  async function update(status: BookingStatus) {
    setBusy(true);
    setError("");
    try {
      if (host) await accountApi.setBookingStatus(booking.id, status);
      else await accountApi.cancelBooking(booking.id);
      onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  }
  return (
    <article
      className={`account-record booking-record booking-record-v2 booking-${booking.status}`}
    >
      <AccommodationPhoto
        name={booking.listingTitle}
        photos={booking.photos}
        className="booking-photo"
      />
      <div className="booking-content">
        <div className="account-record-heading">
          <div>
            <h2>
              <Link to={`/stays/${booking.listingId}`}>
                {booking.listingTitle}
              </Link>
            </h2>
            <p className="account-record-meta">
              {booking.roomType ? `${booking.roomType} · ` : ""}
              {booking.city}
            </p>
          </div>
          <span className={`account-status status-${booking.status}`}>
            {bookingLabels[booking.status]}
          </span>
        </div>
        <div className="booking-facts">
          <span>
            <CalendarDays size={18} aria-hidden="true" />
            {dateRange(booking.checkIn, booking.checkOut)}
          </span>
          <span>
            <UsersRound size={18} aria-hidden="true" />
            {countLabel(booking.guests, ["гость", "гостя", "гостей"])}
          </span>
        </div>
        <div className="booking-price">
          <strong>{price(booking.totalPrice, booking.currency)}</strong>
          <span>
            за {countLabel(booking.nights, ["ночь", "ночи", "ночей"])}
          </span>
        </div>
        {host && (
          <p className="account-muted">
            Гость: {booking.guestName} ·{" "}
            <a href={`mailto:${booking.guestEmail}`}>{booking.guestEmail}</a>
          </p>
        )}
        {error && <ErrorMessage text={error} />}
        <p className={`booking-status-message status-text-${booking.status}`}>
          {booking.status === "confirmed"
            ? "Отельер подтвердил проживание."
            : booking.status === "pending"
              ? "Отельер ещё не подтвердил заявку."
              : booking.status === "completed"
                ? "Проживание завершено."
                : "Заявка отменена."}
        </p>
        <div className="booking-primary-actions">
          <Link className="button primary" to={`/stays/${booking.listingId}`}>
            Открыть объявление
          </Link>
          {!host && (
            <Link
              className="button secondary"
              to={`/stays/${booking.listingId}#listing-questions-title`}
            >
              Задать вопрос
            </Link>
          )}
          {!host && active && !confirmCancel && canCancel && (
            <button
              className="button account-text-button booking-cancel-action"
              disabled={busy}
              onClick={() => setConfirmCancel(true)}
            >
              {booking.status === "pending"
                ? "Отменить заявку"
                : "Отменить бронь"}
            </button>
          )}
        </div>
        {active && (host || confirmCancel || !canCancel) && (
          <div className="account-record-actions">
            {host &&
              booking.status === "pending" &&
              booking.checkOut > bookingToday() && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void update("confirmed")}
                >
                  {busy ? "Сохраняем…" : "Подтвердить бронь"}
                </button>
              )}
            {host &&
              booking.status === "confirmed" &&
              booking.checkOut <= bookingToday() && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void update("completed")}
                >
                  {busy ? "Сохраняем…" : "Завершить проживание"}
                </button>
              )}
            {host && !confirmCancel && canCancel && (
              <button
                className="button account-text-button booking-cancel-action"
                disabled={busy}
                onClick={() => setConfirmCancel(true)}
              >
                {booking.status === "pending"
                  ? host
                    ? "Отклонить заявку"
                    : "Отменить заявку"
                  : "Отменить бронь"}
              </button>
            )}
            {!canCancel && (
              <p className="account-muted">
                Проживание уже началось. Для отмены свяжитесь с отельером.
              </p>
            )}
            {confirmCancel && (
              <div
                className="account-confirm"
                role="group"
                aria-label="Подтверждение отмены"
              >
                <p>
                  Отменить{" "}
                  {booking.status === "pending" ? "эту заявку" : "эту бронь"}?
                </p>
                <button
                  className="button account-danger"
                  disabled={busy}
                  onClick={() => void update("cancelled")}
                >
                  {busy ? "Отменяем…" : "Да, отменить"}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setConfirmCancel(false)}
                >
                  Сохранить {booking.status === "pending" ? "заявку" : "бронь"}
                </button>
              </div>
            )}
          </div>
        )}
        <details className="booking-extra-details">
          <summary>Детали заявки</summary>
          <p className="booking-address">
            <MapPin size={18} aria-hidden="true" />
            <span>{booking.address}</span>
          </p>
          {booking.note && (
            <div className="booking-note">
              <strong>Пожелания к заселению</strong>
              <p>{booking.note}</p>
            </div>
          )}
          <p className="account-record-date">
            Заявка от {calendarDate(booking.createdAt)}
          </p>
        </details>
      </div>
    </article>
  );
}
