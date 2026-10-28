import { Link, useSearchParams } from "react-router-dom";
import { Building2, MapPin, Plus, RotateCcw, Search, UsersRound } from "lucide-react";
import type { Listing } from "../../shared/account";
import { useResource } from "../features/account/useResource";
import { useAuth } from "../features/auth/AuthProvider";
import { price, roomDetailsLabel } from "../features/account/format";
import { AccommodationPhoto } from "../shared/ui/AccommodationPhoto";
import { ReviewHighlights } from "../features/listings/ReviewHighlights";
import { FavoriteButton } from "../features/favorites/FavoriteButton";
import {
  AccountEmpty,
  AccountLoading,
  ResourceError,
} from "../features/account/components/AccountFeedback";
import "../features/account/account.css";
import "../features/listings/listings-v2.css";

export function ListingsPage() {
  const { user } = useAuth();
  const resource = useResource<Listing[]>("/listings");
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "";
  const guests = Math.max(1, Math.min(20, Number(params.get("guests")) || 1));
  const sort = params.get("sort") || "newest";
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  const listings = (resource.data || []).filter(
    (listing) =>
      listing.capacity >= guests &&
      `${listing.title} ${listing.city} ${listing.address}`
        .toLocaleLowerCase("ru-RU")
        .includes(query.trim().toLocaleLowerCase("ru-RU")),
  );
  if (sort === "price")
    listings.sort((a, b) => a.currency.localeCompare(b.currency) || a.pricePerNight - b.pricePerNight);
  if (sort === "capacity") listings.sort((a, b) => b.capacity - a.capacity);
  return (
    <div className="page account-page listings-page public-listings-v2">
      <div className="account-page-heading listings-heading">
        <div>
          <span className="account-kicker">Напрямую у отельера</span>
          <h1>Жильё для вашей поездки</h1>
          <p>
            Выбирайте объявление, уточняйте детали и отправляйте заявку на
            проживание.
          </p>
        </div>
        {user?.role === "host" && (
          <Link className="button secondary" to="/host?new=1">
            <Plus size={18} aria-hidden="true" />
            Добавить объявление
          </Link>
        )}
      </div>
      {resource.loading ? (
        <AccountLoading text="Загружаем объявления…" />
      ) : resource.error ? (
        <ResourceError error={resource.error} onRetry={resource.refresh} />
      ) : !resource.data?.length ? (
        <AccountEmpty
          icon={<Building2 size={36} />}
          title="Скоро здесь появится жильё от отельеров"
          action={
            <div className="account-form-actions">
              <Link className="button primary" to="/">
                Подобрать отель по условиям
              </Link>
              {user?.role !== "user" && (
                <Link
                  className="button secondary"
                  to={
                    user?.role === "host"
                      ? "/host?new=1"
                      : "/register?role=host"
                  }
                >
                  Разместить своё жильё
                </Link>
              )}
            </div>
          }
        >
          Новые объявления появятся после публикации владельцем. А пока можно
          изучить каталог отелей в подборе по пожеланиям.
        </AccountEmpty>
      ) : (
        <>
          <div className="listing-filters">
            <label className="field listing-search">
              <span>Город или название</span>
              <div className="listing-search-input">
                <Search size={19} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => filter("q", event.target.value)}
                  placeholder="Куда хотите поехать?"
                />
              </div>
            </label>
            <label className="field">
              <span>Гостей</span>
              <select
                value={guests}
                onChange={(event) => filter("guests", event.target.value)}
              >
                {Array.from({ length: 20 }, (_, index) => (
                  <option key={index + 1} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Порядок</span>
              <select
                value={sort}
                onChange={(event) => filter("sort", event.target.value)}
              >
                <option value="newest">Сначала новые</option>
                <option value="price">Дешевле в каждой валюте</option>
                <option value="capacity">Больше гостей</option>
              </select>
            </label>
            <button type="button" className="button secondary listing-reset-filters"
              disabled={!params.size} onClick={() => setParams({})}>
              <RotateCcw size={18} aria-hidden="true" />Сбросить все
            </button>
          </div>
          <div className="listing-result-summary">
            <p aria-live="polite">Найдено объявлений: {listings.length}</p>
            <p>
              Информацию и цены предоставляют отельеры. Наличие подтверждается
              после заявки.
            </p>
          </div>
          {!listings.length ? (
            <AccountEmpty
              icon={<Search size={30} />}
              title="По этим условиям ничего не найдено"
              action={
                <button
                  className="button secondary"
                  onClick={() => setParams({})}
                >
                  Сбросить фильтры
                </button>
              }
            >
              Попробуйте другой город или уменьшите число гостей.
            </AccountEmpty>
          ) : (
            <div className="public-listings">
              {listings.map((listing) => (
                <article className="public-listing" key={listing.id}>
                  <div className="public-listing-photo">
                    <AccommodationPhoto
                      name={listing.title}
                      photos={listing.photos}
                    />
                    <FavoriteButton
                      item={{
                        id: `listing:${listing.id}`,
                        name: listing.title,
                        path: `/stays/${listing.id}`,
                        photos: listing.photos,
                        address: listing.address,
                      }}
                    />
                  </div>
                  <div className="public-listing-content">
                    <p className="account-record-meta">
                      <MapPin size={16} aria-hidden="true" />
                      {listing.city}
                    </p>
                    <h2>
                      <Link to={`/stays/${listing.id}`}>{listing.title}</Link>
                    </h2>
                    <p className="public-listing-description">
                      {listing.description}
                    </p>
                    <p className="public-listing-capacity">
                      <UsersRound size={17} aria-hidden="true" />
                      До {listing.capacity} гостей
                      {listing.sleepingPlaces != null && ` · спальных мест: ${listing.sleepingPlaces}`}
                    </p>
                    <p className="public-listing-details">
                      {listing.roomType} ·{" "}
                      {roomDetailsLabel(
                        listing.floor,
                        listing.windowDirections,
                      )}
                    </p>
                    {listing.amenities.length > 0 && (
                      <ul className="listing-amenities">
                        {listing.amenities.map((amenity) => (
                          <li key={amenity}>{amenity}</li>
                        ))}
                      </ul>
                    )}
                    <ReviewHighlights listing={listing} compact />
                  </div>
                  <div className="public-listing-action">
                    <div>
                      <strong>{price(listing.pricePerNight, listing.currency)}</strong>
                      <span>за ночь за весь номер</span>
                    </div>
                    <Link
                      className="button primary"
                      to={`/stays/${listing.id}`}
                    >
                      Подробнее
                    </Link>
                    <small>Отельер: {listing.hostName}</small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
