import { useMemo } from "react";
import type { Dataset, Hotel } from "../../../../shared/types";
import { GeoMap } from "../../map/components/GeoMap";
import { nearbyDisplayPlaces, placePresentation, validMapPlaces } from "../../places/placePresentation";
import { useSurroundings } from "../../places/useSurroundings";

export function HotelLocation({ hotel, catalog }: { hotel: Hotel; catalog: Dataset }) {
  const { data } = useSurroundings(hotel.id);
  const places = useMemo(() => {
    const seen = new Set<string>();
    return validMapPlaces(nearbyDisplayPlaces(data?.places || [], hotel.id)).filter(place => {
      const category = placePresentation(place.categories).label;
      if (seen.has(category)) return false;
      seen.add(category);
      return true;
    }).slice(0, 8);
  }, [data, hotel.id]);
  return <section className="hotel-location" aria-label="Расположение">
    <h2>Расположение</h2>
    {hotel.synthetic ? <p className="muted">Координаты вымышленного объявления условные. Реальный маршрут не показан.</p> : <>
      <GeoMap dataset={catalog} hotel={hotel} places={places} showRoute={false} />
    </>}
  </section>;
}
