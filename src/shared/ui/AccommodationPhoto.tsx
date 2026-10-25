import { useState } from "react";
import { ImageOff } from "lucide-react";
import { accommodationPhotos } from "../lib/hotelPhotos";

export function AccommodationPhoto({
  name,
  hotelId,
  photos,
  className = "",
  index = 0,
  eager = false,
}: {
  name: string;
  hotelId?: string;
  photos?: string[];
  className?: string;
  index?: number;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const url = accommodationPhotos(hotelId, photos)[index];
  return url && !failed.includes(url) ? (
    <img
      className={`accommodation-photo ${className}`}
      src={url}
      alt={name}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed((items) => [...items, url])}
    />
  ) : (
    <div
      className={`accommodation-photo photo-placeholder ${className}`}
      role="img"
      aria-label={`Фотография ${name} не добавлена`}
    >
      <ImageOff size={28} aria-hidden="true" />
      <span>Фото пока нет</span>
    </div>
  );
}
