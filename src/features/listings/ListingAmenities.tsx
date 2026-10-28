import { Check, CircleHelp, Minus } from "lucide-react";
import { amenityFeatures, amenityIds, type AmenityEvidenceMap, type AmenityId } from "../../../shared/amenities";
import "./structured-amenities.css";

export function ListingAmenities({ evidence = {}, requested = [], id = "listing-structured-amenities" }: {
  evidence?: AmenityEvidenceMap;
  requested?: AmenityId[];
  id?: string;
}) {
  const shown = amenityIds.filter(key => (evidence[key]?.value !== undefined && evidence[key]?.value !== null) || requested.includes(key));
  return <section className="structured-amenities" id={id} aria-label="Удобства по сведениям владельца">
    <h2>Удобства</h2>
    <p>Указаны владельцем для этого варианта. Независимой проверки нет; доступность услуг и доплаты на ваши даты лучше уточнить.</p>
    {!shown.length ? <p>Владелец пока не заполнил отдельные поля удобств.</p> : (["room", "hotel"] as const).map(scope => {
      const items = shown.filter(key => amenityFeatures[key].scope === scope);
      return items.length > 0 && <div key={scope}><h3>{scope === "room" ? "В номере или квартире" : "На территории"}</h3><ul>
        {items.map(key => {
          const item = evidence[key];
          const value = item?.value;
          const Icon = value === true ? Check : value === false ? Minus : CircleHelp;
          return <li key={key} data-state={value === true ? "yes" : value === false ? "no" : "unknown"}>
            <Icon size={19} aria-hidden="true" /><div><strong>{amenityFeatures[key].label}</strong>
              <span>{value === true ? key === "pets_allowed" ? "Разрешено" : "Есть" : value === false ? key === "pets_allowed" ? "Запрещено" : "Нет" : "Нужно уточнить"}</span>
              {item?.obtainedAt && <small>Ответ владельца от {new Date(item.obtainedAt).toLocaleDateString("ru-RU")}</small>}
            </div>
          </li>;
        })}
      </ul></div>;
    })}
  </section>;
}
