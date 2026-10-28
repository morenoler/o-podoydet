import { CatalogAvailability } from "../../clarifications/DecisionNextSteps";
import { NearbyPlaces } from "../../places/NearbyPlaces";
import type { Dataset, Fact, Hotel } from "../../../../shared/types";
import { useApp } from "../../../app/providers/TripProvider";
import { DetailTripControls } from "./DetailTripControls";
import { FavoriteButton } from "../../favorites/FavoriteButton";
import { DetailLayout } from "./DetailLayout";
import { DetailGallery } from "./DetailGallery";
import { DetailSidebar } from "./DetailSidebar";
import { DetailHeading } from "./DetailHeading";
import { CatalogSummary } from "./CatalogSummary";
import { FactEvidence } from "./FactEvidence";
import { CatalogRoomDetails } from "./CatalogRoomDetails";
import { HotelLocation } from "./HotelLocation";
import { accommodationPath } from "../../../shared/lib/accommodation";
import { dateFull } from "../../../shared/lib/date";
import { HotelReviews } from "./HotelReputation";

export function HotelCatalogPreview({ hotel, facts, catalog, selectedRoomId, embedded = false }: {
  hotel: Hotel;
  facts: Fact[];
  catalog: Dataset;
  selectedRoomId?: string | null;
  embedded?: boolean;
}) {
  const { trip, setTrip } = useApp();
  const categories = hotel.rooms.filter((room) => room.evidenceStatus === "verified" || room.demo);
  const selectedRoom = categories.find((room) => room.id === selectedRoomId);
  const displayedRooms = selectedRoom ? [selectedRoom, ...categories.filter((room) => room.id !== selectedRoom.id)] : categories;
  const displayedFacts = selectedRoom
    ? facts.filter((fact) => !fact.roomId || fact.roomId === selectedRoom.id)
    : facts;
  const content = <>
      <DetailHeading hotelId={hotel.id} title={hotel.name} address={hotel.address} pricePerNight={hotel.pricePerNight} currency={hotel.currency} demo={hotel.synthetic} />
      <CatalogSummary hotel={hotel} room={selectedRoom || (categories.length === 1 ? categories[0] : undefined)} />
      {hotel.synthetic && <p className="notice">Вымышленное тестовое объявление.</p>}
      {selectedRoomId && !selectedRoom && <p className="notice">Запрошенная категория больше не доступна. Показаны сведения об отеле; выберите другую категорию.</p>}
      <DetailTripControls trip={trip} onChange={setTrip} />
      <section className="figcraft-detail-section" aria-labelledby="hotel-about-title">
        <h2 id="hotel-about-title">Категории номеров</h2>
        {!displayedRooms.length && <div className="detail-empty-room"><h3>Категории пока не собраны</h3><p>Уточните доступные номера и их стоимость на сайте объекта.</p></div>}
        <div className="detail-room-list">{displayedRooms.map((room) => <CatalogRoomDetails key={room.id} hotel={hotel} room={room} />)}</div>
      </section>
      {!hotel.synthetic && (selectedRoom || categories.length === 1) && <CatalogAvailability key={(selectedRoom || categories[0]).id} hotel={hotel} room={selectedRoom || categories[0]} trip={trip} />}
      <NearbyPlaces hotelId={hotel.id} />
      <HotelReviews hotelId={hotel.id} />
      {(displayedFacts.length > 0 || hotel.sourceEvidence) && <section className="figcraft-detail-section hotel-additional" aria-labelledby="hotel-additional-title">
        <h2 id="hotel-additional-title">Дополнительно</h2>
        <details className="hotel-detail-disclosure" key={selectedRoom?.id || hotel.id}>
          <summary>Источники сведений</summary>
          <div className="hotel-disclosure-content evidence-section">
            {hotel.sourceEvidence && <p>Источник: <a href={hotel.osmUrl} target="_blank" rel="noreferrer">OpenStreetMap</a>.
              Получено {dateFull(hotel.sourceEvidence.obtainedAt)}.
              {hotel.sourceEvidence.sourceDate ? ` Дата объекта: ${dateFull(hotel.sourceEvidence.sourceDate)}.` : " Дата объекта неизвестна."}
              {` Перепроверить до ${dateFull(hotel.sourceEvidence.expiresAt)}.`}</p>}
            <p className="muted">Сведения о категориях и отеле. Соответствие датам поездки ещё не проверено.</p>
            {displayedFacts.map((fact) => <FactEvidence key={fact.id} fact={fact} allowDemo={catalog.evidencePolicy === "demo"} />)}
          </div>
        </details>
      </section>}
  </>;
  if (embedded) return content;
  return <DetailLayout backTo="/results" gallery={<DetailGallery name={hotel.name} hotelId={hotel.id} photos={hotel.photos} />}
    saved={<FavoriteButton label item={{ id: selectedRoom ? `${hotel.id}::${selectedRoom.id}` : hotel.id, name: selectedRoom ? `${selectedRoom.name} · ${hotel.name}` : hotel.name, path: accommodationPath(hotel, selectedRoom?.id), hotelId: hotel.id, photos: hotel.photos, address: hotel.address }} />}
    sidebar={<DetailSidebar hotelId={hotel.id} region={hotel.region || trip.region} map={<HotelLocation hotel={hotel} catalog={catalog} />} />}>
    {content}
  </DetailLayout>;
}
