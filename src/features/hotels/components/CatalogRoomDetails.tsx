import { ExternalLink } from "lucide-react";
import type { Hotel, Room, RoomMatch } from "../../../../shared/types";
import { price, roomDetailsLabel } from "../../account/format";
import { CapacitySummary } from "./CapacitySummary";
import { SleepingArrangement } from "../../listings/SleepingArrangement";
import { DetailRoomCard } from "./DetailRoomCard";
import { accommodationPrice } from "../presentationPrice";

export function CatalogRoomDetails({ hotel, room, match, selected, onInspect }: {
  hotel: Hotel;
  room: Room;
  match?: RoomMatch;
  selected?: boolean;
  onInspect?: () => void;
}) {
  const offer = accommodationPrice(hotel, room);
  return <DetailRoomCard name={room.name} description={room.description || room.quote} amenities={room.amenities}
    pricePerNight={offer?.amount} currency={offer?.currency} selected={selected} onInspect={onInspect}>
    <div className="catalog-room-details">
    {match ? <CapacitySummary match={match} /> : <p className="catalog-room-capacity">
      {room.capacity == null ? "Вместимость нужно уточнить" : `До ${room.capacity} гостей`}
      {room.capacityMayVary && " · зависит от конфигурации номера"}
    </p>}
    <dl className="catalog-room-basics">
      <div><dt>Цена за ночь</dt><dd>
        {offer
          ? <>{price(offer.amount, offer.currency)} <small>по объявлению</small></>
          : "Нужно уточнить"}
      </dd></div>
      <div><dt>Этаж и окна</dt><dd>{roomDetailsLabel(hotel.floor, hotel.windowDirections)}</dd></div>
    </dl>
    <SleepingArrangement beds={room.beds} sleepingPlaces={room.sleepingPlaces} />
    <p className="catalog-availability-note">Наличие на даты поездки не проверено.</p>
    {(room.description || room.quote) && <blockquote className="catalog-room-description" aria-label="Описание категории из источника">{room.description || room.quote}</blockquote>}
    {!!room.amenities?.length && <div className="catalog-room-amenities">
      <h3>Удобства в описании категории</h3>
      <p>{room.amenities.join(", ")}</p>
      <p className="muted">Условия использования и наличие в конкретном номере уточняйте по источнику. Описание не заменяет проверку выбранных фильтров.</p>
    </div>}
    {room.sourceUrl && <a className="text-link" href={room.sourceUrl} target="_blank" rel="noreferrer">
      Описание на сайте отеля <ExternalLink size={14} aria-hidden="true" />
    </a>}
    </div>
  </DetailRoomCard>;
}
