import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import type { ListingCoordinates } from "../../../shared/account";
import { validListingCoordinates } from "../../../shared/listingDetails";
import { tileLoadMonitor } from "../map/tileLoadMonitor";
import "leaflet/dist/leaflet.css";
import "./listing-location-map.css";

type Runtime = { library: typeof Leaflet; map: Leaflet.Map; marker?: Leaflet.Marker };

export function ListingLocationMap({ coordinates, onChange, disabled = false, demo = false, initialCenter = [129.0756, 35.1796] }: {
  coordinates: ListingCoordinates | null;
  onChange?: (coordinates: ListingCoordinates) => void;
  disabled?: boolean;
  demo?: boolean;
  initialCenter?: ListingCoordinates;
}) {
  const point = validListingCoordinates(coordinates) ? coordinates : null;
  const canvas = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const current = useRef({ coordinates: point, onChange, disabled, demo });
  current.current = { coordinates: point, onChange, disabled, demo };
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [partial, setPartial] = useState(false);
  const editable = typeof onChange === "function";
  const showMap = editable || point !== null;
  const longitude = point?.[0];
  const latitude = point?.[1];
  const [centerLongitude, centerLatitude] = initialCenter;

  useEffect(() => {
    setReady(false);
    if (!showMap || unavailable) return;
    let disposed = false;
    let ownedMap: Leaflet.Map | undefined;
    let observer: ResizeObserver | undefined;
    let resizeFrame: number | undefined;
    const fail = () => { if (!disposed) setUnavailable(true); };
    const monitor = tileLoadMonitor(fail, 12_000, (value) => { if (!disposed) setPartial(value); });
    const resize = () => {
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!disposed) ownedMap?.invalidateSize({ pan: false });
      });
    };
    void import("leaflet").then((L) => {
      if (disposed || !canvas.current) return;
      const map = L.map(canvas.current, { zoomControl: false, minZoom: 2, maxZoom: 19, scrollWheelZoom: false, keyboard: true });
      ownedMap = map;
      runtime.current = { library: L, map };
      const initial = current.current.coordinates;
      // An overview is not a chosen address: only clicks, dragging or explicit input call onChange.
      map.setView(initial ? [initial[1], initial[0]] : [centerLatitude, centerLongitude], initial ? 16 : 11);
      map.attributionControl.setPrefix(false);
      L.control.zoom({ position: "topright", zoomInTitle: "Приблизить карту", zoomOutTitle: "Отдалить карту" }).addTo(map);
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, keepBuffer: 0, updateWhenIdle: true, updateWhenZooming: false,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
      });
      tiles.on("loading", monitor.loading);
      tiles.on("load", monitor.loaded);
      tiles.on("tileload", monitor.tileLoaded);
      tiles.on("tileerror", monitor.tileError);
      tiles.addTo(map);
      map.on("click", (event: Leaflet.LeafletMouseEvent) => {
        const callback = current.current.onChange;
        if (!callback || current.current.disabled) return;
        const position = event.latlng.wrap();
        const next: ListingCoordinates = [Number(position.lng.toFixed(6)), Number(position.lat.toFixed(6))];
        if (validListingCoordinates(next)) callback(next);
      });
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(resize);
        observer.observe(canvas.current);
      }
      window.addEventListener("resize", resize);
      setReady(true);
    }).catch(fail);
    return () => {
      disposed = true;
      monitor.dispose();
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      ownedMap?.remove();
      runtime.current = null;
    };
  }, [showMap, unavailable, centerLongitude, centerLatitude]);

  useEffect(() => {
    const active = runtime.current;
    if (!ready || !active) return;
    const { library: L, map } = active;
    active.marker?.remove();
    active.marker = undefined;
    if (longitude === undefined || latitude === undefined) return;
    const icon = document.createElement("span");
    icon.className = "listing-map-pin-dot";
    const label = demo ? "Демонстрационная точка объявления" : "Точка, указанная отельером";
    const marker = L.marker([latitude, longitude], {
      icon: L.divIcon({ html: icon, className: "listing-map-pin", iconSize: [32, 32], iconAnchor: [16, 16] }),
      title: label, alt: label, keyboard: true, autoPanOnFocus: false,
      draggable: editable && !disabled,
    }).addTo(map);
    marker.getElement()?.setAttribute("aria-label", label);
    marker.on("dragend", () => {
      const callback = current.current.onChange;
      if (!callback || current.current.disabled) return;
      const position = marker.getLatLng().wrap();
      const next: ListingCoordinates = [Number(position.lng.toFixed(6)), Number(position.lat.toFixed(6))];
      if (validListingCoordinates(next)) callback(next);
    });
    active.marker = marker;
    if (!map.getBounds().contains([latitude, longitude])) map.panTo([latitude, longitude], { animate: false });
  }, [ready, longitude, latitude, editable, disabled, demo]);

  return <div className={`listing-location-map${editable && !disabled ? " is-editable" : ""}`}>
    {showMap && !unavailable ? <div className="listing-location-canvas" ref={canvas}
      aria-label={editable ? "Карта расположения. Выберите точку нажатием или заполните координаты ниже. Стрелки перемещают карту; плюс и минус меняют масштаб." : "Расположение объявления. Стрелки перемещают карту; плюс и минус меняют масштаб."} />
      : showMap && unavailable ? <div className="listing-map-fallback" role="status">
        <p>Карта недоступна. {editable ? "Можно указать координаты вручную ниже." : "Координаты указаны ниже."}</p>
        <button type="button" className="button secondary" disabled={disabled} onClick={() => setUnavailable(false)}>Повторить загрузку карты</button>
      </div> : null}
    <p className="listing-location-caption">
      {point ? <>{demo ? "Демонстрационная точка" : "Точка отельера"}: {point[1]}, {point[0]}.{!demo && " Адрес и вход независимо не проверены."}</>
        : editable ? "Точка пока не выбрана. Обзор карты не сохраняется как расположение объявления." : "Точка на карте не указана."}
    </p>
    {showMap && !unavailable && partial && <p className="listing-location-caption" role="status">Часть карты не загрузилась. Переместите карту, чтобы загрузить соседние участки.</p>}
    {demo && <p className="listing-location-demo">Вымышленное объявление. Точка условная.</p>}
  </div>;
}
