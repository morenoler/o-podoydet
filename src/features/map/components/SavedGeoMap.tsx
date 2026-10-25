import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  LocateFixed,
  Map,
  Minus,
  Plus,
} from "lucide-react";
import type { Dataset, Hotel, Point } from "../../../../shared/types";
import "../map.css";
import { MapGeometry } from "./MapGeometry";
import { selectedMapPoints, validPath, visibleMapHotels } from "../mapData";

const WIDTH = 600,
  HEIGHT = 700;
export function SavedGeoMap({
  dataset,
  hotel,
  hotels,
  compact = false,
  onSelect,
}: {
  dataset: Dataset;
  hotel?: Hotel;
  hotels?: Hotel[];
  compact?: boolean;
  onSelect?: (hotel: Hotel) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [hoveredId, setHoveredId] = useState("");
  const [focusedId, setFocusedId] = useState("");
  const [center, setCenter] = useState<Point>([WIDTH / 2, HEIGHT / 2]);
  const drag = useRef<{ x: number; y: number; center: Point } | null>(null);
  const previousSelection = useRef<string | undefined>(undefined);
  const initialized = useRef(false);
  const overview = !!hotels;
  const projection = useMemo(() => {
    let [minX, minY, maxX, maxY] = dataset.bbox;
    if (!overview && hotel?.coordinates) {
      const points = [hotel.coordinates, ...(hotel.route?.coordinates || [])];
      minX = Math.min(...points.map((p) => p[0])) - 0.0025;
      maxX = Math.max(...points.map((p) => p[0])) + 0.0025;
      minY = Math.min(...points.map((p) => p[1])) - 0.002;
      maxY = Math.max(...points.map((p) => p[1])) + 0.002;
    }
    const middleX = (minX + maxX) / 2,
      middleY = (minY + maxY) / 2;
    const cos = Math.cos((middleY * Math.PI) / 180);
    const scale = Math.min(
      WIDTH / ((maxX - minX) * cos),
      HEIGHT / (maxY - minY),
    );
    return (p: Point): Point => [
      WIDTH / 2 + (p[0] - middleX) * cos * scale,
      HEIGHT / 2 - (p[1] - middleY) * scale,
    ];
  }, [dataset, overview, overview ? undefined : hotel]);
  function focusSelected() {
    fitPoints(selectedMapPoints(hotel));
  }
  function fitPoints(points: Point[]) {
    if (!points.length) { setCenter([WIDTH / 2, HEIGHT / 2]); setZoom(1); return; }
    const projected = points.map(projection);
    const xs = projected.map((point) => point[0]), ys = projected.map((point) => point[1]);
    const west = Math.min(...xs), east = Math.max(...xs), north = Math.min(...ys), south = Math.max(...ys);
    setCenter([(west + east) / 2, (north + south) / 2]);
    setZoom(Math.max(1, Math.min(5, (WIDTH - 120) / Math.max(east - west, 1), (HEIGHT - 180) / Math.max(south - north, 1))));
  }
  const markers = visibleMapHotels(dataset, hotel, hotels);
  const markerKey = markers.map((item) => `${item.id}:${item.coordinates}`).join("|");
  useEffect(() => {
    if (!initialized.current || previousSelection.current === hotel?.id) {
      fitPoints(markers.map((item) => item.coordinates!));
    } else focusSelected();
    initialized.current = true;
    previousSelection.current = hotel?.id;
  }, [hotel?.id, markerKey, projection]);
  const path = (points: Point[]) =>
    points
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${projection(p)
            .map((n) => n.toFixed(1))
            .join(",")}`,
      )
      .join(" ");
  const route =
    !hotel?.synthetic && validPath(hotel?.route?.coordinates).length ? hotel!.route : null;
  const move = (dx: number, dy: number) =>
    setCenter((previous) => [
      Math.max(0, Math.min(WIDTH, previous[0] + dx / zoom)),
      Math.max(0, Math.min(HEIGHT, previous[1] + dy / zoom)),
    ]);
  function keyboard(event: KeyboardEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return;
    const directions: Record<string, Point> = {
      ArrowLeft: [-45, 0],
      ArrowRight: [45, 0],
      ArrowUp: [0, -45],
      ArrowDown: [0, 45],
    };
    if (directions[event.key]) {
      event.preventDefault();
      move(...directions[event.key]);
    }
    if (["+", "=", "-"].includes(event.key)) {
      event.preventDefault();
      setZoom((value) =>
        Math.max(1, Math.min(5, value + (event.key === "-" ? -0.5 : 0.5))),
      );
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusSelected();
    }
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (compact || (event.target as Element).closest("[data-marker]")) return;
    drag.current = { x: event.clientX, y: event.clientY, center };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.max(
      rect.width / (WIDTH / zoom),
      rect.height / (HEIGHT / zoom),
    );
    const x = drag.current.center[0] - (event.clientX - drag.current.x) / scale;
    const y = drag.current.center[1] - (event.clientY - drag.current.y) / scale;
    setCenter([
      Math.max(0, Math.min(WIDTH, x)),
      Math.max(0, Math.min(HEIGHT, y)),
    ]);
  }
  return (
    <div className={`v2-map${compact ? " is-compact" : ""}`}>
      <svg
        viewBox={`${center[0] - WIDTH / zoom / 2} ${center[1] - HEIGHT / zoom / 2} ${WIDTH / zoom} ${HEIGHT / zoom}`}
        preserveAspectRatio="xMidYMid meet"
        role={compact ? "img" : "group"}
        tabIndex={compact ? undefined : 0}
        aria-label={
          hotel
            ? `Карта ${hotel.name}${route ? `, маршрут к пляжу ${route.meters} метров` : ""}. Стрелки перемещают карту, плюс и минус меняют масштаб.`
            : "Карта отелей Хэундэ. Стрелки перемещают карту, плюс и минус меняют масштаб."
        }
        onKeyDown={keyboard}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <MapGeometry lines={dataset.map} projection={projection} />
        {validPath(route?.noStepsAlternative?.coordinates).length > 0 && (
          <path
            d={path(route!.noStepsAlternative!.coordinates)}
            fill="none"
            stroke="#758ea8"
            strokeWidth={3 / zoom}
            strokeDasharray={`${6 / zoom} ${5 / zoom}`}
          />
        )}
        {route && (
          <>
            <path
              d={path(route.coordinates)}
              fill="none"
              stroke="#fff"
              strokeWidth={7 / zoom}
              strokeLinejoin="round"
            />
            <path
              d={path(route.coordinates)}
              fill="none"
              stroke="#163e8e"
              strokeWidth={4 / zoom}
              strokeLinejoin="round"
            />
            {hotel?.coordinates && (
              <path
                d={path([hotel.coordinates, route.coordinates[0]])}
                fill="none"
                stroke="#163e8e"
                strokeWidth={3 / zoom}
                strokeDasharray={`${4 / zoom} ${5 / zoom}`}
              />
            )}
            <circle
              cx={projection(route.coordinates.at(-1)!)[0]}
              cy={projection(route.coordinates.at(-1)!)[1]}
              r={5 / zoom}
              fill="#dceef4"
              stroke="#163e8e"
              strokeWidth={2 / zoom}
            />
          </>
        )}
        {[
          ...markers.filter((item) => item.id !== hotel?.id),
          ...markers.filter((item) => item.id === hotel?.id),
        ].map((item) => {
          const [x, y] = projection(item.coordinates!);
          const selected = item.id === hotel?.id;
          const label = item.name.length > 30 ? `${item.name.slice(0, 29)}…` : item.name;
          const showLabel =
            selected || hoveredId === item.id || focusedId === item.id;
          const width = Math.max(88, Math.min(440, label.length * 6.8 + 24));
          return (
            <g
              key={item.id}
              data-marker="true"
              transform={`translate(${x},${y}) scale(${1 / zoom})`}
              className={`v2-map-marker${selected ? " is-selected" : ""}`}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect && !compact ? 0 : undefined}
              aria-label={`Показать на карте: ${item.name}`}
              aria-pressed={onSelect ? selected : undefined}
              onClick={() => onSelect?.(item)}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId("")}
              onFocus={() => setFocusedId(item.id)}
              onBlur={() => setFocusedId("")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect?.(item);
                }
              }}
            >
              <title>{item.name}</title>
              <circle r="22" fill="transparent" />
              <circle r="5" fill="#163e8e" stroke="#fff" strokeWidth="2" />
              {!compact && showLabel && (
                <>
                  <rect
                    x={-width / 2}
                    y="-49"
                    width={width}
                    height="36"
                    rx="18"
                    fill={selected ? "#163e8e" : "#fff"}
                    stroke={selected ? "#163e8e" : "#c8d5e6"}
                  />
                  <text
                    x="0"
                    y="-26"
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="800"
                    fill={selected ? "#fff" : "#172c4c"}
                  >
                    {label}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {!compact && (
        <>
          <div className="v2-map-heading">
            <Map size={22} aria-hidden="true" />
            <span>Сохранённая схема</span>
          </div>
          <div className="v2-map-controls">
            <button
              type="button"
              aria-label="Показать все отели"
              onClick={() => fitPoints(markers.map((item) => item.coordinates!))}
            >
              <Map size={22} />
            </button>
            <button
              type="button"
              aria-label="Вернуться к выбранному отелю"
              onClick={focusSelected}
            >
              <LocateFixed size={22} />
            </button>
            <button
              type="button"
              aria-label="Приблизить карту"
              onClick={() => setZoom((value) => Math.min(5, value + 0.5))}
              disabled={zoom >= 5}
            >
              <Plus size={24} />
            </button>
            <button
              type="button"
              aria-label="Отдалить карту"
              onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
              disabled={zoom <= 1}
            >
              <Minus size={24} />
            </button>
          </div>
          <details className="v2-map-navigation">
            <summary>Переместить карту</summary>
            <div>
              <button aria-label="Карту влево" onClick={() => move(-45, 0)}>
                <ArrowLeft size={18} />
              </button>
              <button aria-label="Карту вверх" onClick={() => move(0, -45)}>
                <ArrowUp size={18} />
              </button>
              <button aria-label="Карту вниз" onClick={() => move(0, 45)}>
                <ArrowDown size={18} />
              </button>
              <button aria-label="Карту вправо" onClick={() => move(45, 0)}>
                <ArrowRight size={18} />
              </button>
            </div>
          </details>
        </>
      )}
      <a
        className="v2-map-credit"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        © OpenStreetMap contributors
      </a>
    </div>
  );
}
