import { useEffect, useId, useRef, useState } from "react";
import type { ListingCoordinates } from "../../../../shared/account";
import { validListingCoordinates } from "../../../../shared/listingDetails";
import { listingMapCenter } from "../../../../shared/regions";
import { ListingLocationMap } from "../../listings/ListingLocationMap";
import type { ListingFieldsProps } from "./listingForm";

export function ListingLocationFields({ value, update, disabled, demo }: ListingFieldsProps & { disabled?: boolean; demo?: boolean }) {
  const id = useId();
  const [longitude, setLongitude] = useState(value.coordinates?.[0].toString() || "");
  const [latitude, setLatitude] = useState(value.coordinates?.[1].toString() || "");
  const lastManualCoordinates = useRef<ListingCoordinates | null | undefined>(undefined);
  useEffect(() => {
    // Preserve in-progress decimal text such as "129." and trailing zeros.
    // Map selections and external values still replace both manual fields.
    if (value.coordinates === lastManualCoordinates.current) {
      lastManualCoordinates.current = undefined;
      return;
    }
    lastManualCoordinates.current = undefined;
    setLongitude(value.coordinates?.[0].toString() || "");
    setLatitude(value.coordinates?.[1].toString() || "");
  }, [value.coordinates]);
  function input(nextLongitude: string, nextLatitude: string) {
    setLongitude(nextLongitude);
    setLatitude(nextLatitude);
    if (!nextLongitude && !nextLatitude) {
      lastManualCoordinates.current = null;
      update("coordinates", null);
    }
    else if (nextLongitude && nextLatitude) {
      const next: ListingCoordinates = [Number(nextLongitude), Number(nextLatitude)];
      if (validListingCoordinates(next)) {
        lastManualCoordinates.current = next;
        update("coordinates", next);
      }
    }
  }
  function clear() {
    setLongitude("");
    setLatitude("");
    lastManualCoordinates.current = undefined;
    update("coordinates", null);
  }
  return <section className="editor-location-section" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>Точка на карте</h3>
    <p className="editor-section-hint" id={`${id}-help`}>Нажмите на карту или перетащите отметку к объекту. Координаты также можно ввести вручную. Гости увидят эту точку как указанную отельером.</p>
    <ListingLocationMap coordinates={value.coordinates} initialCenter={listingMapCenter(value.city)} onChange={(coordinates) => update("coordinates", coordinates)} disabled={disabled} demo={demo} />
    <div className="field-row editor-coordinates-row">
      <label className="field">
        <span>Долгота</span>
        <input type="number" min={-180} max={180} step="any" inputMode="decimal" disabled={disabled}
          required={latitude !== ""} value={longitude} aria-describedby={`${id}-help`}
          placeholder="Например, 129.16" onChange={(event) => input(event.target.value, latitude)} />
      </label>
      <label className="field">
        <span>Широта</span>
        <input type="number" min={-90} max={90} step="any" inputMode="decimal" disabled={disabled}
          required={longitude !== ""} value={latitude} aria-describedby={`${id}-help`}
          placeholder="Например, 35.16" onChange={(event) => input(longitude, event.target.value)} />
      </label>
    </div>
    <button type="button" className="text-link" disabled={disabled || (!longitude && !latitude && !value.coordinates)} onClick={clear}>Убрать точку</button>
  </section>;
}
