import { useState } from "react";
import { ChevronLeft, ChevronRight, Images } from "lucide-react";
import { AccommodationPhoto } from "../../shared/ui/AccommodationPhoto";
import { Modal } from "../../shared/ui/Modal";
export function ListingGallery({
  name,
  photos = [],
}: {
  name: string;
  photos?: string[];
}) {
  const [open, setOpen] = useState(false),
    [index, setIndex] = useState(0);
  return (
    <>
      <div
        className={`listing-gallery${photos.length < 2 ? " single" : ""}${photos.length === 0 ? " is-empty" : ""}`}
      >
        <AccommodationPhoto name={name} photos={photos} eager />
        {photos.length > 1 && (
          <div className="listing-gallery-side">
            <AccommodationPhoto name={name} photos={photos} index={1} eager />
            <button className="button secondary" onClick={() => setOpen(true)}>
              <Images size={18} aria-hidden="true" />
              Все фото ({photos.length})
            </button>
          </div>
        )}
        {photos.length > 1 && (
          <button
            className="listing-gallery-mobile-count"
            onClick={() => setOpen(true)}
            aria-label={`Открыть все фотографии: ${photos.length}`}
          >
            1 / {photos.length}
          </button>
        )}
      </div>
      <Modal
        title={name}
        open={open}
        onClose={() => setOpen(false)}
        className="listing-gallery-modal"
      >
        <div className="listing-gallery-large">
          <AccommodationPhoto
            name={`${name}, фотография ${index + 1}`}
            photos={photos}
            index={index}
            eager
          />
        </div>
        <div className="gallery-controls">
          <button
            className="icon-button"
            aria-label="Предыдущее фото"
            onClick={() =>
              setIndex((index + photos.length - 1) % photos.length)
            }
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <span aria-live="polite">
            {index + 1} / {photos.length}
          </span>
          <button
            className="icon-button"
            aria-label="Следующее фото"
            onClick={() => setIndex((index + 1) % photos.length)}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </Modal>
    </>
  );
}
