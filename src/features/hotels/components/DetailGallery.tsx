import { useState } from "react";
import { ChevronLeft, ChevronRight, Images } from "lucide-react";
import { accommodationPhotos } from "../../../shared/lib/hotelPhotos";
import { AccommodationPhoto } from "../../../shared/ui/AccommodationPhoto";
import { Modal } from "../../../shared/ui/Modal";

export function DetailGallery({ name, hotelId, photos }: { name: string; hotelId?: string; photos?: string[] }) {
  const available = accommodationPhotos(hotelId, photos);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const count = Math.min(4, available.length);
  return <>
    <div className={`figcraft-detail-gallery photos-${count}`}>
      {available.length ? available.slice(0, 4).map((_, photoIndex) => <button className="figcraft-detail-photo" key={photoIndex}
        aria-label={`Открыть фотографию ${photoIndex + 1} из ${available.length}`} onClick={() => { setIndex(photoIndex); setOpen(true); }}>
        <AccommodationPhoto name={`${name}, фото ${photoIndex + 1}`} photos={available} index={photoIndex} eager={photoIndex === 0} />
      </button>) : <AccommodationPhoto name={name} photos={[]} />}
      {available.length > 1 && <button className="figcraft-all-photos" onClick={() => { setIndex(0); setOpen(true); }}>
        <Images size={16} aria-hidden="true" />Все фото · {available.length}
      </button>}
    </div>
    {available.length > 0 && <Modal title={name} open={open} onClose={() => setOpen(false)} className="listing-gallery-modal">
      <div className="listing-gallery-large"><AccommodationPhoto name={`${name}, фото ${index + 1}`} photos={available} index={index} eager /></div>
      <div className="gallery-controls">
        <button type="button" className="icon-button" disabled={available.length < 2} aria-label="Предыдущее фото" onClick={() => setIndex((index + available.length - 1) % available.length)}><ChevronLeft aria-hidden="true" /></button>
        <span aria-live="polite">{index + 1} / {available.length}</span>
        <button type="button" className="icon-button" disabled={available.length < 2} aria-label="Следующее фото" onClick={() => setIndex((index + 1) % available.length)}><ChevronRight aria-hidden="true" /></button>
      </div>
    </Modal>}
  </>;
}
