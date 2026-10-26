import { useCallback, useEffect, useState } from "react";
import { CloudOff, Layers, Map } from "lucide-react";
import type { Dataset, Hotel } from "../../../../shared/types";
import { InteractiveMap } from "./InteractiveMap";
import { SavedGeoMap } from "./SavedGeoMap";
import { validPath } from "../mapData";
import "../interactive-map.css";

export interface GeoMapProps {
  dataset: Dataset;
  hotel?: Hotel;
  hotels?: Hotel[];
  compact?: boolean;
  onSelect?: (hotel: Hotel) => void;
}

export function GeoMap(props: GeoMapProps) {
  const [saved, setSaved] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );
  const [reason, setReason] = useState("");
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
    <div className="geo-map-view">
      <div className="geo-map-mode">
        <span className="geo-map-mode-label"><Map size={17} aria-hidden="true" />{saved ? "Сохранённая схема" : "Карта улиц и мест"}</span>
        <button
          type="button"
          onClick={() => {
            setSaved((value) => !value);
            setReason("");
          }}
        >
          {saved ? <Layers size={16} aria-hidden="true" /> : <CloudOff size={16} aria-hidden="true" />}
          {saved ? "Подробная карта" : "Без сети"}
        </button>
      </div>
      {saved ? <SavedGeoMap {...props} /> : <InteractiveMap {...props} onUnavailable={unavailable} />}
      {reason && <p className="geo-map-status" role="status">{reason}</p>}
      {props.hotel?.route && !props.hotel.synthetic && validPath(props.hotel.route.coordinates).length > 0 && (
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
