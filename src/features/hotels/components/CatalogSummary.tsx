import type { Hotel, Room } from "../../../../shared/types";
import { HotelRating } from "./HotelReputation";
export function CatalogSummary({ hotel, room }: { hotel: Hotel; room?: Room }) {
  return <div className="figcraft-detail-summary is-catalog-summary">
    <section className="detail-reviews-summary"><h2>Мнения гостей</h2>
      <HotelRating hotelId={hotel.id} />
      <a className="hotel-reviews-link" href="#hotel-reviews">К отзывам</a>
    </section>
    <section className="detail-amenities-summary"><h2>Удобства</h2>{room?.amenities?.length ? <>
      <ul className="figcraft-detail-chips">{room.amenities.slice(0, 6).map((label, index) => <li key={`${index}-${label}`}>{label}</li>)}</ul>
      <p className="detail-source-caption">Из описания категории</p>
      <details className="detail-text-disclosure"><summary><span>Показать всё</span></summary><p>{room.amenities.join(", ")}</p><p>Наличие в конкретном номере и условия использования нужно уточнить.</p></details>
    </> : <p className="detail-empty-note">Перечень удобств пока не указан.</p>}</section>
  </div>;
}
