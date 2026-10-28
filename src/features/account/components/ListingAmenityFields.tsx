import { amenityFeatures, amenityIds, type AmenityStates } from "../../../../shared/amenities";
import "../amenity-fields.css";

export function ListingAmenityFields({ value, onChange }: { value: AmenityStates; onChange: (value: AmenityStates) => void }) {
  return <fieldset className="editor-structured-amenities">
    <legend>Удобства этого варианта</legend>
    <p>Отметьте «Есть» или «Нет», если знаете точно. «Не указано» означает, что гостю нужно уточнение. Эти сведения будут видны как ваши ответы.</p>
    {(["room", "hotel"] as const).map(scope => <div key={scope} className="editor-amenity-group">
      <h3>{scope === "room" ? "В самом номере или квартире" : "На территории объекта"}</h3>
      {amenityIds.filter(id => amenityFeatures[id].scope === scope).map(id => <label className="editor-amenity-row" key={id}>
        <span><strong>{amenityFeatures[id].label}</strong><small>{amenityFeatures[id].detail}</small></span>
        <select aria-label={amenityFeatures[id].label} value={value[id] === true ? "yes" : value[id] === false ? "no" : "unknown"}
          onChange={event => onChange({ ...value, [id]: event.target.value === "unknown" ? null : event.target.value === "yes" })}>
          <option value="unknown">Не указано</option><option value="yes">{id === "pets_allowed" ? "Разрешено" : "Есть"}</option><option value="no">{id === "pets_allowed" ? "Запрещено" : "Нет"}</option>
        </select>
      </label>)}
    </div>)}
  </fieldset>;
}
