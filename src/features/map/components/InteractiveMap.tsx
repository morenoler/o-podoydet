import { useEffect, useMemo, useRef, useState } from "react";
import { Map as MapIcon, Route } from "lucide-react";
import type * as Leaflet from "leaflet";
import type { Hotel, Point } from "../../../../shared/types";
import type { GeoMapProps } from "./GeoMap";
import { datasetMapPoints, groupMapHotels, latLng, MAP_MARKER_SIZE, selectedMapPoints, validPath, visibleMapHotels } from "../mapData";
import { tileLoadMonitor } from "../tileLoadMonitor";
import "leaflet/dist/leaflet.css";

type MapRuntime = { library: typeof Leaflet; map: Leaflet.Map; layers: Leaflet.LayerGroup };

export function InteractiveMap({ dataset, hotel, hotels, onSelect, onUnavailable }: GeoMapProps & {
  onUnavailable: (message: string) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const runtime = useRef<MapRuntime | null>(null);
  const current = useRef({ dataset, hotel, hotels, onSelect, onUnavailable });
  current.current = { dataset, hotel, hotels, onSelect, onUnavailable };
  const [ready, setReady] = useState(false);
  const [zoomRevision, setZoomRevision] = useState(0);
  const priorView = useRef<{ results: string; selected?: string } | null>(null);
  const markers = useMemo(() => visibleMapHotels(dataset, hotel, hotels), [dataset, hotel, hotels]);

  function fit(points: Point[], maxZoom = 16) {
    const active = runtime.current;
    if (!active || !points.length) return;
    active.map.fitBounds(active.library.latLngBounds(points.map(latLng)), {
      paddingTopLeft: [42, 64], paddingBottomRight: [42, 40], maxZoom, animate: false,
    });
  }
  function fitAll() {
    fit(markers.length ? markers.map((item) => item.coordinates!) : datasetMapPoints(dataset));
  }

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let resizeFrame: number | undefined;
    let ownedMap: Leaflet.Map | undefined;
    const monitor = tileLoadMonitor((message) => current.current.onUnavailable(message));
    const onResize = () => {
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!disposed) ownedMap?.invalidateSize({ pan: false });
      });
    };
    // Import in the browser: server rendering and offline data tests need no DOM.
    void import("leaflet").then((L) => {
      if (disposed || !canvas.current) return;
      const map = L.map(canvas.current, {
        zoomControl: false, minZoom: 8, maxZoom: 19,
        scrollWheelZoom: true, keyboard: true,
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
      const source = current.current;
      const initialHotels = visibleMapHotels(source.dataset, source.hotel, source.hotels);
      const points = source.hotels === undefined && source.hotel && selectedMapPoints(source.hotel).length
        ? selectedMapPoints(source.hotel)
        : initialHotels.length ? initialHotels.map((item) => item.coordinates!) : datasetMapPoints(source.dataset);
      fit(points);
      // Standard viewport requests only. Browser HTTP cache and Referer remain intact.
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, keepBuffer: 0, updateWhenIdle: true, updateWhenZooming: false,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
      });
      tiles.on("loading", monitor.loading);
      tiles.on("load", monitor.loaded);
      tiles.on("tileerror", monitor.error);
      tiles.addTo(map);
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(onResize);
        observer.observe(canvas.current);
      }
      window.addEventListener("resize", onResize);
      setReady(true);
    }).catch(() => {
      if (!disposed) current.current.onUnavailable("Не удалось открыть подробную карту. Показываем сохранённую схему.");
    });
    return () => {
      disposed = true;
      monitor.dispose();
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      ownedMap?.remove();
      runtime.current = null;
      priorView.current = null;
    };
  }, []);

  useEffect(() => {
    const active = runtime.current;
    if (!ready || !active) return;
    const { library: L, map, layers } = active;
    const results = markers.map((item) => `${item.id}:${item.coordinates!.join(",")}`).join("|");
    const previous = priorView.current;
    if (!previous && hotels === undefined && selectedMapPoints(hotel).length) fit(selectedMapPoints(hotel), 17);
    else if (!previous || previous.results !== results) fitAll();
    else if (previous.selected !== hotel?.id && selectedMapPoints(hotel).length) fit(selectedMapPoints(hotel), 17);
    priorView.current = { results, selected: hotel?.id };
    // Fit before grouping so hitboxes match the final zoom, including explicit selection.
    layers.clearLayers();
    const route = !hotel?.synthetic ? validPath(hotel?.route?.coordinates) : [];
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
    const groups = groupMapHotels(markers, (coordinates) => {
      const point = map.latLngToLayerPoint(latLng(coordinates));
      return [point.x, point.y];
    });
    for (const group of groups) {
      const selected = group.some((item) => item.id === hotel?.id);
      const selectedHotel = group.find((item) => item.id === hotel?.id) ?? group[0];
      const icon = document.createElement("span");
      icon.className = "geo-hotel-marker-dot";
      if (group.length > 1) icon.textContent = String(group.length);
      const label = group.length > 1
        ? `Отели рядом (${group.length}): ${group.map((item) => item.name).join("; ")}. Открыть список`
        : `Показать на карте: ${group[0].name}`;
      const marker = L.marker(latLng(group[0].coordinates!), {
        icon: L.divIcon({ html: icon, className: `geo-hotel-marker${selected ? " is-selected" : ""}`, iconSize: [MAP_MARKER_SIZE, MAP_MARKER_SIZE], iconAnchor: [MAP_MARKER_SIZE / 2, MAP_MARKER_SIZE / 2] }),
        title: label, alt: label, keyboard: true, autoPanOnFocus: false,
        zIndexOffset: selected ? 1000 : 0,
      }).addTo(layers);
      const tooltip = document.createElement("span");
      tooltip.textContent = selectedHotel.name + (group.length > 1 ? ` · ещё ${group.length - 1}` : "");
      marker.bindTooltip(tooltip, { permanent: selected, direction: "top", offset: [0, -15], className: "geo-hotel-tooltip" });
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
  }, [ready, markers, hotel, dataset, zoomRevision]);

  return (
    <div className="v2-map interactive-map">
      <div className="interactive-map-canvas" ref={canvas} aria-label="Карта отелей. Стрелки перемещают карту; плюс и минус меняют масштаб." />
      <div className="interactive-map-actions">
        <button type="button" onClick={fitAll} title="Показать все отели" disabled={!ready}>
          <MapIcon size={18} aria-hidden="true" /> Все <span className="geo-map-count">{markers.length}</span>
        </button>
        <button type="button" onClick={() => fit(selectedMapPoints(hotel), 17)} disabled={!ready || !selectedMapPoints(hotel).length}
          title="Показать выбранный отель и весь рассчитанный маршрут">
          <Route size={18} aria-hidden="true" /> {validPath(hotel?.route?.coordinates).length ? "Маршрут" : "Отель"}
        </button>
      </div>
      <span className="interactive-map-north" aria-label="Север вверху">↑ С</span>
    </div>
  );
}
