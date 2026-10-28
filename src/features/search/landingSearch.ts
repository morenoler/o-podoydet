import { listingMapCenter, regionNames } from "../../../shared/regions";

export interface GlobePoint { latitude: number; longitude: number }

/** A globe click selects a catalogue city only inside its immediate vicinity. */
export function catalogueRegionAtPoint(point: GlobePoint, available: readonly string[] = regionNames) {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) return undefined;
  const radians = Math.PI / 180;
  return regionNames.find((region) => {
    if (!available.includes(region)) return false;
    const [longitude, latitude] = listingMapCenter(region);
    const a = Math.sin((point.latitude - latitude) * radians / 2) ** 2
      + Math.cos(latitude * radians) * Math.cos(point.latitude * radians) * Math.sin((point.longitude - longitude) * radians / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) <= 30;
  });
}

export function pointLabel({ latitude, longitude }: GlobePoint) {
  return `${Math.abs(latitude).toFixed(1)}° ${latitude < 0 ? "ю. ш." : "с. ш."}, ${Math.abs(longitude).toFixed(1)}° ${longitude < 0 ? "з. д." : "в. д."}`;
}
