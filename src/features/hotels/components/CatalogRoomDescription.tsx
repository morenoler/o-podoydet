import type { Hotel, Room } from "../../../../shared/types";
import { directionLabels } from "../../account/format";
import { RoomDescription } from "../../listings/RoomDescription";

export function CatalogRoomDescription({ hotel, room }: { hotel: Hotel; room: Room }) {
  return (
    <RoomDescription
      title={room.name}
      description={room.description || room.quote}
      amenities={room.amenities}
      pricePerNight={room.currency === "KRW" ? room.pricePerNight : undefined}
      details={[
        { label: "Гостей", value: room.capacity == null ? "Не указано" : `До ${room.capacity}${room.capacityMayVary ? " · зависит от конфигурации номера" : ""}` },
        { label: "Этаж номера", value: hotel.floor == null ? "Не указано" : String(hotel.floor) },
        { label: "Куда выходят окна", value: hotel.windowDirections?.length ? hotel.windowDirections.map((value) => directionLabels[value]).join(", ") : "Не указано" },
      ]}
      source={
        room.demo || hotel.synthetic ? "Сведения вымышленного тестового объявления." : room.sourceUrl ? (
          <>
            <a href={room.sourceUrl} target="_blank" rel="noreferrer">Источник: категория на сайте отеля</a>
            {room.obtainedAt && <> · получено {new Date(room.obtainedAt).toLocaleDateString("ru-RU", { timeZone: "Asia/Seoul" })}</>}
            <br />Сведения относятся к категории. Наличие конкретного номера на ваши даты нужно уточнить.
          </>
        ) : "Сведения о категории номера нужно уточнить у отельера."
      }
    />
  );
}
