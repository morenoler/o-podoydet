/** Cached public place data; location is not an entrance or a walking route. */
export interface PlaceSource {
  id: string;
  url: string;
  request: { method: string; url?: string; query?: string };
  sha256: string;
  obtainedAt: string;
  sourceDate: string | null;
  cachePath: string;
  attribution: string;
  license?: string;
  evidenceKind: "cached_osm_response" | "geocoder_response" | "search_excerpt";
}

export interface NearbyPlace {
  id: string;
  name: string;
  aliases: string[];
  categories: string[];
  coordinates: [number, number];
  sourceId: string;
  sourceUrl: string;
  coordinateMethod: "osm_node" | "osm_way_vertex_mean" | "nominatim_point";
  centerScope?: "city" | "district";
  assumptions?: string[];
  supportingSourceIds?: string[];
}

export interface PlacesDataset {
  schemaVersion: 1;
  region: "Пусан";
  retrievedAt: string;
  sourceDate: string | null;
  attribution: string;
  sources: PlaceSource[];
  coverage: {
    bbox: [number, number, number, number];
    complete: false;
    description: string;
  };
  places: NearbyPlace[];
  assumptions: string[];
}
