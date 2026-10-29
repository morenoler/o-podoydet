export type Basemap = "satellite" | "streets";

export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

const ARCGIS_IMAGERY = "https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer";
const STADIA_IMAGERY: BasemapSource = {
  url: "https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}.jpg",
  // Request a new native tile at every supported map zoom, including z18–19.
  maxNativeZoom: 19,
  maxZoom: 19,
  // Cold imagery requests can exceed the street layer's 12-second deadline.
  loadTimeoutMs: 30_000,
  available: true,
  attribution: '&copy; CNES, Distribution Airbus DS, &copy; Airbus DS, &copy; PlanetObserver (Contains Copernicus Data) · &copy; <a href="https://stadiamaps.com/attribution/" target="_blank" rel="noopener">Stadia Maps</a> · &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a>',
  label: "Airbus · Stadia Maps",
  description: "Спутниковые и аэрофотоснимки Airbus / Stadia Maps. Дата съёмки и детализация зависят от участка; снимки не подтверждают нынешнее состояние отеля.",
};
const OPEN_IMAGERY: BasemapSource = {
  url: "https://wmts.terrascope.be/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=esa-worldcover-s2rgbnir-10m-2021-v2_tcc&STYLE=default&FORMAT=image%2Fpng&TILEMATRIXSET=EPSG%3A3857&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&TIME=2021-01-01",
  maxNativeZoom: 14,
  maxZoom: 19,
  available: true,
  attribution: '&copy; <a href="https://esa-worldcover.org/en/data-access" target="_blank" rel="noopener">ESA WorldCover project 2021</a> / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium · <a href="https://terrascope.be/" target="_blank" rel="noopener">Terrascope</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>',
  label: "Sentinel-2 · 2021 · ≈10 м",
  description: "Спутниковая мозаика ESA WorldCover за 2021 год, около 10 м на пиксель. При приближении снимок увеличивается без новых деталей. Снимки не подтверждают нынешнее состояние отеля.",
};
export interface BasemapSource {
  url: string;
  maxNativeZoom: number;
  /** Display zoom is independent of the provider's native tile resolution. */
  maxZoom: number;
  available: boolean;
  attribution: string;
  metadataUrl?: string;
  loadTimeoutMs?: number;
  label?: string;
  description?: string;
}

interface ImageryOptions {
  hostname?: string;
  stadiaApiKey?: string;
  stadiaDomainAuth?: boolean;
}

/** Stadia explicitly permits keyless local web development, not arbitrary public hosts. */
export function createBasemaps(apiKey: string | undefined, options: ImageryOptions = {}): Record<Basemap, BasemapSource> {
  const token = apiKey?.trim() || "";
  const stadiaToken = options.stadiaApiKey?.trim() || "";
  const localDevelopment = options.hostname === "localhost" || options.hostname === "127.0.0.1";
  const stadia = stadiaToken || options.stadiaDomainAuth || localDevelopment;
  return {
    satellite: token ? {
      url: `${ARCGIS_IMAGERY}/tile/{z}/{y}/{x}?token=${encodeURIComponent(token)}`,
      metadataUrl: `${ARCGIS_IMAGERY}?f=json&token=${encodeURIComponent(token)}`,
      // Request native city-scale tiles, never stretch the former z14 / 10m mosaic.
      // Detail and capture dates vary by place; a tile zoom is not a resolution claim.
      maxNativeZoom: 19,
      maxZoom: 19,
      available: true,
      attribution: 'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>',
      label: "Esri World Imagery",
      description: "Снимки Esri World Imagery. Дата и детализация зависят от участка; снимки не подтверждают нынешнее состояние отеля.",
    } : stadia ? {
      ...STADIA_IMAGERY,
      url: STADIA_IMAGERY.url + (stadiaToken ? `?api_key=${encodeURIComponent(stadiaToken)}` : ""),
    } : { ...OPEN_IMAGERY },
    streets: {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      maxNativeZoom: 19,
      maxZoom: 19,
      available: true,
      // OSM also supplies the hotel's coordinates and route overlays in both modes.
      attribution: "",
    },
  };
}

export const BASEMAPS = createBasemaps(import.meta.env?.VITE_ARCGIS_API_KEY, {
  hostname: typeof window === "undefined" ? undefined : window.location.hostname,
  stadiaApiKey: import.meta.env?.VITE_STADIA_API_KEY,
  stadiaDomainAuth: import.meta.env?.VITE_STADIA_DOMAIN_AUTH === "true",
});
// Keep the detailed street view initially when only overview imagery is configured.
export const DEFAULT_BASEMAP: Basemap = BASEMAPS.satellite.maxNativeZoom >= 19 ? "satellite" : "streets";

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
