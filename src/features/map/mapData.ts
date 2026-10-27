import type { Dataset, Hotel, Point } from "../../../shared/types";

/** Source points are [longitude, latitude]; Leaflet takes the opposite order. */
export function isMapPoint(point: unknown): point is Point {
  return Array.isArray(point) && point.length === 2 &&
    point.every((value) => typeof value === "number" && Number.isFinite(value)) &&
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 85.05112878;
}

export function latLng(point: Point): [number, number] {
  return [point[1], point[0]];
}

export function visibleMapHotels(dataset: Dataset, hotel?: Hotel, hotels?: Hotel[]): Hotel[] {
  return (hotels ?? (hotel ? [hotel] : dataset.hotels))
    .filter((item) => !item.synthetic && (!item.region || item.region === dataset.region) && isMapPoint(item.coordinates));
}

export function validPath(points: Point[] | undefined): Point[] {
  // Dropping a malformed interior point would fabricate a connecting segment.
  return points && points.length > 1 && points.every(isMapPoint) ? points : [];
}

export function selectedMapPoints(hotel?: Hotel): Point[] {
  if (!hotel || hotel.synthetic || !isMapPoint(hotel.coordinates)) return [];
  return [hotel.coordinates, ...validPath(hotel.route?.coordinates),
    ...validPath(hotel.route?.noStepsAlternative?.coordinates)];
}

export const MAP_MARKER_SIZE = 44;
export const MAP_MARKER_GAP = 4;

export function groupMapHotels(hotels: Hotel[], project?: (point: Point) => Point): Hotel[][] {
  if (project) {
    // Anchors never move: every pair of rendered 44px touch boxes stays disjoint.
    // Recompute with the map's current pixel projection after every zoom.
    const groups: { anchor: Point; hotels: Hotel[] }[] = [];
    for (const hotel of hotels) {
      if (hotel.synthetic || !isMapPoint(hotel.coordinates)) continue;
      const position = project(hotel.coordinates);
      const nearby = groups.find(({ anchor }) =>
        Math.max(Math.abs(position[0] - anchor[0]), Math.abs(position[1] - anchor[1])) < MAP_MARKER_SIZE + MAP_MARKER_GAP);
      if (nearby) nearby.hotels.push(hotel);
      else groups.push({ anchor: position, hotels: [hotel] });
    }
    return groups.map((group) => group.hotels);
  }
  const groups = new Map<string, Hotel[]>();
  for (const hotel of hotels) {
    if (hotel.synthetic || !isMapPoint(hotel.coordinates)) continue;
    const key = hotel.coordinates.join(",");
    const group = groups.get(key) ?? [];
    group.push(hotel);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function datasetMapPoints(dataset: Dataset): Point[] {
  const [west, south, east, north] = dataset.bbox;
  const points: Point[] = [[west, south], [east, north]];
  if (points.every(isMapPoint) && west < east && south < north) return points;
  const hotelPoints = visibleMapHotels(dataset).map((hotel) => hotel.coordinates!);
  return hotelPoints.length ? hotelPoints : [[-180, -85], [180, 85]];
}
