import type { Hotel } from "../../../../shared/types";
import { AccommodationPhoto } from "../../../shared/ui/AccommodationPhoto";
import { accommodationPhotos } from "../../../shared/lib/hotelPhotos";

export function HotelPhotoGallery({ hotel }: { hotel: Hotel }) {
  const photos = accommodationPhotos(hotel.id, hotel.photos);
  if (!photos.length) return null;
  return (
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
  );
}
