import { memo } from "react";
import type { MapLine, Point } from "../../../../shared/types";
/** Geographic paths stay stable while the viewport is dragged or zoomed. */
export const MapGeometry = memo(function MapGeometry({
  lines,
  projection,
}: {
  lines: MapLine[];
  projection: (point: Point) => Point;
}) {
  const path = (points: Point[]) =>
    points
      .map(
        (point, index) =>
          `${index ? "L" : "M"}${projection(point)
            .map((value) => value.toFixed(1))
            .join(",")}`,
      )
      .join(" ");
  return (
    <>
      {" "}
      <rect x="-1500" y="-1500" width="4000" height="4000" fill="#edf0eb" />
      {lines
        .filter((line) => line.kind === "coastline")
        .map((line, i) => (
          <path
            key={`sea${i}`}
            d={`${path(line.coordinates)} L1800,1800 L-1200,1800 Z`}
            fill="#dceef4"
          />
        ))}
      {lines
        .filter((line) => line.kind === "beach")
        .map((line, i) => (
          <path
            key={`beach${i}`}
            d={`${path(line.coordinates)} Z`}
            fill="#f6e8bd"
          />
        ))}
      {lines
        .filter((line) => !["coastline", "beach"].includes(line.kind))
        .map((line, i) => (
          <path
            key={i}
            d={path(line.coordinates)}
            fill="none"
            stroke={
              ["footway", "path", "steps"].includes(line.kind)
                ? "#d5dcd3"
                : "#fff"
            }
            strokeWidth={
              ["primary", "secondary", "tertiary"].includes(line.kind)
                ? 4
                : ["footway", "path", "steps"].includes(line.kind)
                  ? 0.8
                  : 2
            }
            strokeLinecap="round"
          />
        ))}
    </>
  );
});
