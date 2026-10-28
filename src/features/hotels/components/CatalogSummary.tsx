import type { Hotel, Room } from "../../../../shared/types";
import { catalogPhotos } from "../../../shared/lib/hotelPhotos";
export function CatalogSummary({ hotel, room }: { hotel: Hotel; room?: Room }) {
  const source = hotel.photos?.length ? undefined : catalogPhotos[hotel.id]?.source;
  return <div className="figcraft-detail-summary">
    <section><h2>Мнения гостей</h2><p className="muted">Отзывы этого объекта пока не загружены.</p>
      <details className="hotel-detail-disclosure"><summary>О фотографиях</summary>
        <p>Фотографии объекта не подтверждают условия выбранной категории или вид из конкретного номера.</p>
        {source && <a href={source} target="_blank" rel="noreferrer">Источник фотографий</a>}
      </details>
    </section>
    <section><h2>Удобства</h2>{room?.amenities?.length ? <>
      <ul className="figcraft-detail-chips">{room.amenities.map((label, index) => <li key={`${index}-${label}`}>{label}</li>)}</ul>
      <p className="muted">Из описания категории. Наличие в конкретном номере нужно уточнить.</p>
    </> : <p className="muted">Перечень удобств для категории пока не указан. Сведения по вашим условиям показаны ниже.</p>}</section>
  </div>;
}
