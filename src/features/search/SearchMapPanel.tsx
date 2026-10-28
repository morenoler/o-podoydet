import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import type { Dataset, Hotel, Room } from "../../../shared/types";
import { GeoMap } from "../map/components/GeoMap";
import { accommodationPath } from "../../shared/lib/accommodation";
import { AccommodationPhoto } from "../../shared/ui/AccommodationPhoto";
import { price } from "../account/format";
import "./search-map-panel.css";

export function SearchMapPanel({
  catalog,
  selected,
  selectedRoom,
  plotted,
  focusHotels,
  onSelect,
}: {
  catalog: Dataset | null;
  selected?: Hotel;
  selectedRoom?: Room;
  plotted: Hotel[];
  focusHotels?: Hotel[];
  onSelect: (hotel: Hotel) => void;
}) {
  const selectedMap =
    selected?.coordinates && !selected.synthetic ? selected : undefined;
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const amount = selectedRoom?.pricePerNight ?? selected?.pricePerNight;
  const currency = selectedRoom?.currency ?? selected?.currency;
  const hasPrice = typeof amount === "number" && Number.isFinite(amount) && amount > 0 && !!currency;
  const detailsPath = selected ? accommodationPath(selected, selectedRoom?.id) : null;
  return (
    <aside className="search-map-section" aria-label="Расположение найденных номеров" ref={panel}>
      {catalog && (
        <div className="search-map-shell">
          <GeoMap
            dataset={catalog}
            hotels={plotted}
            focusHotels={focusHotels}
            hotel={selectedMap}
            showRoute={false}
            onSelect={(hotel) => { setDismissedId(null); onSelect(hotel); }}
          />
          {selected && dismissedId !== selected.id && (
            <div className="search-map-selection map-selection-card" aria-label={`На карте: ${selected.name}`}>
              <header>
                <strong>{detailsPath ? <Link to={detailsPath}>{selected.synthetic ? "Демо: " : ""}{selected.name}</Link> : selected.name}</strong>
                <button type="button" className="map-selection-close" aria-label="Закрыть карточку на карте" onClick={() => {
                  setDismissedId(selected.id);
                  panel.current?.querySelector<HTMLElement>('.geo-hotel-marker[aria-pressed="true"], .interactive-map-canvas, .v2-map-marker')?.focus();
                }}><X size={16} aria-hidden="true" /></button>
              </header>
              <AccommodationPhoto name={selected.name} hotelId={selected.id} photos={selected.photos} />
              <div className="map-selection-description">
                <p>{selected.address || "Адрес пока не указан"}</p>
              </div>
              <footer>
                <strong>{hasPrice ? price(amount!, currency!) : "Цена по запросу"}</strong>{hasPrice && <span className="sr-only">за ночь · наличие уточняйте</span>}
              </footer>
            </div>
          )}
        </div>
      )}
      <details className="search-map-note"><summary>О карте и данных</summary><p>
        Спутниковый фон — EOX Sentinel-2 за 2016 год, около 10 м на пиксель. Это обзор территории, а не актуальная съёмка отеля.
        Улицы, координаты и маршруты — OpenStreetMap. Вход и подходы к сети не проверены и не включены в длину маршрута. На карте — отели
        из выдачи с известными координатами. Если снимки недоступны, покажем улицы; без сети — сохранённую схему.
      </p></details>
    </aside>
  );
}
