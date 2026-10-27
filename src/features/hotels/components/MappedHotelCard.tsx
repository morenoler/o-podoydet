import { MapPin, ExternalLink } from "lucide-react";
import type { HotelCandidate } from "../../../../shared/types";
import { lodgingLabels } from "../../search/CatalogFilterFields";
import { NearbySummary } from "./NearbySummary";
import { dateFull } from "../../../shared/lib/date";

export function MappedHotelCard({ candidate, selected, onSelect, onShowMap }: {
  candidate: HotelCandidate; selected: boolean; onSelect: () => void; onShowMap: () => void;
}) {
  const { hotel, nearbyMatches, limitations } = candidate;
  return <article className={`mapped-hotel-card${selected ? " is-selected" : ""}`} aria-label={hotel.name} onFocus={onSelect}>
    <div className="mapped-hotel-heading">
      <div><h3>{hotel.name}</h3><p>{hotel.lodgingType && `${lodgingLabels[hotel.lodgingType]} · `}{hotel.address}</p></div>
      <button type="button" className="button secondary" onClick={onShowMap} aria-label={`На карте: ${hotel.name}`}><MapPin size={17} aria-hidden="true" />На карте</button>
    </div>
    <NearbySummary matches={nearbyMatches} region={hotel.region} />
    <p className="mapped-hotel-limits">Категории, вместимость, цена и наличие не собраны.</p>
    <details className="mapped-hotel-sources">
      <summary>Источник и ограничения</summary>
      <a href={hotel.osmUrl} target="_blank" rel="noreferrer">Объект в OpenStreetMap <ExternalLink size={14} aria-hidden="true" /></a>
      {hotel.sourceEvidence && <p>Получено {dateFull(hotel.sourceEvidence.obtainedAt)}.
        {hotel.sourceEvidence.sourceDate ? ` Дата объекта: ${dateFull(hotel.sourceEvidence.sourceDate)}.` : " Дата объекта неизвестна."}
        {` Перепроверить до ${dateFull(hotel.sourceEvidence.expiresAt)}.`}</p>}
      {limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}
    </details>
  </article>;
}
