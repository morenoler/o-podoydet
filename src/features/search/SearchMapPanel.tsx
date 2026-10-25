import { Link } from "react-router-dom";
import { MapPin, ArrowRight } from "lucide-react";
import type { Dataset, Hotel } from "../../../shared/types";
import { GeoMap } from "../map/components/GeoMap";
import { accommodationPath } from "../../shared/lib/accommodation";

export function SearchMapPanel({
  catalog,
  selected,
  plotted,
  onSelect,
}: {
  catalog: Dataset | null;
  selected?: Hotel;
  plotted: Hotel[];
  onSelect: (hotel: Hotel) => void;
}) {
  const selectedMap =
    selected?.coordinates && !selected.synthetic ? selected : undefined;
  return (
    <aside className="search-map-section" aria-label="Карта найденных отелей">
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
                <strong>{selected.name}</strong>
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
                to={accommodationPath(selected)}
                aria-label={`Подробнее: ${selected.name}`}
              >
                <ArrowRight size={24} aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
      )}
      <p className="search-map-note">
        Сохранённая карта OpenStreetMap. Вход и маршрут приближённые. На карте —
        варианты из текущего списка с известными координатами.
      </p>
    </aside>
  );
}
