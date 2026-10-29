export type Basemap = "satellite" | "streets";

export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

const ARCGIS_IMAGERY = "https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer";
const OPEN_IMAGERY: BasemapSource = {
  url: "https://wmts.terrascope.be/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=esa-worldcover-s2rgbnir-10m-2021-v2_tcc&STYLE=default&FORMAT=image%2Fpng&TILEMATRIXSET=EPSG%3A3857&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&TIME=2021-01-01",
  maxNativeZoom: 14,
  available: true,
  attribution: '&copy; <a href="https://esa-worldcover.org/en/data-access" target="_blank" rel="noopener">ESA WorldCover project 2021</a> / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium · <a href="https://terrascope.be/" target="_blank" rel="noopener">Terrascope</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>',
  label: "Sentinel-2 · 2021 · ≈10 м",
  description: "Обзорная спутниковая мозаика ESA WorldCover за 2021 год, около 10 м на пиксель. Для деталей улиц переключитесь на «Карта». Снимки не подтверждают нынешнее состояние отеля.",
};
export interface BasemapSource {
  url: string;
  maxNativeZoom: number;
  available: boolean;
  attribution: string;
  metadataUrl?: string;
  label?: string;
  description?: string;
}

/** Open, attributed imagery works without keys; a browser-scoped key enables city detail. */
export function createBasemaps(apiKey: string | undefined): Record<Basemap, BasemapSource> {
  const token = apiKey?.trim() || "";
  return {
    satellite: token ? {
      url: `${ARCGIS_IMAGERY}/tile/{z}/{y}/{x}?token=${encodeURIComponent(token)}`,
      metadataUrl: `${ARCGIS_IMAGERY}?f=json&token=${encodeURIComponent(token)}`,
      // Request native city-scale tiles, never stretch the former z14 / 10m mosaic.
      // Detail and capture dates vary by place; a tile zoom is not a resolution claim.
      maxNativeZoom: 19,
      available: true,
      attribution: 'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>',
      label: "Esri World Imagery",
      description: "Снимки Esri World Imagery. Дата и детализация зависят от участка; снимки не подтверждают нынешнее состояние отеля.",
    } : { ...OPEN_IMAGERY },
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
// Keep the detailed street view initially when only overview imagery is configured.
export const DEFAULT_BASEMAP: Basemap = BASEMAPS.satellite.metadataUrl ? "satellite" : "streets";

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
