import { Link } from "react-router-dom";
import { MapPin, ArrowRight } from "lucide-react";
import type { Dataset, Hotel, Room } from "../../../shared/types";
import { GeoMap } from "../map/components/GeoMap";
import { accommodationPath } from "../../shared/lib/accommodation";

export function SearchMapPanel({
  catalog,
  selected,
  selectedRoom,
  plotted,
  onSelect,
}: {
  catalog: Dataset | null;
  selected?: Hotel;
  selectedRoom?: Room;
  plotted: Hotel[];
  onSelect: (hotel: Hotel) => void;
}) {
  const selectedMap =
    selected?.coordinates && !selected.synthetic ? selected : undefined;
  return (
    <aside className="search-map-section" aria-label="Расположение найденных номеров">
      {catalog && (
        <div className="search-map-shell">
          <GeoMap
            dataset={catalog}
            hotels={plotted}
            hotel={selectedMap}
            onSelect={onSelect}
          />
          {selected && (
            <div className="search-map-selection">
              <span className="search-map-selection-icon">
                <MapPin size={24} aria-hidden="true" />
              </span>
              <div>
                <strong>{selectedRoom?.name || selected.name}</strong>
                {selectedRoom && <p>{selected.name}</p>}
                <p>
                  {selected.synthetic
                    ? "Вымышленный пример · координаты условные"
                    : selected.coordinates
                      ? selected.route
                        ? `Пешком до пляжа: ${selected.route.meters} м`
                        : "Маршрут до пляжа не рассчитан"
                      : "Координаты отельер пока не указал"}
                </p>
              </div>
              <Link
                to={accommodationPath(selected, selectedRoom?.id)}
                aria-label={`Подробнее: ${selectedRoom ? `${selectedRoom.name}, ` : ""}${selected.name}`}
              >
                <ArrowRight size={24} aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
      )}
      <p className="search-map-note">
        Сохранённая карта OpenStreetMap. Вход и маршрут приближённые. На карте —
        отели выбранных категорий номеров с известными координатами.
      </p>
    </aside>
  );
}
