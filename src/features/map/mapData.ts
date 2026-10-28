import type { Dataset, Hotel, Point } from "../../../shared/types";
import { isRegionName, listingMapCenter } from "../../../shared/regions";
import type { SurroundingPlace } from "../places/placePresentation";

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

export function detailMapPoints(hotel?: Hotel, places: SurroundingPlace[] = [], showRoute = true): Point[] {
  if (!hotel || hotel.synthetic || !isMapPoint(hotel.coordinates)) return [];
  return [hotel.coordinates, ...places.filter(place => isMapPoint(place.coordinates)).map(place => place.coordinates!),
    ...(showRoute ? selectedMapPoints(hotel).slice(1) : [])];
}

export const MAP_MARKER_SIZE = 44;
export const MAP_MARKER_GAP = 4;

export function hotelCountLabel(count: number): string {
  const mod10 = count % 10, mod100 = count % 100;
  return `${count} ${mod10 === 1 && mod100 !== 11 ? "отель" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "отеля" : "отелей"}`;
}

/** A smaller initial viewport never filters the map's full set of markers. */
export function resultMapPoints(dataset: Dataset, hotels: Hotel[], focusHotels?: Hotel[]): Point[] {
  const visible = visibleMapHotels(dataset, undefined, hotels);
  const byId = new Map(visible.map((hotel) => [hotel.id, hotel]));
  const focus = [...new Set((focusHotels ?? []).map((hotel) => hotel.id))]
    .flatMap((id) => byId.has(id) ? [byId.get(id)!] : []).slice(0, 12);
  if (focus.length) return focus.map((hotel) => hotel.coordinates!);
  if (visible.length > 40 && isRegionName(dataset.region)) {
    // Start large catalogues at city scale rather than one region-wide cluster.
    // This is viewport context, never a hotel's position or a location filter.
    const [longitude, latitude] = listingMapCenter(dataset.region);
    const cityHotels = visible.filter(({ coordinates }) =>
      Math.abs(coordinates![0] - longitude) <= 0.035 && Math.abs(coordinates![1] - latitude) <= 0.025);
    // A beach-only or filtered catalogue must not open on an empty city centre.
    if (cityHotels.length >= 3) return [[longitude - 0.035, latitude - 0.025], [longitude + 0.035, latitude + 0.025]];
  }
  return visible.length ? visible.map((hotel) => hotel.coordinates!) : datasetMapPoints(dataset);
}

export function groupMapHotels(hotels: Hotel[], project?: (point: Point) => Point, markerWidth = MAP_MARKER_SIZE): Hotel[][] {
  if (project) {
    // Anchors never move: the configured visual/touch boxes stay disjoint.
    // Recompute with the map's current pixel projection after every zoom.
    const groups: { anchor: Point; hotels: Hotel[] }[] = [];
    for (const hotel of hotels) {
      if (hotel.synthetic || !isMapPoint(hotel.coordinates)) continue;
      const position = project(hotel.coordinates);
      const nearby = groups.find(({ anchor }) =>
        Math.abs(position[0] - anchor[0]) < markerWidth + MAP_MARKER_GAP
        && Math.abs(position[1] - anchor[1]) < MAP_MARKER_SIZE + MAP_MARKER_GAP);
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
