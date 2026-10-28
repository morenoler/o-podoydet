import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  ArrowLeft,
  MapPin,
} from "lucide-react";
import type { Listing } from "../../shared/account";
import { useResource } from "../features/account/useResource";
import {
  AccountLoading,
  ResourceError,
} from "../features/account/components/AccountFeedback";
import { BookingRequest } from "../features/listings/BookingRequest";
import { ListingQuestions } from "../features/listings/ListingQuestions";
import { RoomDescription } from "../features/listings/RoomDescription";
import { ListingAmenities } from "../features/listings/ListingAmenities";
import { additionalAmenityLabels, isAmenityId } from "../../shared/amenities";
import { useApp } from "../app/providers/TripProvider";
import { ListingGallery } from "../features/listings/ListingGallery";
import { ListingClarificationPanel } from "../features/clarifications/ListingClarificationPanel";
import { FavoriteButton } from "../features/favorites/FavoriteButton";
import { Modal } from "../shared/ui/Modal";
import { useMediaQuery } from "../shared/lib/useMediaQuery";
import { directionLabels, price } from "../features/account/format";
import "../features/account/account.css";
import "../features/listings/listings-v2.css";
import "../features/search/search.css";
import "../features/clarifications/clarifications.css";
import "../features/places/places.css";

export function ListingPage() {
  const { effectivePreferences } = useApp();
  const { id = "" } = useParams();
  const resource = useResource<Listing>(`/listings/${encodeURIComponent(id)}`);
  const listing = resource.data;
  const { hash } = useLocation();
  useEffect(() => {
    if (
      !listing ||
      ![
        "#listing-about",
        "#listing-amenities",
        "#listing-questions",
        "#listing-questions-title",
        "#listing-fit",
        "#listing-fit-question",
        "#decision-next-steps",
        "#listing-booking",
      ].includes(hash)
    )
      return;
    const frame = requestAnimationFrame(() =>
      document
        .getElementById(hash.slice(1))
        ?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [hash, listing]);
  const mobile = useMediaQuery("(max-width: 700px)");
  const [bookingOpen, setBookingOpen] = useState(false);
  useEffect(() => {
    if (hash === "#listing-booking" && mobile && listing) setBookingOpen(true);
  }, [hash, mobile, listing]);
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
                <section className="listing-overview">
                  <RoomDescription
                    id="listing-about"
                    title={listing.roomType}
                    description={listing.description}
                    pricePerNight={listing.pricePerNight}
                    amenities={additionalAmenityLabels(listing.amenities)}
                    descriptiveAmenities
                    details={[
                      { label: "Гостей", value: `До ${listing.capacity}` },
                      { label: "Этаж номера", value: listing.floor == null ? "Не указано" : String(listing.floor) },
                      { label: "Куда выходят окна", value: listing.windowDirections?.length ? listing.windowDirections.map((value) => directionLabels[value]).join(", ") : "Не указано" },
                    ]}
                    source="Сведения и цена отельера. Независимая проверка не проведена."
                  />
                  <div className="listing-host">
                    <span className="account-avatar" aria-hidden="true">
                      {listing.hostName
                        .trim()
                        .slice(0, 1)
                        .toLocaleUpperCase("ru-RU")}
                    </span>
                    <div>
                      <strong>Принимает {listing.hostName}</strong>
                      <p>Автор объявления · детали можно уточнить до заявки</p>
                    </div>
                  </div>
                  <ListingAmenities id="listing-amenities" evidence={listing.amenityEvidence} requested={effectivePreferences.map((item) => item.feature).filter(isAmenityId)} />
                </section>
                <ListingClarificationPanel key={listing.id} listing={listing} />
                <div id="listing-questions">
                  <ListingQuestions
                    key={`questions-${listing.id}`}
                    listingId={listing.id}
                  />
                </div>
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
                    <strong>{price(listing.pricePerNight)}</strong>
                    <span>за ночь · цена отельера</span>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => setBookingOpen(true)}
                  >
                    Уточнить наличие
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
