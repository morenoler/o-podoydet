import { MapPin, ExternalLink } from "lucide-react";
import type { HotelCandidate } from "../../../../shared/types";
import { lodgingLabels } from "../../search/CatalogFilterFields";
import { NearbySummary } from "./NearbySummary";
import { dateFull } from "../../../shared/lib/date";
import { AccommodationPhoto } from "../../../shared/ui/AccommodationPhoto";
import { LocationCriteria } from "../../places/LocationCriteria";
import { CriterionLine } from "./CriterionLine";

export function MappedHotelCard({ candidate, selected, onSelect, onShowMap }: {
  candidate: HotelCandidate; selected: boolean; onSelect: () => void; onShowMap: () => void;
}) {
  const { hotel, nearbyMatches, limitations } = candidate;
  return <article className={`mapped-hotel-card${selected ? " is-selected" : ""}`} aria-label={hotel.name} onFocus={onSelect}>
    <AccommodationPhoto name={hotel.name} hotelId={hotel.id} photos={hotel.photos} className="mapped-hotel-photo" />
    <div>
    <div className="mapped-hotel-heading">
      <div><h3>{hotel.name}</h3><p>{hotel.lodgingType && `${lodgingLabels[hotel.lodgingType]} · `}{hotel.address}</p></div>
      <button type="button" className="button secondary" onClick={onShowMap} aria-label={`На карте: ${hotel.name}`}><MapPin size={17} aria-hidden="true" />На карте</button>
    </div>
    <NearbySummary matches={nearbyMatches} region={hotel.region} />
    {candidate.provisional && <p className="mapped-hotel-provisional">Есть обязательные условия для уточнения</p>}
    <p className="mapped-hotel-limits">Категории, вместимость, цена и наличие не собраны.</p>
    <details className="mapped-hotel-sources">
      <summary>Источник и ограничения</summary>
      {candidate.criteria?.map((criterion) => <CriterionLine key={criterion.feature} criterion={criterion} detailed />)}
      <LocationCriteria criteria={candidate.locationCriteria} detailed />
      <a href={hotel.osmUrl} target="_blank" rel="noreferrer">Объект в OpenStreetMap <ExternalLink size={14} aria-hidden="true" /></a>
      {hotel.sourceEvidence && <p>Получено {dateFull(hotel.sourceEvidence.obtainedAt)}.
        {hotel.sourceEvidence.sourceDate ? ` Дата объекта: ${dateFull(hotel.sourceEvidence.sourceDate)}.` : " Дата объекта неизвестна."}
        {` Перепроверить до ${dateFull(hotel.sourceEvidence.expiresAt)}.`}</p>}
      {limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}
    </details>
    </div>
  </article>;
}
