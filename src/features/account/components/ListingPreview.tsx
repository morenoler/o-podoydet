import { Info } from "lucide-react";
import { AccommodationPhoto } from "../../../shared/ui/AccommodationPhoto";
import { countLabel, directionLabels } from "../format";
import type { EditableListing } from "./listingForm";
import { bedTypes, sleepingPlacesTotal } from "../../../../shared/listingDetails";

export function ListingPreview({ value }: { value: EditableListing }) {
  return (
    <aside className="editor-side-panel">
      <div className="editor-room-help">
        <h2>
          <Info size={23} aria-hidden="true" />
          Детали номера
        </h2>
        <p>Кровати, комнаты и расположение будут видны гостям.</p>
        <p>Укажите фактическую расстановку. Гости сами решат, подходит ли она их семье.</p>
      </div>
      <section
        className="editor-listing-preview"
        id="listing-preview"
        tabIndex={-1}
        aria-label="Предпросмотр объявления"
      >
        <AccommodationPhoto
          name={value.title || "Ваше объявление"}
          photos={value.photos}
        />
        <div>
          <h2>{value.title || "Название объявления"}</h2>
          <p>
            {value.roomType || "Тип номера"} · до {value.capacity || 1} гостей
          </p>
          <p className="preview-sleeping-total">
            {value.beds.length ? `Спальных мест: ${sleepingPlacesTotal(value.beds)}` : "Спальные места не указаны"}
          </p>
          {value.beds.length > 0 && <ul className="preview-beds">
            {value.beds.map((bed, index) => <li key={index}>
              {bedTypes[bed.type].label}: {bed.count} шт.
              {bed.type === "crib" ? " (отдельно)" : `, по ${countLabel(bed.placesPerUnit, ["месту", "места", "мест"])}.`}
              {bed.room?.trim() && <> {bed.room.trim()}.</>}
            </li>)}
          </ul>}
          <p>{value.coordinates ? "Точка на карте указана отельером" : "Точка на карте не указана"}</p>
          <strong>
            {value.floor == null ? "Этаж: Не указано" : `${value.floor} этаж`}
          </strong>
          <p className="preview-directions">
            {value.windowDirections.length
              ? `Окна на ${value.windowDirections.map((direction) => directionLabels[direction]).join(", ")}`
              : "Окна: Не указано"}
          </p>
        </div>
      </section>
    </aside>
  );
}
