import { Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, MapPin } from "lucide-react";
import type { Dataset, Fact, Hotel } from "../../../../shared/types";
import { useApp } from "../../../app/providers/TripProvider";
import { SearchBar } from "../../search/SearchBar";
import { GeoMap } from "../../map/components/GeoMap";
import { FavoriteButton } from "../../favorites/FavoriteButton";
import { HotelPhotoGallery } from "./HotelPhotoGallery";
import { FactEvidence } from "./FactEvidence";
import { roomDetailsLabel } from "../../account/format";

export function HotelCatalogPreview({
  hotel,
  facts,
  catalog,
}: {
  hotel: Hotel;
  facts: Fact[];
  catalog: Dataset;
}) {
  const { trip, setTrip } = useApp();
  return (
    <div className="page hotel-detail-page">
      <Link to="/results" className="back-link">
        <ArrowLeft size={18} aria-hidden="true" />К отелям
      </Link>
      <SearchBar trip={trip} onSearch={setTrip} />
      <div className="detail-heading">
        <div>
          <h1>{hotel.name}</h1>
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
            id: hotel.id,
            name: hotel.name,
            path: `/hotels/${hotel.id}`,
            hotelId: hotel.id,
            photos: hotel.photos,
            address: hotel.address,
          }}
        />
      </div>
      <HotelPhotoGallery hotel={hotel} />
      <div className="hotel-preview-prompt">
        <h2>Подойдёт ли вам этот отель?</h2>
        <p>
          Укажите даты и гостей в строке поиска. Проверим вместимость и ваши
          пожелания для одной категории номера.
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
          <h2>Категории номеров</h2>
          <p>Цена и наличие не проверены.</p>
          {hotel.rooms.map((room) => (
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
        </aside>
      </div>
      <section className="subsection evidence-section">
        <h2>Известные сведения и источники</h2>
        <p>
          Условия относятся к указанным категориям. Соответствие вашим датам ещё
          не проверено.
        </p>
        {facts.map((fact) => (
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
