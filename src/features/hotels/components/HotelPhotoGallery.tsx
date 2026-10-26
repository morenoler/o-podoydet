import type { Hotel } from "../../../../shared/types";
import { AccommodationPhoto } from "../../../shared/ui/AccommodationPhoto";
import { accommodationPhotos, catalogPhotos } from "../../../shared/lib/hotelPhotos";

export function HotelPhotoGallery({ hotel }: { hotel: Hotel }) {
  const photos = accommodationPhotos(hotel.id, hotel.photos);
  const source = hotel.photos?.length ? undefined : catalogPhotos[hotel.id]?.source;
  if (!photos.length) return null;
  return (
    <>
      <div
        className={`hotel-detail-gallery${photos.length > 1 ? " has-room-photo" : ""}`}
      >
        <AccommodationPhoto
          name={hotel.name}
          hotelId={hotel.id}
          photos={hotel.photos}
          eager
        />
        {photos.length > 1 && (
          <AccommodationPhoto
            name={`${hotel.name}: дополнительное фото`}
            hotelId={hotel.id}
            photos={hotel.photos}
            index={1}
          />
        )}
      </div>
      <p className="muted map-caveat">
        Фотографии объекта не подтверждают условия выбранной категории или вид из конкретного номера.
        {source && <> <a href={source} target="_blank" rel="noreferrer">Источник фотографий</a>.</>}
      </p>
    </>
  );
}
