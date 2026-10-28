import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AccommodationPhoto } from "../../../shared/ui/AccommodationPhoto";
import { accommodationPhotos } from "../../../shared/lib/hotelPhotos";
import { Modal } from "../../../shared/ui/Modal";
import { price } from "../../account/format";

export function DetailRoomCard({ name, description, amenities = [], photos = [], pricePerNight, currency, children, selected, onInspect }: {
  name: string; description?: string; amenities?: string[]; photos?: string[];
  pricePerNight?: number; currency?: "RUB" | "KRW"; children: ReactNode;
  selected?: boolean; onInspect?: () => void;
}) {
  const pictures = [...new Set(accommodationPhotos(undefined, photos))];
  const [photo, setPhoto] = useState<number | null>(null);
  const knownPrice = pricePerNight != null && Number.isFinite(pricePerNight) && pricePerNight > 0 && currency;
  return <article className={`detail-room-card${selected ? " is-selected" : ""}`} aria-label={name}>
    <div className="detail-room-photos">
      {Array.from({ length: 4 }, (_, index) => pictures[index] ? <button type="button" key={index} onClick={() => setPhoto(index)} aria-label={`Открыть фото ${index + 1}: ${name}`}>
        <AccommodationPhoto name={`${name}, фото ${index + 1}`} photos={pictures} index={index} />
      </button> : <div key={index} className="detail-room-photo-empty" aria-hidden={index > pictures.length || undefined}>
        {index === pictures.length && <><ImageOff size={20} aria-hidden="true" /><span>{pictures.length ? "Других фото пока нет" : "Фото категории пока нет"}</span></>}
      </div>)}
    </div>
    <h3>{name}</h3>
    <p className="detail-room-description">{description || "Описание категории пока не предоставлено. Уточните конфигурацию и условия перед бронированием."}</p>
    {!!amenities.length && <ul className="figcraft-detail-chips">{amenities.slice(0, 6).map((amenity, index) => <li key={`${index}-${amenity}`}>{amenity}</li>)}</ul>}
    <details className="detail-text-disclosure"><summary><span>Подробнее</span></summary><div className="detail-room-evidence">{children}</div></details>
    <div className="detail-room-offer">
      <span>{knownPrice ? "Весь номер · за ночь" : "Стоимость на ваши даты"}</span>
      <strong>{knownPrice ? price(pricePerNight!, currency!) : "По запросу"}</strong>
    </div>
    <div className="detail-room-offer-note"><span>Наличие и итоговую стоимость нужно подтвердить.</span>{onInspect && <button type="button" onClick={onInspect}>{selected ? "Условия этого номера показаны ниже" : "Проверить мои условия"}</button>}</div>
    <Modal title={name} open={photo != null} onClose={() => setPhoto(null)} className="listing-gallery-modal">
      {photo != null && <div className="listing-gallery-large"><AccommodationPhoto name={`${name}, фото ${photo + 1}`} photos={pictures} index={photo} eager /></div>}
      {pictures.length > 1 && <div className="gallery-controls">
        <button type="button" className="icon-button" aria-label="Предыдущее фото" onClick={() => setPhoto((index) => index == null ? null : (index + pictures.length - 1) % pictures.length)}><ChevronLeft aria-hidden="true" /></button>
        <span aria-live="polite">{(photo ?? 0) + 1} / {pictures.length}</span>
        <button type="button" className="icon-button" aria-label="Следующее фото" onClick={() => setPhoto((index) => index == null ? null : (index + 1) % pictures.length)}><ChevronRight aria-hidden="true" /></button>
      </div>}
    </Modal>
  </article>;
}
