import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { BedType, ListingBed } from "../../../../shared/account";
import { bedTypes, sleepingLayoutError, sleepingPlacesTotal } from "../../../../shared/listingDetails";
import type { ListingFieldsProps } from "./listingForm";

export function ListingSleepingFields({ value, update, disabled = false }: ListingFieldsProps & { disabled?: boolean }) {
  const id = useId();
  const total = sleepingPlacesTotal(value.beds);
  const cribCount = value.beds.filter((bed) => bed.type === "crib").reduce((sum, bed) => sum + bed.count, 0);
  const error = sleepingLayoutError(value.beds, value.sleepingPlaces, value.capacity, value.status === "published");
  function replace(index: number, patch: Partial<ListingBed>) {
    update("beds", value.beds.map((bed, current) => current === index ? { ...bed, ...patch } : bed));
  }
  return <section className="editor-sleeping-section" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>Кровати и спальные места</h3>
    <p className="editor-section-hint">Укажите расстановку в предлагаемом варианте. Если кровати находятся в разных комнатах, назовите комнаты. Это поможет гостям решить, как разместиться.</p>
    <div className="editor-bed-rows">
      {value.beds.map((bed, index) => <div className="editor-bed-row" key={index} role="group" aria-label={`Спальное место ${index + 1}`}>
        <label className="field editor-bed-type">
          <span>Тип спального места</span>
          <select disabled={disabled} value={bed.type} onChange={(event) => {
            const type = event.target.value as BedType;
            replace(index, { type, placesPerUnit: bedTypes[type].places });
          }}>
            {(Object.keys(bedTypes) as BedType[]).map((type) => <option key={type} value={type}>{bedTypes[type].label}</option>)}
          </select>
        </label>
        <label className="field editor-bed-count">
          <span>Количество</span>
          <input type="number" required min={1} max={20} step={1} disabled={disabled} value={bed.count || ""}
            onChange={(event) => replace(index, { count: Number(event.target.value) })} />
        </label>
        <label className="field editor-bed-places">
          <span>Мест на одном</span>
          <input type="number" required min={1} max={4} step={1} disabled={disabled} readOnly={!bedTypes[bed.type].variable}
            value={bed.placesPerUnit || ""}
            onChange={(event) => replace(index, { placesPerUnit: Number(event.target.value) })} />
        </label>
        <label className="field editor-bed-room">
          <span>Комната <small>необязательно</small></span>
          <input maxLength={60} disabled={disabled} value={bed.room || ""} placeholder="Например, спальня или гостиная"
            onChange={(event) => replace(index, { room: event.target.value })} />
        </label>
        <button type="button" className="editor-bed-remove" disabled={disabled} aria-label={`Удалить спальное место ${index + 1}`}
          onClick={() => update("beds", value.beds.filter((_, current) => current !== index))}><Trash2 size={19} aria-hidden="true" /></button>
      </div>)}
    </div>
    <button type="button" className="button secondary" disabled={disabled || value.beds.length >= 20}
      onClick={() => update("beds", [...value.beds, { type: "single", count: 1, placesPerUnit: 1 }])}><Plus size={18} aria-hidden="true" />Добавить спальное место</button>
    <p className="editor-sleeping-total" aria-live="polite">
      Спальных мест: <strong>{value.beds.length ? total : "не указано"}</strong>.
      {cribCount > 0 && <> Детских кроваток отдельно: <strong>{cribCount}</strong>.</>}
      {" "}Максимум гостей: <strong>{value.capacity || "не указан"}</strong>.
    </p>
    <p className="editor-section-hint">Детская кроватка не входит в число спальных мест. Без названий комнат отдельные спальни не предполагаются.</p>
    {error && <p className="editor-field-error" role="status">{error}</p>}
  </section>;
}
