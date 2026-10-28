export type Basemap = "satellite" | "streets";

export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

// The unversioned layer is specifically the 2016 mosaic (CC BY 4.0).
// Later yearly EOX layers require a commercial licence; do not substitute them.
// Terms: https://cloudless.eox.at/pricing and https://maps.eox.at/
// Layer identity/licence: https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml
export const BASEMAPS = {
  satellite: {
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg",
    maxNativeZoom: 14,
    attribution: '<a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless</a> by <a href="https://eox.at" target="_blank" rel="noopener">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2016) · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a> · <a href="https://maps.eox.at" target="_blank" rel="noopener">EOX Maps</a>',
  },
  streets: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 19,
    // The map itself credits OSM for the hotel's coordinates and route overlays.
    attribution: "",
  },
} as const;
