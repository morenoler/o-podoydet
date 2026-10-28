export type Basemap = "satellite" | "streets";

export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

const ARCGIS_IMAGERY = "https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer";
export interface BasemapSource {
  url: string;
  maxNativeZoom: number;
  available: boolean;
  attribution: string;
  metadataUrl?: string;
}

/** Only the user's browser-scoped ArcGIS key enables imagery; no shared/demo keys. */
export function createBasemaps(apiKey: string | undefined): Record<Basemap, BasemapSource> {
  const token = apiKey?.trim() || "";
  return {
    satellite: {
      url: token ? `${ARCGIS_IMAGERY}/tile/{z}/{y}/{x}?token=${encodeURIComponent(token)}` : "",
      metadataUrl: token ? `${ARCGIS_IMAGERY}?f=json&token=${encodeURIComponent(token)}` : undefined,
      // Request native city-scale tiles, never stretch the former z14 / 10m mosaic.
      // Detail and capture dates vary by place; a tile zoom is not a resolution claim.
      maxNativeZoom: 19,
      available: !!token,
      attribution: 'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>',
    },
    streets: {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      maxNativeZoom: 19,
      available: true,
      // OSM also supplies the hotel's coordinates and route overlays in both modes.
      attribution: "",
    },
  };
}

export const BASEMAPS = createBasemaps(import.meta.env?.VITE_ARCGIS_API_KEY);
export const DEFAULT_BASEMAP: Basemap = BASEMAPS.satellite.available ? "satellite" : "streets";
export const SATELLITE_UNAVAILABLE = "Спутниковые снимки не подключены. Пока доступна карта OpenStreetMap.";

/** Attribution from provider metadata is untrusted text, never executable HTML. */
export function imageryAttribution(metadata: unknown, baseAttribution: string): string {
  if (!metadata || typeof metadata !== "object" || "error" in metadata)
    throw new Error("Не удалось проверить источник снимков.");
  const credit = (metadata as { copyrightText?: unknown }).copyrightText;
  if (typeof credit !== "string" || !credit.trim() || credit.length > 4096)
    throw new Error("Не удалось проверить источник снимков.");
  const escaped = credit.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  return `${baseAttribution} · Снимки: ${escaped}`;
}
