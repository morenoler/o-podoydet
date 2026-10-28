import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import type { Listing } from "../../shared/account";
import { useResource } from "../features/account/useResource";
import {
  AccountLoading,
  ResourceError,
} from "../features/account/components/AccountFeedback";
import { BookingRequest } from "../features/listings/BookingRequest";
import { ListingQuestions } from "../features/listings/ListingQuestions";
import { ReviewHighlights } from "../features/listings/ReviewHighlights";
import { RoomDescription } from "../features/listings/RoomDescription";
import { ListingAmenities } from "../features/listings/ListingAmenities";
import { additionalAmenityLabels, isAmenityId } from "../../shared/amenities";
import { useApp } from "../app/providers/TripProvider";
import { DetailLayout } from "../features/hotels/components/DetailLayout";
import { DetailGallery } from "../features/hotels/components/DetailGallery";
import { DetailSidebar } from "../features/hotels/components/DetailSidebar";
import { DetailHeading } from "../features/hotels/components/DetailHeading";
import { regionNames } from "../../shared/regions";
import { changeTripRegion } from "../features/search/searchPolicy";
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
import "../features/places/places.css";

export function ListingPage() {
  const { effectivePreferences, trip, setTrip } = useApp();
  const { id = "" } = useParams();
  const resource = useResource<Listing>(`/listings/${encodeURIComponent(id)}`);
  const listing = resource.data?.id === id ? resource.data : null;
  const listingRegion = regionNames.find((region) => region.toLocaleLowerCase("ru-RU") === listing?.city.trim().toLocaleLowerCase("ru-RU"));
  useEffect(() => {
    if (listingRegion && listingRegion !== trip.region) setTrip(changeTripRegion(trip, listingRegion));
  }, [listingRegion, trip.region]);
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
        "#decision-next-steps",
        "#listing-booking",
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
  useEffect(() => {
    if (hash === "#listing-booking" && mobile && listing) setBookingOpen(true);
  }, [hash, mobile, listing]);
  if (resource.loading || (listingRegion && listingRegion !== trip.region)) return <div className="page"><AccountLoading text="Открываем объявление…" /></div>;
  if (resource.error) return <div className="page"><ResourceError error={resource.error} onRetry={resource.refresh} /></div>;
  if (!listing) return null;
  return <>
    <DetailLayout backTo="/stays" gallery={<DetailGallery name={listing.title} photos={listing.photos} />}
      saved={<FavoriteButton label={!mobile} item={{ id: `listing:${listing.id}`, name: listing.title, path: `/stays/${listing.id}`, photos: listing.photos, address: listing.address }} />}
      sidebar={<DetailSidebar hotelId={`account-listing:${listing.id}`} region={listingRegion} map={<section className="hotel-location" aria-label="Расположение">
        <h2>Расположение</h2>
        {listing.coordinates ? <ListingLocationMap coordinates={listing.coordinates} demo={listing.demo} /> : <p>Отельер пока не отметил расположение на карте.</p>}
      </section>} />}>
      <DetailHeading title={listing.title} address={`${listing.city}, ${listing.address}`} pricePerNight={listing.pricePerNight} currency={listing.currency} demo={listing.demo} />
      <div className="figcraft-detail-summary">
        <ReviewHighlights listing={listing} />
        <ListingAmenities id="listing-amenities" evidence={listing.amenityEvidence} requested={effectivePreferences.map((item) => item.feature).filter(isAmenityId)} />
      </div>
      <section className="figcraft-detail-section" id="listing-about">
        <RoomDescription title={listing.roomType} description={listing.description}
          pricePerNight={listing.pricePerNight} currency={listing.currency}
          amenities={additionalAmenityLabels(listing.amenities)} descriptiveAmenities
          details={[
            { label: "Гостей", value: `До ${listing.capacity}` },
            { label: "Этаж номера", value: listing.floor == null ? "Не указано" : String(listing.floor) },
            { label: "Куда выходят окна", value: listing.windowDirections?.length ? listing.windowDirections.map((value) => directionLabels[value]).join(", ") : "Не указано" },
          ]} source="Сведения отельера. Независимая проверка не проведена." />
        <SleepingArrangement beds={listing.beds} sleepingPlaces={listing.sleepingPlaces} />
      </section>
      <ListingClarificationPanel key={listing.id} listing={listing} />
      {!mobile && <section className="figcraft-detail-section"><BookingRequest key={listing.id} listing={listing} /></section>}
      <details className="hotel-detail-disclosure figcraft-detail-section" id="listing-additional" key={`questions-${listing.id}`}>
        <summary>Об отельере и вопросы</summary>
        <div className="listing-host"><span className="account-avatar" aria-hidden="true">{listing.hostName.trim().slice(0, 1).toLocaleUpperCase("ru-RU")}</span>
          <div><strong>{listing.hostName}</strong><p>Автор объявления</p></div>
        </div>
        <div id="listing-questions"><ListingQuestions key={`questions-${listing.id}`} listingId={listing.id} /></div>
      </details>
    </DetailLayout>
    {mobile && <>
      <div className="listing-mobile-booking"><div><strong>{price(listing.pricePerNight, listing.currency)}</strong><span>за ночь · цена отельера</span></div>
        <button className="button primary" onClick={() => setBookingOpen(true)}>Уточнить наличие</button>
      </div>
      <Modal title="Заявка на проживание" open={bookingOpen} onClose={() => setBookingOpen(false)} className="booking-sheet">
        <p className="booking-sheet-property">{listing.title}</p><BookingRequest key={listing.id} listing={listing} />
      </Modal>
    </>}
  </>;
}
