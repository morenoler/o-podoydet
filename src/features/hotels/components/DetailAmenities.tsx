import { amenityFeatures, amenityIds, type AmenityEvidenceMap, type AmenityId } from "../../../../shared/amenities";
import { ListingAmenities } from "../../listings/ListingAmenities";

export function DetailAmenities({ evidence = {}, requested = [] }: { evidence?: AmenityEvidenceMap; requested?: AmenityId[] }) {
  const ids = amenityIds.filter((id) => evidence[id]?.value === true || requested.includes(id));
  return <section className="detail-amenities-summary" id="listing-amenities">
    <h2>Удобства</h2>
    {ids.length ? <ul className="figcraft-detail-chips">{ids.slice(0, 6).map((id) => <li key={id}>
      {evidence[id]?.value === true ? amenityFeatures[id].label : `${evidence[id]?.value === false ? "Нет" : "Уточнить"}: ${amenityFeatures[id].label.toLocaleLowerCase("ru-RU")}`}
    </li>)}</ul> : <p className="detail-empty-note">Владелец пока не указал удобства.</p>}
    <p className="detail-source-caption">По сведениям отельера</p>
    <details className="detail-text-disclosure"><summary><span>Показать всё</span></summary>
      <ListingAmenities id="listing-amenity-evidence" evidence={evidence} requested={requested} />
    </details>
  </section>;
}
