import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";
import { price } from "../account/format";
import "./room-description.css";

/** Public room information only; private search notes never belong here. */
export function RoomDescription({
  title,
  description,
  pricePerNight,
  amenities = [],
  details,
  source,
  id,
  amenitiesId,
  descriptiveAmenities = false,
}: {
  title: string;
  description?: string;
  pricePerNight?: number;
  amenities?: string[];
  details: { label: string; value: string }[];
  source: ReactNode;
  id?: string;
  amenitiesId?: string;
  descriptiveAmenities?: boolean;
}) {
  const headingId = useId();
  return (
    <section className="room-description" id={id} aria-labelledby={headingId}>
      <h2 id={headingId}>О номере</h2>
      <p className="room-description-type">{title}</p>
      <p className="room-description-text">
        {description?.trim() || "Описание номера пока не указано."}
      </p>
      <div className="room-description-price">
        {typeof pricePerNight === "number" && pricePerNight > 0 ? (
          <><strong>{price(pricePerNight)}</strong><span>за ночь за весь номер</span></>
        ) : (
          <><strong>Цена не указана</strong><span>Уточните стоимость на ваши даты у отельера</span></>
        )}
      </div>
      <h3>Характеристики номера</h3>
      <dl className="room-description-details">
        {details.map(({ label, value }) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      {(!descriptiveAmenities || amenities.length > 0) && <div className="room-description-amenities" id={amenitiesId}>
        <h3>{descriptiveAmenities ? "Дополнительно в описании владельца" : "Удобства"}</h3>
        {amenities.length > 0 ? (
          <ul>
            {amenities.map((amenity, index) => (
              <li key={`${index}-${amenity}`}>{!descriptiveAmenities && <Check size={19} aria-hidden="true" />}<span>{amenity}</span></li>
            ))}
          </ul>
        ) : <p>Список удобств пока не указан. Уточните его у отельера.</p>}
      </div>}
      <div className="room-description-source">{source}</div>
    </section>
  );
}
