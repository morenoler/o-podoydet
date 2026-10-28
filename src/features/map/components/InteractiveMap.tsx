import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Map as MapIcon, Route } from "lucide-react";
import type * as Leaflet from "leaflet";
import type { Hotel, Point } from "../../../../shared/types";
import type { GeoMapProps } from "./GeoMap";
import { datasetMapPoints, detailMapPoints, groupMapHotels, hotelCountLabel, latLng, MAP_MARKER_SIZE, resultMapPoints, selectedMapPoints, validPath, visibleMapHotels } from "../mapData";
import { placePresentation, validMapPlaces } from "../../places/placePresentation";
import { locationDistance } from "../../places/locationPresentation";
import { tileLoadMonitor } from "../tileLoadMonitor";
import { BASEMAPS, OSM_ATTRIBUTION, type Basemap } from "../basemaps";
import { price } from "../../account/format";
import "leaflet/dist/leaflet.css";

type MapRuntime = { library: typeof Leaflet; map: Leaflet.Map; layers: Leaflet.LayerGroup };

export function InteractiveMap({ dataset, hotel, hotels, focusHotels, places, showRoute = true, onSelect, onUnavailable, basemap, onTilesUnavailable }: GeoMapProps & {
  onUnavailable: (message: string) => void;
  basemap: Basemap;
  onTilesUnavailable: (basemap: Basemap, message: string) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const runtime = useRef<MapRuntime | null>(null);
  const current = useRef({ dataset, hotel, hotels, focusHotels, places, showRoute, basemap, onSelect, onUnavailable, onTilesUnavailable });
  current.current = { dataset, hotel, hotels, focusHotels, places, showRoute, basemap, onSelect, onUnavailable, onTilesUnavailable };
  const [ready, setReady] = useState(false);
  const [zoomRevision, setZoomRevision] = useState(0);
  const priorView = useRef<{ results: string; focus: string; selected?: string } | null>(null);
  const pendingFit = useRef<{ points: Point[]; maxZoom: number } | null>(null);
  const markers = useMemo(() => visibleMapHotels(dataset, hotel, hotels), [dataset, hotel, hotels]);

  function fit(points: Point[], maxZoom = 16) {
    const active = runtime.current;
    if (!active || !points.length) return;
    if (!canvas.current?.clientWidth || !canvas.current.clientHeight) {
      // A filter/selection can change while the AI tab hides this container.
      // Only the latest requested scope should be fitted when it becomes visible.
      pendingFit.current = { points, maxZoom };
      return;
    }
    pendingFit.current = null;
    active.map.fitBounds(active.library.latLngBounds(points.map(latLng)), {
      paddingTopLeft: [42, 64], paddingBottomRight: [42, 40], maxZoom, animate: false,
    });
  }
  function fitAll() {
    fit(hotels === undefined && hotel ? detailMapPoints(hotel, places, showRoute)
      : markers.length ? markers.map((item) => item.coordinates!) : datasetMapPoints(dataset));
  }

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let resizeFrame: number | undefined;
    let ownedMap: Leaflet.Map | undefined;
    let initialize: (() => void) | undefined;
    const onResize = () => {
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (disposed || !canvas.current?.clientWidth || !canvas.current.clientHeight) return;
        if (!ownedMap) { initialize?.(); return; }
        // Never invalidate a zero-size map: Leaflet would replace its cached
        // viewport with zero and move the geographic centre on the next reveal.
        const center = ownedMap.getCenter(), zoom = ownedMap.getZoom();
        ownedMap.invalidateSize({ pan: false });
        const requested = pendingFit.current;
        if (requested) fit(requested.points, requested.maxZoom);
        else ownedMap.setView(center, zoom, { animate: false });
        if (!disposed) setZoomRevision((value) => value + 1);
      });
    };
    if (typeof ResizeObserver !== "undefined" && canvas.current) {
      observer = new ResizeObserver(onResize);
      observer.observe(canvas.current);
    }
    window.addEventListener("resize", onResize);
    // Import in the browser: server rendering and offline data tests need no DOM.
    void import("leaflet").then((L) => {
      initialize = () => {
        if (disposed || ownedMap || !canvas.current?.clientWidth || !canvas.current.clientHeight) return;
        const map = L.map(canvas.current, {
          zoomControl: false, minZoom: 8, maxZoom: 19,
          scrollWheelZoom: true, keyboard: true, trackResize: false,
        });
        ownedMap = map;
        const layers = L.layerGroup().addTo(map);
        runtime.current = { library: L, map, layers };
        map.on("zoomstart", () => canvas.current?.classList.add("is-map-zooming"));
        map.on("zoomend", () => {
          if (!disposed) setZoomRevision((value) => value + 1);
        });
        L.control.zoom({ position: "topright", zoomInTitle: "Приблизить карту", zoomOutTitle: "Отдалить карту" }).addTo(map);
        L.control.scale({ position: "bottomleft", imperial: false, maxWidth: 100 }).addTo(map);
        map.attributionControl.setPrefix(false);
        map.attributionControl.addAttribution(OSM_ATTRIBUTION);
        const source = current.current;
        const initialHotels = visibleMapHotels(source.dataset, source.hotel, source.hotels);
        const points = source.hotels === undefined && source.hotel && selectedMapPoints(source.hotel).length
          ? detailMapPoints(source.hotel, source.places, source.showRoute)
          : resultMapPoints(source.dataset, initialHotels, source.focusHotels);
        fit(points);
        setReady(true);
      };
      onResize();
    }).catch(() => {
      if (!disposed) current.current.onUnavailable("Не удалось открыть подробную карту. Показываем сохранённую схему.");
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      ownedMap?.remove();
      runtime.current = null;
      priorView.current = null;
      pendingFit.current = null;
    };
  }, []);

  useEffect(() => {
    const active = runtime.current;
    if (!ready || !active) return;
    const source = BASEMAPS[basemap];
    const monitor = tileLoadMonitor((message) => {
      if (current.current.basemap === basemap) current.current.onTilesUnavailable(basemap, message);
    });
    // Only request the viewport, once it is stationary. Keep normal HTTP cache
    // headers and Referer; never prefetch or retry around a provider's rate limit.
    const tiles = active.library.tileLayer(source.url, {
      maxNativeZoom: source.maxNativeZoom, maxZoom: 19, keepBuffer: 0,
      updateWhenIdle: true, updateWhenZooming: false, attribution: source.attribution,
    });
    tiles.on("loading", monitor.loading);
    tiles.on("load", monitor.loaded);
    tiles.on("tileerror", monitor.error);
    tiles.addTo(active.map);
    return () => {
      monitor.dispose();
      tiles.off("loading", monitor.loading);
      tiles.off("load", monitor.loaded);
      tiles.off("tileerror", monitor.error);
      tiles.remove();
    };
  }, [ready, basemap]);

  useEffect(() => {
    const active = runtime.current;
    if (!ready || !active) return;
    const { library: L, map, layers } = active;
    const results = markers.map((item) => `${item.id}:${item.coordinates!.join(",")}`).join("|");
    const selectedPoints = detailMapPoints(hotel, places, showRoute);
    const focusPoints = hotels === undefined && selectedPoints.length ? selectedPoints : resultMapPoints(dataset, markers, focusHotels);
    const focus = focusPoints.map((point) => point.join(",")).join("|");
    const previous = priorView.current;
    if (!previous && hotels === undefined && selectedPoints.length) fit(selectedPoints, 17);
    else if (!previous || previous.results !== results || previous.focus !== focus) fit(focusPoints);
    else if (previous.selected !== hotel?.id && selectedPoints.length) fit(selectedPoints, 17);
    priorView.current = { results, focus, selected: hotel?.id };
    if (!canvas.current?.clientWidth || !canvas.current.clientHeight) return;
    // Fit before grouping so hitboxes match the final zoom, including explicit selection.
    layers.clearLayers();
    const route = showRoute && !hotel?.synthetic ? validPath(hotel?.route?.coordinates) : [];
    if (route.length) {
      const alternative = validPath(hotel?.route?.noStepsAlternative?.coordinates);
      if (alternative.length) L.polyline(alternative.map(latLng), {
        color: "#667d91", weight: 3, dashArray: "6 5", interactive: false,
      }).addTo(layers);
      L.polyline(route.map(latLng), { color: "#fff", weight: 8, interactive: false }).addTo(layers);
      L.polyline(route.map(latLng), { color: "#163e8e", weight: 4, interactive: false }).addTo(layers);
      if (selectedMapPoints(hotel).length) L.polyline([hotel!.coordinates!, route[0]].map(latLng), {
        color: "#163e8e", weight: 3, dashArray: "4 5", interactive: false,
      }).addTo(layers);
      L.circleMarker(latLng(route.at(-1)!), {
        radius: 6, color: "#163e8e", fillColor: "#fff", fillOpacity: 1, weight: 2,
        interactive: false,
      }).bindTooltip("Конец рассчитанного маршрута к пляжу").addTo(layers);
    }
    for (const place of validMapPlaces(places || [])) {
      const presentation = placePresentation(place.categories);
      const pill = document.createElement("span");
      pill.className = `geo-place-pill is-${presentation.tone}`;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [name, value] of Object.entries({ width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(name, value);
      for (const d of presentation.paths) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d); svg.append(path);
      }
      const name = document.createElement("span");
      name.textContent = presentation.label === "Место" ? place.name : presentation.label;
      pill.append(svg, name);
      const marker = L.marker(latLng(place.coordinates), {
        icon: L.divIcon({ html: pill, className: "geo-place-marker", iconSize: [140, 44], iconAnchor: [70, 22] }),
        title: `${place.name} · ${locationDistance(place.meters)} по прямой`, keyboard: true, autoPanOnFocus: false,
      }).addTo(layers);
      const popup = document.createElement("div");
      popup.className = "geo-place-popup-content";
      const heading = document.createElement("strong"); heading.textContent = place.name;
      const distance = document.createElement("p"); distance.textContent = `${locationDistance(place.meters)} по прямой от отеля`;
      const source = document.createElement("a"); source.href = place.sourceUrl; source.target = "_blank"; source.rel = "noreferrer"; source.textContent = "Источник на карте";
      popup.append(heading, distance, source);
      marker.bindPopup(popup, { className: "geo-hotel-popup", maxWidth: 260 });
      marker.getElement()?.setAttribute("aria-label", `${place.name} · ${locationDistance(place.meters)} по прямой`);
    }
    const markerWidth = 128;
    const groups = groupMapHotels(markers, (coordinates) => {
      const point = map.latLngToLayerPoint(latLng(coordinates));
      return [point.x, point.y];
    }, markerWidth);
    for (const group of groups) {
      const selected = group.some((item) => item.id === hotel?.id);
      const selectedHotel = group.find((item) => item.id === hotel?.id) ?? group[0];
      const icon = document.createElement("span");
      icon.className = "geo-hotel-marker-pill";
      const hasPrice = typeof selectedHotel.pricePerNight === "number" && Number.isFinite(selectedHotel.pricePerNight)
        && selectedHotel.pricePerNight > 0 && (selectedHotel.currency === "RUB" || selectedHotel.currency === "KRW");
      icon.textContent = group.length > 1 ? hotelCountLabel(group.length)
        : hasPrice ? price(selectedHotel.pricePerNight!, selectedHotel.currency!) : selectedHotel.name;
      const label = group.length > 1
        ? `Отели рядом (${group.length}): ${group.map((item) => item.name).join("; ")}. Открыть список`
        : `Показать на карте: ${group[0].name}`;
      const marker = L.marker(latLng(group[0].coordinates!), {
        icon: L.divIcon({ html: icon, className: `geo-hotel-marker is-pill${selected ? " is-selected" : ""}${hotels === undefined ? " is-detail" : ""}`, iconSize: [markerWidth, MAP_MARKER_SIZE], iconAnchor: [markerWidth / 2, MAP_MARKER_SIZE / 2] }),
        title: label, alt: label, keyboard: true, autoPanOnFocus: false,
        zIndexOffset: selected ? 1000 : 0,
      }).addTo(layers);
      const tooltip = document.createElement("span");
      tooltip.textContent = selectedHotel.name + (group.length > 1 ? ` · ещё ${group.length - 1}` : "");
      marker.bindTooltip(tooltip, { direction: "top", offset: [0, -15], className: `geo-hotel-tooltip${selected ? " is-selected" : ""}` });
      const choose = () => {
        if (group.length === 1) {
          current.current.onSelect?.(group[0]);
          return;
        }
        const popup = document.createElement("div");
        popup.className = "geo-shared-hotels";
        const heading = document.createElement("strong");
        heading.textContent = "Отели рядом";
        popup.append(heading);
        for (const item of group) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = item.name;
          button.setAttribute("aria-pressed", String(item.id === current.current.hotel?.id));
          button.addEventListener("click", () => {
            map.closePopup();
            current.current.onSelect?.(item);
          });
          popup.append(button);
        }
        marker.bindPopup(popup, { maxWidth: 280, className: "geo-hotel-popup" }).openPopup();
        popup.querySelector("button")?.focus();
      };
      marker.on("click", choose);
      const element = marker.getElement();
      element?.setAttribute("aria-label", label);
      element?.setAttribute("aria-pressed", String(selected));
      element?.addEventListener("keydown", (event) => {
        if (event.key === " ") { event.preventDefault(); choose(); }
      });
    }
    canvas.current?.classList.remove("is-map-zooming");
  }, [ready, markers, hotel, hotels, dataset, focusHotels, places, showRoute, zoomRevision]);

  return (
    <div className="v2-map interactive-map">
      <div className="interactive-map-canvas" ref={canvas} aria-label="Карта отелей. Стрелки перемещают карту; плюс и минус меняют масштаб." />
      <div className="interactive-map-actions">
        <button type="button" onClick={fitAll} title="Показать все отели" disabled={!ready}>
          <MapIcon size={18} aria-hidden="true" /> Все <span className="geo-map-count">{markers.length}</span>
        </button>
        <button type="button" onClick={() => fit(detailMapPoints(hotel, places, showRoute), 17)} disabled={!ready || !selectedMapPoints(hotel).length}
          title={showRoute ? "Показать выбранный отель и весь рассчитанный маршрут" : "Показать выбранный отель и места рядом"}>
          <Route size={18} aria-hidden="true" /> {showRoute && validPath(hotel?.route?.coordinates).length ? "Маршрут" : "Отель"}
        </button>
      </div>
      <span className="interactive-map-north" aria-label="Север вверху"><ArrowUp size={14} aria-hidden="true" /> С</span>
    </div>
  );
}
