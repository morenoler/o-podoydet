import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Building2, MapPin, Pencil, Plus, UsersRound } from "lucide-react";
import type {
  Booking,
  HostListing,
  ListingStatus,
} from "../../../../shared/account";
import { useResource } from "../useResource";
import { calendarDate, countLabel, price, roomDetailsLabel } from "../format";
import {
  AccountEmpty,
  AccountCallout,
  AccountLoading,
  ResourceError,
  SaveStatus,
} from "./AccountFeedback";
import { ListingEditor } from "./ListingEditor";
import { AccommodationPhoto } from "../../../shared/ui/AccommodationPhoto";

export function HostListingsPanel({
  onEditorDescription,
}: { onEditorDescription?: (description: string) => void } = {}) {
  const resource = useResource<HostListing[]>("/host/listings");
  const bookings = useResource<Booking[]>("/host/bookings");
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<ListingStatus>("published");
  const editorListing = resource.data?.find(
    (item) => item.id === params.get("edit"),
  );
  useEffect(() => {
    onEditorDescription?.(
      editorListing
        ? `${editorListing.title} · ${editorListing.status === "published" ? "опубликовано" : "черновик"}`
        : "Заполните информацию о жилье и параметры номера.",
    );
  }, [editorListing?.title, editorListing?.status, onEditorDescription]);
  if (resource.loading) return <AccountLoading text="Загружаем объявления…" />;
  if (resource.error)
    return <ResourceError error={resource.error} onRetry={resource.refresh} />;
  const listings = resource.data || [];
  const editing = listings.find((item) => item.id === params.get("edit"));
  const creating = params.get("new") === "1";
  const visible = listings.filter((listing) => listing.status === filter);
  const drafts = listings.filter((listing) => listing.status === "draft");
  const pending = (bookings.data || []).filter(
    (booking) => booking.status === "pending",
  ).length;
  function saved(listing: HostListing) {
    setNotice(
      listing.status === "published"
        ? "Объявление опубликовано. Гости могут отправлять вопросы и заявки."
        : "Черновик сохранён. Он доступен только вам.",
    );
    setParams({});
    setFilter(listing.status);
    resource.refresh();
    requestAnimationFrame(() => {
      const heading = document.getElementById("account-heading");
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ behavior: "auto", block: "start" });
    });
  }
  if (creating || editing)
    return (
      <ListingEditor
        key={editing?.id || "new"}
        listing={editing}
        onSaved={saved}
        onCancel={() => setParams({})}
      />
    );
  return (
    <div className="account-host-listings">
      {notice && <SaveStatus>{notice}</SaveStatus>}
      {pending > 0 && (
        <AccountCallout
          title={`${countLabel(pending, ["заявка", "заявки", "заявок"])} ${pending % 10 === 1 && pending % 100 !== 11 ? "ждёт" : "ждут"} вашего ответа`}
          action={
            <Link className="button secondary" to="/host/bookings">
              К заявкам
            </Link>
          }
        >
          Подтвердите проживание или сообщите гостю об отказе.
        </AccountCallout>
      )}
      {params.has("edit") && (
        <p className="account-inline-empty">
          Это объявление недоступно. Выберите одно из своих объявлений.
        </p>
      )}
      {!listings.length ? (
        <AccountEmpty
          icon={<Building2 size={34} />}
          title="Начните с первого объявления"
          action={
            <button
              className="button primary"
              onClick={() => setParams({ new: "1" })}
            >
              <Plus size={18} aria-hidden="true" />
              Создать объявление
            </button>
          }
        >
          Расскажите о жилье, укажите вместимость и цену. После публикации гости
          смогут связаться с вами и отправить заявку.
        </AccountEmpty>
      ) : (
        <>
          <div
            className="account-section-tabs"
            role="group"
            aria-label="Статус объявлений"
          >
            <button
              type="button"
              className={filter === "published" ? "selected" : ""}
              aria-pressed={filter === "published"}
              onClick={() => setFilter("published")}
            >
              Опубликовано<span>{listings.length - drafts.length}</span>
            </button>
            <button
              type="button"
              className={filter === "draft" ? "selected" : ""}
              aria-pressed={filter === "draft"}
              onClick={() => setFilter("draft")}
            >
              Черновики<span>{drafts.length}</span>
            </button>
          </div>
          {!visible.length && (
            <p className="account-inline-empty">
              {filter === "published"
                ? "Опубликованных объявлений пока нет. Откройте черновик и опубликуйте его, когда всё будет готово."
                : "Черновиков пока нет. Все ваши объявления опубликованы."}
            </p>
          )}
          <div className="account-records">
            {visible.map((listing) => (
              <article
                className={`account-record host-listing host-listing-v2 listing-${listing.status}`}
                key={listing.id}
              >
                <AccommodationPhoto
                  name={listing.title}
                  photos={listing.photos}
                  className="host-listing-photo"
                />
                <div className="host-listing-content">
                  <div className="account-record-heading">
                    <h2>{listing.title}</h2>
                    <span
                      className={`account-status ${listing.status === "published" ? "status-completed" : "status-draft"}`}
                    >
                      {listing.status === "published"
                        ? "Опубликовано"
                        : "Черновик"}
                    </span>
                  </div>
                  <p className="account-muted">
                    {listing.roomType} · до {listing.capacity} гостей
                  </p>
                  <p className="host-listing-room-details">
                    {listing.city} ·{" "}
                    {roomDetailsLabel(listing.floor, listing.windowDirections)}
                  </p>
                  <div className="host-listing-details">
                    <strong>
                      {price(listing.pricePerNight, listing.currency)} <span>за ночь</span>
                    </strong>
                  </div>
                  <div className="account-record-actions">
                    <button
                      className="button secondary"
                      onClick={() => setParams({ edit: listing.id })}
                    >
                      Редактировать
                    </button>
                    {listing.status === "published" && (
                      <Link
                        className="button account-soft-button"
                        to={`/stays/${listing.id}`}
                      >
                        Посмотреть
                      </Link>
                    )}
                  </div>
                  <span className="host-listing-updated">
                    Обновлено {calendarDate(listing.updatedAt)}
                  </span>
                </div>
              </article>
            ))}
          </div>
          {filter === "published" && drafts.length > 0 && (
            <div className="host-draft-hint">
              <div>
                <strong>Черновик: {drafts[0].title}</strong>
                <p>
                  Проверьте описание и стоимость, чтобы опубликовать объявление.
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() => setParams({ edit: drafts[0].id })}
              >
                Продолжить
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
