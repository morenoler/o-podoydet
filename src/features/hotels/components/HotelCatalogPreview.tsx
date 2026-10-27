import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ExternalLink, MapPin } from "lucide-react";
import type { Dataset, Fact, Hotel } from "../../../../shared/types";
import { useApp } from "../../../app/providers/TripProvider";
import { SearchBar } from "../../search/SearchBar";
import { GeoMap } from "../../map/components/GeoMap";
import { FavoriteButton } from "../../favorites/FavoriteButton";
import { HotelPhotoGallery } from "./HotelPhotoGallery";
import { FactEvidence } from "./FactEvidence";
import { roomDetailsLabel } from "../../account/format";
import { accommodationPath } from "../../../shared/lib/accommodation";
import { dateFull } from "../../../shared/lib/date";

export function HotelCatalogPreview({
  hotel,
  facts,
  catalog,
  selectedRoomId,
}: {
  hotel: Hotel;
  facts: Fact[];
  catalog: Dataset;
  selectedRoomId?: string | null;
}) {
  const { trip, setTrip, regions } = useApp();
  const navigate = useNavigate();
  const categories = hotel.rooms.filter((room) => room.evidenceStatus === "verified" || room.demo);
  const selectedRoom = categories.find((room) => room.id === selectedRoomId);
  const displayedRooms = selectedRoom ? [selectedRoom] : categories;
  const displayedFacts = selectedRoom
    ? facts.filter((fact) => !fact.roomId || fact.roomId === selectedRoom.id)
    : facts;
  return (
    <div className="page hotel-detail-page">
      <Link to="/results" className="back-link">
        <ArrowLeft size={18} aria-hidden="true" />К номерам
      </Link>
      <SearchBar trip={trip} regions={regions} onSearch={(next) => {
        setTrip(next);
        if (next.region !== trip.region) navigate("/results");
      }} />
      <div className="detail-heading">
        <div>
          <h1>{selectedRoom?.name || hotel.name}</h1>
          {selectedRoom && <p className="hotel-detail-hotel-name">{hotel.name}</p>}
          <p className="address">
            <MapPin size={17} aria-hidden="true" />
            {hotel.address}
          </p>
          <p className="hotel-detail-room-meta">
            {roomDetailsLabel(hotel.floor, hotel.windowDirections)}
          </p>
        </div>
        <FavoriteButton
          label
          item={{
            id: selectedRoom ? `${hotel.id}::${selectedRoom.id}` : hotel.id,
            name: selectedRoom ? `${selectedRoom.name} · ${hotel.name}` : hotel.name,
            path: accommodationPath(hotel, selectedRoom?.id),
            hotelId: hotel.id,
            photos: hotel.photos,
            address: hotel.address,
          }}
        />
      </div>
      <HotelPhotoGallery hotel={hotel} />
      {selectedRoomId && !selectedRoom && <p className="notice">Запрошенная категория больше не доступна в каталоге. Ниже показаны сведения об отеле; выберите другую категорию.</p>}
      <div className="hotel-preview-prompt">
        <h2>{!categories.length ? "Категории номеров пока не собраны" : selectedRoom ? "Подойдёт ли вам этот номер?" : "Какой номер вам подойдёт?"}</h2>
        <p>
          {!categories.length ? "Объект отмечен в OpenStreetMap. Условия конкретной комнаты, вместимость, цену и наличие нужно уточнить у отеля." : <>Укажите даты и гостей в строке поиска. Проверим вместимость и ваши
          пожелания {selectedRoom ? "для выбранной категории номера." : "для каждой категории отдельно."}</>}
        </p>
      </div>
      <div className="detail-grid">
        <section>
          <h2>Расположение и путь к пляжу</h2>
          {hotel.synthetic ? (
            <p>
              Вымышленное тестовое объявление. Координаты условные, реальный
              маршрут не показан.
            </p>
          ) : (
            <>
              <GeoMap dataset={catalog} hotel={hotel} />
              <p className="muted map-caveat">
                {hotel.route
                  ? `${hotel.route.meters} м по пешеходной сети до ${hotel.route.beachName}. Вход приближённый; соединение отеля с сетью ${hotel.route.connectionMeters} м не включено в длину. Доступность всего пути не обследована.`
                  : "Пешеходный маршрут пока не рассчитан."}
              </p>
              {hotel.osmUrl && (
                <a
                  className="text-link"
                  href={hotel.osmUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Объект на OpenStreetMap{" "}
                  <ExternalLink size={15} aria-hidden="true" />
                </a>
              )}
            </>
          )}
        </section>
        <aside className="room-panel">
          <h2>{selectedRoom ? "Выбранная категория" : "Категории номеров"}</h2>
          <p>Цена и наличие не проверены.</p>
          {!displayedRooms.length && <p>Подтверждённых сведений о категориях нет.</p>}
          {displayedRooms.map((room) => (
            <div className="hotel-preview-room" key={room.id}>
              <h3>{room.name}</h3>
              <p>
                {room.capacity == null
                  ? "Вместимость не подтверждена"
                  : `До ${room.capacity} гостей`}
                {room.capacityMayVary
                  ? " · зависит от конфигурации номера"
                  : ""}
              </p>
              {room.quote && <p className="muted">{room.quote}</p>}
              {room.sourceUrl && (
                <a
                  className="text-link"
                  href={room.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Категория на сайте отеля{" "}
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              )}
            </div>
          ))}
          {selectedRoom && categories.length > 1 && <details className="hotel-preview-room">
            <summary>Другие категории в этом отеле</summary>
            <ul>
              {categories.filter((room) => room.id !== selectedRoom.id).map((room) => <li key={room.id}><Link to={accommodationPath(hotel, room.id)}>{room.name}</Link></li>)}
            </ul>
          </details>}
        </aside>
      </div>
      <section className="subsection evidence-section">
        <h2>Известные сведения и источники</h2>
        <p>
          {selectedRoom ? "Сведения относятся к выбранной категории и отелю." : categories.length ? "Условия относятся к указанным категориям." : "Сведения относятся к объекту размещения."} Соответствие вашим датам ещё
          не проверено.
        </p>
        {hotel.sourceEvidence && <p>Источник: <a href={hotel.sourceEvidence.sourceUrl} target="_blank" rel="noreferrer">OpenStreetMap</a>. Получено {dateFull(hotel.sourceEvidence.obtainedAt)}.
          {hotel.sourceEvidence.sourceDate ? ` Дата объекта: ${dateFull(hotel.sourceEvidence.sourceDate)}.` : " Дата объекта неизвестна."}
          {` Перепроверить до ${dateFull(hotel.sourceEvidence.expiresAt)}. Наличие объекта на карте не подтверждает его работу на даты поездки.`}</p>}
        {hotel.dataNotes?.map((note) => <p key={note}>{note}</p>)}
        {displayedFacts.map((fact) => (
          <FactEvidence
            key={fact.id}
            fact={fact}
            allowDemo={catalog.evidencePolicy === "demo"}
          />
        ))}
      </section>
    </div>
  );
}
