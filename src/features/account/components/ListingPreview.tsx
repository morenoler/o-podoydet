import { Info } from "lucide-react";
import { AccommodationPhoto } from "../../../shared/ui/AccommodationPhoto";
import { directionLabels } from "../format";
import type { EditableListing } from "./listingForm";

export function ListingPreview({ value }: { value: EditableListing }) {
  return (
    <aside className="editor-side-panel">
      <div className="editor-room-help">
        <h2>
          <Info size={23} aria-hidden="true" />
          Детали номера
        </h2>
        <p>Этаж и стороны света будут видны в объявлении.</p>
        <p>Укажите сведения именно о предлагаемом номере.</p>
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
