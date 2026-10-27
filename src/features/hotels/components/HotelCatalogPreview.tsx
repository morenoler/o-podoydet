import { Link } from "react-router-dom";
import { ArrowLeft, MapPin } from "lucide-react";
import type { Dataset, Fact, Hotel } from "../../../../shared/types";
import { useApp } from "../../../app/providers/TripProvider";
import { SearchBar } from "../../search/SearchBar";
import { FavoriteButton } from "../../favorites/FavoriteButton";
import { HotelPhotoGallery } from "./HotelPhotoGallery";
import { FactEvidence } from "./FactEvidence";
import { CatalogRoomDetails } from "./CatalogRoomDetails";
import { HotelLocation } from "./HotelLocation";
import { accommodationPath } from "../../../shared/lib/accommodation";
import { lodgingLabel } from "../../../shared/lib/presentation";

export function HotelCatalogPreview({ hotel, facts, catalog, selectedRoomId }: {
  hotel: Hotel;
  facts: Fact[];
  catalog: Dataset;
  selectedRoomId?: string | null;
}) {
  const { trip, setTrip } = useApp();
  const selectedRoom = hotel.rooms.find((room) => room.id === selectedRoomId);
  const displayedRooms = selectedRoom ? [selectedRoom] : hotel.rooms;
  const displayedFacts = selectedRoom
    ? facts.filter((fact) => !fact.roomId || fact.roomId === selectedRoom.id)
    : facts;
  return (
    <div className="page hotel-detail-page">
      <Link to="/results" className="back-link"><ArrowLeft size={18} aria-hidden="true" />К номерам</Link>
      <div className="detail-heading">
        <div>
          <h1>{selectedRoom?.name || hotel.name}</h1>
          {selectedRoom && <p className="hotel-detail-hotel-name">{hotel.name}</p>}
          <p className="address"><MapPin size={17} aria-hidden="true" />{lodgingLabel(hotel)} · {hotel.address}</p>
        </div>
        <FavoriteButton label item={{
          id: selectedRoom ? `${hotel.id}::${selectedRoom.id}` : hotel.id,
          name: selectedRoom ? `${selectedRoom.name} · ${hotel.name}` : hotel.name,
          path: accommodationPath(hotel, selectedRoom?.id), hotelId: hotel.id,
          photos: hotel.photos, address: hotel.address,
        }} />
      </div>
      <HotelPhotoGallery hotel={hotel} />
      {hotel.synthetic && <p className="notice">Вымышленное тестовое объявление.</p>}
      {selectedRoomId && !selectedRoom && <p className="notice">Запрошенная категория больше не доступна. Показаны сведения об отеле; выберите другую категорию.</p>}
      <div className="detail-grid hotel-primary-information">
        <section className="hotel-room-overview" aria-labelledby="hotel-about-title">
          <h2 id="hotel-about-title">О размещении</h2>
          {!displayedRooms.length && <p className="muted">Категории номеров, вместимость и цена пока неизвестны.</p>}
          {displayedRooms.map((room) => <div className="hotel-preview-room" key={room.id}>
            {!selectedRoom && <h3>{room.name}</h3>}
            <CatalogRoomDetails hotel={hotel} room={room} />
          </div>)}
          {selectedRoom && hotel.rooms.length > 1 && <details className="hotel-detail-disclosure">
            <summary>Другие категории в этом отеле</summary>
            <ul className="hotel-other-rooms">
              {hotel.rooms.filter((room) => room.id !== selectedRoom.id).map((room) =>
                <li key={room.id}><Link to={accommodationPath(hotel, room.id)}>{room.name}</Link></li>)}
            </ul>
          </details>}
        </section>
        <HotelLocation hotel={hotel} catalog={catalog} />
      </div>
      <section className="subsection hotel-trip-fit" aria-labelledby="hotel-trip-title">
        <h2 id="hotel-trip-title">Для вашей поездки</h2>
        <p>Укажите даты и гостей, чтобы проверить вместимость и пожелания.</p>
        <SearchBar trip={trip} onSearch={setTrip} />
      </section>
      {displayedFacts.length > 0 && <section className="subsection hotel-additional" aria-labelledby="hotel-additional-title">
        <h2 id="hotel-additional-title">Дополнительно</h2>
        <details className="hotel-detail-disclosure" key={selectedRoom?.id || hotel.id}>
          <summary>Источники сведений</summary>
          <div className="hotel-disclosure-content evidence-section">
            <p className="muted">Сведения о категориях и отеле. Соответствие датам поездки ещё не проверено.</p>
            {displayedFacts.map((fact) => <FactEvidence key={fact.id} fact={fact} allowDemo={catalog.evidencePolicy === "demo"} />)}
          </div>
        </details>
      </section>}
    </div>
  );
}
