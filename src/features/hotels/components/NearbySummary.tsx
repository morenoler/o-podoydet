import { Check } from "lucide-react";
import type { NearbyPlace } from "../../../../shared/types";
import { nearbyLabel } from "../../../../shared/nearby";

export function NearbySummary({ matches }: { matches: NearbyPlace[] }) {
  if (!matches.length) return null;
  return <div className="hotel-nearby-summary">
    <ul aria-label="Совпадения по карте">
      {matches.map((place) => <li key={place.kind}>
        <Check size={15} aria-hidden="true" />
        <a href={place.sourceUrl} target="_blank" rel="noreferrer" title={`${place.name}. Источник: OpenStreetMap. Получено ${place.obtainedAt.slice(0, 10)}.`}>
          {nearbyLabel(place.kind)} · ≈{Math.round(place.meters).toLocaleString("ru-RU")} м
        </a>
      </li>)}
    </ul>
    <small>По прямой, по данным OSM. Проход и часы работы не проверены.</small>
  </div>;
}
