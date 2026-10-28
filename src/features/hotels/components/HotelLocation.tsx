import { ExternalLink } from "lucide-react";
import type { Dataset, Hotel } from "../../../../shared/types";
import { GeoMap } from "../../map/components/GeoMap";

export function HotelLocation({ hotel, catalog }: { hotel: Hotel; catalog: Dataset }) {
  return <section className="hotel-location" aria-label="Расположение">
    <h2>Расположение</h2>
    {hotel.synthetic ? <p className="muted">Координаты вымышленного объявления условные. Реальный маршрут не показан.</p> : <>
      <GeoMap dataset={catalog} hotel={hotel} />
      <p className="muted map-caveat">
        {hotel.route
          ? `${hotel.route.meters} м по пешеходной сети до пляжа «${hotel.route.beachName}». Подходы не включены в длину; доступность всего пути не проверена.`
          : "Пешеходный маршрут до пляжа пока неизвестен."}
      </p>
      {hotel.osmUrl && <a className="text-link" href={hotel.osmUrl} target="_blank" rel="noreferrer">
        Открыть на карте <ExternalLink size={14} aria-hidden="true" />
      </a>}
    </>}
  </section>;
}
