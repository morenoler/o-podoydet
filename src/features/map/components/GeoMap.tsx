import { useCallback, useEffect, useState } from "react";
import { Map } from "lucide-react";
import type { Dataset, Hotel } from "../../../../shared/types";
import { InteractiveMap } from "./InteractiveMap";
import { SavedGeoMap } from "./SavedGeoMap";
import { validPath } from "../mapData";
import { BASEMAPS, DEFAULT_BASEMAP, SATELLITE_UNAVAILABLE, type Basemap } from "../basemaps";
import type { SurroundingPlace } from "../../places/placePresentation";
import "../interactive-map.css";

export interface GeoMapProps {
  dataset: Dataset;
  hotel?: Hotel;
  hotels?: Hotel[];
  /** Initial viewport only: every hotel in `hotels` remains selectable. */
  focusHotels?: Hotel[];
  places?: SurroundingPlace[];
  showRoute?: boolean;
  compact?: boolean;
  onSelect?: (hotel: Hotel) => void;
}

export function GeoMap(props: GeoMapProps) {
  const [saved, setSaved] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );
  const [reason, setReason] = useState("");
  const [basemap, setBasemap] = useState<Basemap>(DEFAULT_BASEMAP);
  const unavailable = useCallback((message: string) => {
    setReason(message);
    setSaved(true);
  }, []);
  useEffect(() => {
    const offline = () => unavailable("Нет сети. Показываем сохранённую схему.");
    window.addEventListener("offline", offline);
    return () => window.removeEventListener("offline", offline);
  }, [unavailable]);

  if (props.compact) return <SavedGeoMap {...props} />;
  return (
    <div className={`geo-map-view${saved ? " is-saved" : ` is-${basemap}`}`}>
      <div className="geo-map-mode">
        <span className="geo-map-mode-label"><Map size={17} aria-hidden="true" />{saved ? "Сохранённая схема" : basemap === "satellite" ? "Спутниковая карта" : "Карта улиц и мест"}</span>
        <div className="geo-map-basemaps" role="group" aria-label="Вид карты">
          {(["satellite", "streets"] as const).map((mode) => <button key={mode} type="button"
            aria-pressed={!saved && basemap === mode} onClick={() => {
              if (!BASEMAPS[mode].available) {
                setReason(SATELLITE_UNAVAILABLE);
                return;
              }
              setBasemap(mode); setSaved(false); setReason("");
            }}>{mode === "satellite" ? "Спутник" : "Карта"}</button>)}
        </div>
      </div>
      {saved ? <SavedGeoMap {...props} /> : <InteractiveMap {...props} basemap={basemap} onUnavailable={unavailable}
        onTilesUnavailable={(mode, message) => {
          if (mode === "satellite") {
            setBasemap("streets");
            setReason("Спутниковые снимки недоступны. Показываем карту OpenStreetMap.");
          } else unavailable(message);
        }} />}
      {!saved && basemap === "satellite" && <span className="geo-map-imagery-date" title="Esri World Imagery. Дата и детализация зависят от участка; снимки не подтверждают нынешнее состояние отеля.">Esri World Imagery</span>}
      {saved && <span className="geo-map-saved-label">Сохранённая схема</span>}
      {reason && <p className="geo-map-status" role="status">{reason}</p>}
      {props.showRoute !== false && props.hotel?.route && !props.hotel.synthetic && validPath(props.hotel.route.coordinates).length > 0 && (
        <p className="geo-map-legend">
          <span><i className="geo-map-route-line" aria-hidden="true" />Маршрут до пляжа</span>
          <span><i className="geo-map-route-join" aria-hidden="true" />Подход к маршруту не проверен</span>
          {validPath(props.hotel.route.noStepsAlternative?.coordinates).length > 0 && (
            <span><i className="geo-map-route-alternative" aria-hidden="true" />Обход отмеченных лестниц</span>
          )}
        </p>
      )}
    </div>
  );
}
