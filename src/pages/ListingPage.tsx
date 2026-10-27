import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Compass,
  MapPin,
  UsersRound,
  ListOrdered,
} from "lucide-react";
import type { Listing } from "../../shared/account";
import { useResource } from "../features/account/useResource";
import {
  AccountLoading,
  ResourceError,
} from "../features/account/components/AccountFeedback";
import { BookingRequest } from "../features/listings/BookingRequest";
import { ListingQuestions } from "../features/listings/ListingQuestions";
import { ReviewHighlights } from "../features/listings/ReviewHighlights";
import { ListingGallery } from "../features/listings/ListingGallery";
import { SleepingArrangement } from "../features/listings/SleepingArrangement";
import { ListingLocationMap } from "../features/listings/ListingLocationMap";
import { ListingClarificationPanel } from "../features/clarifications/ListingClarificationPanel";
import { FavoriteButton } from "../features/favorites/FavoriteButton";
import { Modal } from "../shared/ui/Modal";
import { useMediaQuery } from "../shared/lib/useMediaQuery";
import { directionLabels, price } from "../features/account/format";
import "../features/account/account.css";
import "../features/listings/listings-v2.css";
import "../features/search/search.css";
import "../features/clarifications/clarifications.css";

export function ListingPage() {
  const { id = "" } = useParams();
  const resource = useResource<Listing>(`/listings/${encodeURIComponent(id)}`);
  const listing = resource.data;
  const { hash } = useLocation();
  useEffect(() => {
    if (
      !listing ||
      ![
        "#listing-about",
        "#listing-reviews",
        "#listing-amenities",
        "#listing-additional",
        "#listing-questions",
        "#listing-questions-title",
        "#listing-fit",
        "#listing-fit-question",
      ].includes(hash)
    )
      return;
    if (["#listing-questions", "#listing-questions-title", "#listing-fit", "#listing-fit-question"].includes(hash)) {
      const additional = document.getElementById("listing-additional");
      if (additional instanceof HTMLDetailsElement) additional.open = true;
    }
    const target = document.getElementById(hash.slice(1))
      || (hash === "#listing-fit-question" ? document.getElementById("listing-fit") : null);
    let disclosure = target?.closest<HTMLDetailsElement>("details");
    while (disclosure) {
      disclosure.open = true;
      disclosure = disclosure.parentElement?.closest<HTMLDetailsElement>("details");
    }
    const frame = requestAnimationFrame(() =>
      target?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [hash, listing]);
  const mobile = useMediaQuery("(max-width: 700px)");
  const [bookingOpen, setBookingOpen] = useState(false);
  return (
    <div className="page account-page listing-page listing-v2">
      <Link className="listing-back" to="/stays">
        <ArrowLeft size={20} aria-hidden="true" />
        Все объявления
      </Link>
      {resource.loading ? (
        <AccountLoading text="Открываем объявление…" />
      ) : resource.error ? (
        <ResourceError error={resource.error} onRetry={resource.refresh} />
      ) : (
        listing && (
          <>
            <div className="listing-title">
              <div>
                <h1>{listing.title}</h1>
                {listing.demo && <p className="account-muted">Демо · вымышленное объявление</p>}
                <p>
                  <MapPin size={20} aria-hidden="true" />
                  <span>
                    {listing.city}, {listing.address}
                  </span>
                </p>
              </div>
              <FavoriteButton
                label={!mobile}
                item={{
                  id: `listing:${listing.id}`,
                  name: listing.title,
                  path: `/stays/${listing.id}`,
                  photos: listing.photos,
                  address: listing.address,
                }}
              />
            </div>
            <ListingGallery name={listing.title} photos={listing.photos} />
            <div className="listing-detail-layout">
              <div className="listing-main">
                <section className="listing-overview" id="listing-about">
                  <div className="listing-overview-heading">
                    <h2>{listing.roomType}</h2>
                    <p className="listing-overview-price">
                      <strong>{price(listing.pricePerNight, listing.currency)}</strong>
                      <span>за ночь</span>
                    </p>
                  </div>
                  <dl className="listing-room-details">
                    <div>
                      <dt>
                        <UsersRound size={20} aria-hidden="true" />
                        Гостей
                      </dt>
                      <dd>До {listing.capacity}</dd>
                    </div>
                    <div>
                      <dt>
                        <ListOrdered size={20} aria-hidden="true" />
                        Этаж номера
                      </dt>
                      <dd>
                        {listing.floor == null ? "Не указано" : listing.floor}
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Compass size={20} aria-hidden="true" />
                        Куда выходят окна
                      </dt>
                      <dd>
                        {listing.windowDirections?.length
                          ? listing.windowDirections
                              .map((value) => directionLabels[value])
                              .join(", ")
                          : "Не указано"}
                      </dd>
                    </div>
                  </dl>
                  <p className="listing-owner-source">
                    По сведениям отельера
                  </p>
                  <SleepingArrangement beds={listing.beds} sleepingPlaces={listing.sleepingPlaces} />
                  <p className="listing-description">{listing.description}</p>
                  <section
                    className="listing-amenity-section"
                    id="listing-amenities"
                  >
                    <h2>Удобства</h2>
                    {listing.amenities.length ? (
                      <ul className="listing-amenities">
                        {listing.amenities.map((amenity) => (
                          <li key={amenity}>
                            <Check size={20} aria-hidden="true" />
                            <span>{amenity}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="account-muted">
                        Удобства не указаны.
                      </p>
                    )}
                  </section>
                  <section className="listing-amenity-section" aria-label="Расположение">
                    <h2>Расположение</h2>
                    {listing.coordinates ? <ListingLocationMap coordinates={listing.coordinates} demo={listing.demo} /> :
                      <p className="account-muted">Отельер пока не отметил расположение на карте.</p>}
                  </section>
                </section>
                <ReviewHighlights listing={listing} />
                <details
                  className="listing-additional"
                  id="listing-additional"
                  key={listing.id}
                >
                  <summary>
                    <span>Уточнения и вопросы</span>
                    <ChevronDown size={20} aria-hidden="true" />
                  </summary>
                  <div className="listing-host">
                    <span className="account-avatar" aria-hidden="true">
                      {listing.hostName
                        .trim()
                        .slice(0, 1)
                        .toLocaleUpperCase("ru-RU")}
                    </span>
                    <div>
                      <strong>{listing.hostName}</strong>
                      <p>Автор объявления</p>
                    </div>
                  </div>
                  <ListingClarificationPanel key={listing.id} listing={listing} />
                  <div id="listing-questions">
                    <ListingQuestions
                      key={`questions-${listing.id}`}
                      listingId={listing.id}
                    />
                  </div>
                </details>
              </div>
              {!mobile && (
                <aside className="listing-booking-column">
                  <BookingRequest key={listing.id} listing={listing} />
                </aside>
              )}
            </div>
            {mobile && (
              <>
                <div className="listing-mobile-booking">
                  <div>
                    <strong>{price(listing.pricePerNight, listing.currency)}</strong>
                    <span>за ночь · цена отельера</span>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => setBookingOpen(true)}
                  >
                    Выбрать даты
                  </button>
                </div>
                <Modal
                  title="Заявка на проживание"
                  open={bookingOpen}
                  onClose={() => setBookingOpen(false)}
                  className="booking-sheet"
                >
                  <p className="booking-sheet-property">{listing.title}</p>
                  <BookingRequest key={listing.id} listing={listing} />
                </Modal>
              </>
            )}
          </>
        )
      )}
    </div>
  );
}
