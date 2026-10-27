import { ExternalLink } from "lucide-react";
import type { Hotel, Room, RoomMatch } from "../../../../shared/types";
import { price, roomDetailsLabel } from "../../account/format";
import { CapacitySummary } from "./CapacitySummary";
import { SleepingArrangement } from "../../listings/SleepingArrangement";

export function CatalogRoomDetails({ hotel, room, match }: {
  hotel: Hotel;
  room: Room;
  match?: RoomMatch;
}) {
  return <div className="catalog-room-details">
    {match ? <CapacitySummary match={match} /> : <p className="catalog-room-capacity">
      {room.capacity == null ? "Вместимость нужно уточнить" : `До ${room.capacity} гостей`}
      {room.capacityMayVary && " · зависит от конфигурации номера"}
    </p>}
    <dl className="catalog-room-basics">
      <div><dt>Цена за ночь</dt><dd>
        {hotel.pricePerNight != null && hotel.currency === "KRW"
          ? <>{price(hotel.pricePerNight)} <small>по объявлению</small></>
          : "Нужно уточнить"}
      </dd></div>
      <div><dt>Этаж и окна</dt><dd>{roomDetailsLabel(hotel.floor, hotel.windowDirections)}</dd></div>
    </dl>
    <SleepingArrangement beds={room.beds} sleepingPlaces={room.sleepingPlaces} />
    <p className="catalog-availability-note">Наличие на даты поездки не проверено.</p>
    {room.quote && <blockquote className="catalog-room-description" aria-label="Описание категории из источника">{room.quote}</blockquote>}
    {room.sourceUrl && <a className="text-link" href={room.sourceUrl} target="_blank" rel="noreferrer">
      Описание на сайте отеля <ExternalLink size={14} aria-hidden="true" />
    </a>}
  </div>;
}
