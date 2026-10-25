import { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import type { Dataset, Hotel, Point } from "../../../../shared/types";

export function GeoMap({
  dataset,
  hotel,
  compact = false,
}: {
  dataset: Dataset;
  hotel?: Hotel;
  compact?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const projection = useMemo(() => {
    let [minX, minY, maxX, maxY] = dataset.bbox;
    if (hotel?.route) {
      const points = [hotel.coordinates, ...hotel.route.coordinates];
      minX = Math.min(...points.map((p) => p[0])) - 0.0025;
      maxX = Math.max(...points.map((p) => p[0])) + 0.0025;
      minY = Math.min(...points.map((p) => p[1])) - 0.002;
      maxY = Math.max(...points.map((p) => p[1])) + 0.002;
    } else if (hotel) {
      minX = hotel.coordinates[0] - 0.004;
      maxX = hotel.coordinates[0] + 0.004;
      minY = hotel.coordinates[1] - 0.003;
      maxY = hotel.coordinates[1] + 0.003;
    }
    const middleX = (minX + maxX) / 2,
      middleY = (minY + maxY) / 2;
    const cos = Math.cos((middleY * Math.PI) / 180);
    const scale = Math.min(600 / ((maxX - minX) * cos), 520 / (maxY - minY));
    return (p: Point): Point => [
      300 + (p[0] - middleX) * cos * scale,
      260 - (p[1] - middleY) * scale,
    ];
  }, [dataset, hotel]);
  const path = (points: Point[]) =>
    points
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${projection(p)
            .map((n) => n.toFixed(1))
            .join(",")}`,
      )
      .join(" ");
  const markers = hotel
    ? [hotel]
    : dataset.hotels.filter((_, i) => i % 5 === 0).slice(0, 5);
  return (
    <div className={`geo-map ${compact ? "compact" : ""}`}>
      <svg
        viewBox={`${300 - 300 / zoom} ${260 - 260 / zoom} ${600 / zoom} ${520 / zoom}`}
        role="img"
        aria-label={
          hotel?.route
            ? `Схема пути от ${hotel.name} к пляжу. Вход приближённый.`
            : hotel
              ? `Расположение ${hotel.name}. Маршрут до пляжа не рассчитан.`
              : "Карта отелей Пусана, район Хэундэ, по данным OpenStreetMap"
        }
      >
        <rect x="-1000" y="-1000" width="3000" height="3000" fill="#eaf1ee" />
        {dataset.map
          .filter((l) => l.kind === "coastline")
          .map((line, i) => (
            <path
              key={`sea${i}`}
              d={`${path(line.coordinates)} L1300,1300 L-600,1300 Z`}
              fill="#c4e2ed"
              stroke="none"
            />
          ))}
        {dataset.map
          .filter((l) => l.kind === "beach")
          .map((line, i) => (
            <path
              key={`beach${i}`}
              d={`${path(line.coordinates)} Z`}
              fill="#f6e6bd"
              stroke="#e9d49d"
              strokeWidth="1"
            />
          ))}
        {dataset.map
          .filter((l) => !["beach", "coastline"].includes(l.kind))
          .map((line, i) => (
            <path
              key={i}
              d={path(line.coordinates)}
              stroke={
                ["footway", "path", "steps"].includes(line.kind)
                  ? "#c3d1cc"
                  : "#fff"
              }
              strokeWidth={
                ["primary", "secondary", "tertiary"].includes(line.kind)
                  ? 6
                  : ["footway", "path", "steps"].includes(line.kind)
                    ? 1.4
                    : 3
              }
              fill="none"
              strokeLinecap="round"
            />
          ))}
        {hotel?.route?.noStepsAlternative && (
          <path
            d={path(hotel.route.noStepsAlternative.coordinates)}
            fill="none"
            stroke="#758ea8"
            strokeWidth="5"
            strokeDasharray="6 5"
          />
        )}
        {hotel?.route && (
          <>
            <path
              d={path(hotel.route.coordinates)}
              stroke="#fff"
              strokeWidth="10"
              fill="none"
              strokeLinejoin="round"
            />
            <path
              d={path(hotel.route.coordinates)}
              stroke="#1855bb"
              strokeWidth="5"
              fill="none"
              strokeLinejoin="round"
            />
            <path
              d={path([hotel.coordinates, hotel.route.coordinates[0]])}
              stroke="#1855bb"
              strokeWidth="3"
              strokeDasharray="4 5"
              fill="none"
            />
            <circle
              cx={projection(hotel.route.coordinates.at(-1)!)[0]}
              cy={projection(hotel.route.coordinates.at(-1)!)[1]}
              r="8"
              fill="#f5b444"
              stroke="#fff"
              strokeWidth="3"
            />
          </>
        )}
        {markers.map((h, i) => {
          const [x, y] = projection(h.coordinates);
          return (
            <g key={h.id}>
              <circle
                cx={x}
                cy={y}
                r={compact ? 11 : 14}
                fill="#163e8e"
                stroke="#fff"
                strokeWidth="4"
              />
              <text
                x={x}
                y={y + 4}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill="#fff"
              >
                {hotel ? "О" : i + 1}
              </text>
            </g>
          );
        })}
        {!hotel && (
          <text x="230" y="480" fill="#527e97" fontSize="18">
            Побережье Хэундэ
          </text>
        )}
      </svg>
      {!compact && (
        <>
          <div className="map-heading">
            <span className="live-dot" />
            Пусан, Хэундэ
          </div>
          <div className="map-controls">
            <button
              type="button"
              aria-label="Приблизить карту"
              onClick={() => setZoom((z) => Math.min(3, z + 0.5))}
              disabled={zoom >= 3}
            >
              <Plus size={17} />
            </button>
            <button
              type="button"
              aria-label="Отдалить карту"
              onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
              disabled={zoom <= 1}
            >
              <Minus size={17} />
            </button>
          </div>
        </>
      )}
      {compact ? (
        <span className="map-credit">© OpenStreetMap contributors</span>
      ) : (
        <a
          className="map-credit"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap contributors
        </a>
      )}
    </div>
  );
}
