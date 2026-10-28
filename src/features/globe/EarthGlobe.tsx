import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { listingMapCenter, regionNames, type RegionName } from "../../../shared/regions";
import { createGlobeRenderer, type GlobeRenderer } from "./globeRenderer";
import { clampLatitude, dragGlobe, globeGeometry, INITIAL_GLOBE_CAMERA, interpolateCamera, isGlobeClick, pickGlobePoint, projectPoint, wrapLongitude, type GeoPoint, type GlobeCamera } from "./globeMath";
import "./globe.css";

export interface EarthGlobeProps {
  selectedRegion?: string;
  selectedPoint?: GeoPoint | null;
  focusVersion?: number;
  onSelectRegion?: (region: RegionName) => void;
  onPickPoint?: (point: GeoPoint) => void;
  className?: string;
}
export type GlobePoint = GeoPoint;
const destinations = regionNames.map(region => {
  const [longitude, latitude] = listingMapCenter(region);
  return { region, point: { latitude, longitude } };
});
function readFraction(style: CSSStyleDeclaration, property: string, fallback: number) {
  const value = style.getPropertyValue(property).trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? value.endsWith("%") ? parsed / 100 : parsed : fallback;
}

export function EarthGlobe({ selectedRegion, selectedPoint, focusVersion = 0, onSelectRegion, onPickPoint, className = "" }: EarthGlobeProps) {
  const hostRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null);
  const markersRef = useRef<(HTMLButtonElement | null)[]>([]);
  const pickedMarkerRef = useRef<HTMLDivElement>(null);
  const camera = useRef<GlobeCamera>({ ...(selectedRegion === "Сочи" ? destinations.find(item=>item.region === "Сочи")!.point : INITIAL_GLOBE_CAMERA) });
  const geometry = useRef(globeGeometry(0,0));
  const renderer = useRef<GlobeRenderer | null>(null);
  const draw = useRef(() => {});
  const gesture = useRef<{ id: number; x: number; y: number; lastX: number; lastY: number; maxDistance: number } | null>(null);
  const previousRegion = useRef(selectedRegion);
  const previousFocusVersion = useRef(focusVersion);
  const transitionFrame = useRef(0);
  const [paused, setPaused] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [visible, setVisible] = useState(true);
  const [fallback, setFallback] = useState(false);
  const [assetError, setAssetError] = useState(false);
  const [contextVersion, setContextVersion] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [picked, setPicked] = useState<GeoPoint | null>(null);
  const visiblePoint = selectedPoint === undefined ? picked : selectedPoint;
  const pointRef = useRef(visiblePoint);
  pointRef.current = visiblePoint;
  const helpId = useId();

  useEffect(() => {
    const canvas = canvasRef.current, host = hostRef.current;
    if (!canvas || !host) return;
    let disposed = false;
    draw.current = () => {
      if (disposed) return;
      renderer.current?.render(camera.current,geometry.current);
      destinations.forEach(({ point }, index) => {
        const marker = markersRef.current[index]; if (!marker) return;
        const projected = projectPoint(point,camera.current,geometry.current);
        const inFrame = projected.x > 20 && projected.x < geometry.current.width-20 && projected.y > 28 && projected.y < geometry.current.height-80;
        marker.hidden = !renderer.current || !projected.visible || !inFrame;
        marker.style.left = `${projected.x}px`; marker.style.top = `${projected.y}px`;
      });
      const pickedMarker=pickedMarkerRef.current;
      if (pickedMarker && pointRef.current) {
        const projected=projectPoint(pointRef.current,camera.current,geometry.current);
        pickedMarker.hidden=!renderer.current || !projected.visible || projected.x<0 || projected.x>geometry.current.width || projected.y<0 || projected.y>geometry.current.height-80;
        pickedMarker.style.left=`${projected.x}px`; pickedMarker.style.top=`${projected.y}px`;
      }
    };
    const lose = (event: Event) => { event.preventDefault(); cancelAnimationFrame(transitionFrame.current); gesture.current=null; renderer.current = null; setFallback(true); setPaused(true); setAnnouncement("Графика временно недоступна. Направление можно выбрать в форме поиска."); draw.current(); };
    const restore = () => { if (!disposed) setContextVersion(value => value+1); };
    canvas.addEventListener("webglcontextlost",lose); canvas.addEventListener("webglcontextrestored",restore);
    let current: GlobeRenderer | null = null;
    try { current = createGlobeRenderer(canvas,() => { if (!disposed) setAssetError(true); },() => draw.current()); } catch { current = null; }
    renderer.current = current; setFallback(!current);
    const resize = () => {
      const bounds = host.getBoundingClientRect(), style = getComputedStyle(host);
      geometry.current = globeGeometry(bounds.width,bounds.height,readFraction(style,"--globe-center-x",.5),readFraction(style,"--globe-center-y",.5),readFraction(style,"--globe-radius",.46));
      draw.current();
    };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    return () => { disposed = true; cancelAnimationFrame(transitionFrame.current); observer.disconnect(); canvas.removeEventListener("webglcontextlost",lose); canvas.removeEventListener("webglcontextrestored",restore); current?.destroy(); renderer.current=null; draw.current=()=>{}; };
  },[contextVersion]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let inView=true;
    const reduce = () => { if (media.matches) { setPaused(true); cancelAnimationFrame(transitionFrame.current); } };
    const visibility = () => setVisible(inView && document.visibilityState !== "hidden");
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries=>{inView=entries.some(entry=>entry.isIntersecting);visibility();});
    if (hostRef.current) observer?.observe(hostRef.current);
    media.addEventListener("change",reduce); document.addEventListener("visibilitychange",visibility); visibility();
    return () => { observer?.disconnect(); media.removeEventListener("change",reduce); document.removeEventListener("visibilitychange",visibility); };
  },[]);
  useEffect(() => {
    if (paused || !visible || fallback) return;
    let frame = 0, previous = 0;
    const tick = (now: number) => {
      if (previous && now-previous >= 32) {
        camera.current = { ...camera.current, longitude: wrapLongitude(camera.current.longitude + Math.min(now-previous,100)*.0018) };
        previous=now; draw.current();
      } else if (!previous) previous=now;
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  },[paused,visible,fallback]);
  useEffect(() => {
    if (selectedRegion === previousRegion.current && focusVersion === previousFocusVersion.current) return;
    previousRegion.current=selectedRegion;
    previousFocusVersion.current=focusVersion;
    const destination = destinations.find(item => item.region === selectedRegion);
    if (destination) animateTo(destination.point);
  },[selectedRegion,focusVersion]);
  useEffect(()=>{draw.current();},[visiblePoint]);

  function animateTo(target: GlobeCamera) {
    cancelAnimationFrame(transitionFrame.current); setPaused(true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || fallback) { camera.current={ ...target }; draw.current(); return; }
    const from={ ...camera.current }, started=performance.now();
    const tick=(now:number)=>{
      const progress=Math.min(1,(now-started)/500);
      camera.current=interpolateCamera(from,target,progress); draw.current();
      if (progress<1) transitionFrame.current=requestAnimationFrame(tick);
    };
    transitionFrame.current=requestAnimationFrame(tick);
  }

  function selectRegion(region: RegionName) {
    const destination=destinations.find(item => item.region === region)!;
    animateTo(destination.point);
    setPicked(null); setAnnouncement(`Выбрано направление: ${region}.`); onSelectRegion?.(region);
  }
  function pick(point: GeoPoint | null) {
    if (!point) return;
    setPicked(point);
    setAnnouncement(`Точка на глобусе: широта ${point.latitude.toFixed(1)}, долгота ${point.longitude.toFixed(1)}. Доступные направления: Пусан и Сочи.`);
    onPickPoint?.(point);
  }
  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!renderer.current || !event.isPrimary || event.button !== 0) return;
    cancelAnimationFrame(transitionFrame.current);
    event.currentTarget.focus({ preventScroll: true }); setPaused(true);
    gesture.current={ id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,maxDistance:0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag=gesture.current; if (!drag || drag.id !== event.pointerId) return;
    drag.maxDistance=Math.max(drag.maxDistance,Math.hypot(event.clientX-drag.x,event.clientY-drag.y));
    camera.current=dragGlobe(camera.current,event.clientX-drag.lastX,event.clientY-drag.lastY,geometry.current.radius);
    drag.lastX=event.clientX; drag.lastY=event.clientY; draw.current();
  }
  function endPointer(event: PointerEvent<HTMLCanvasElement>, cancelled=false) {
    const drag=gesture.current; if (!drag || drag.id !== event.pointerId) return;
    gesture.current=null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled || !isGlobeClick(Math.max(drag.maxDistance,Math.hypot(event.clientX-drag.x,event.clientY-drag.y)))) return;
    const bounds=event.currentTarget.getBoundingClientRect();
    pick(pickGlobePoint(event.clientX-bounds.left,event.clientY-bounds.top,camera.current,geometry.current));
  }
  function keyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    if (!renderer.current) return;
    const amount=event.shiftKey ? 20 : 5;
    if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home"," ","Enter"].includes(event.key)) event.preventDefault(); else return;
    cancelAnimationFrame(transitionFrame.current);
    if (event.key === " ") { setPaused(value => !value); return; }
    setPaused(true);
    if (event.key === "Enter") { pick({ ...camera.current }); return; }
    if (event.key === "Home") camera.current={ ...INITIAL_GLOBE_CAMERA };
    else camera.current={ latitude:clampLatitude(camera.current.latitude + (event.key === "ArrowUp" ? amount : event.key === "ArrowDown" ? -amount : 0)), longitude:wrapLongitude(camera.current.longitude + (event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0)) };
    draw.current();
  }
  return <div ref={hostRef} className={`earth-globe ${className}${fallback ? " is-fallback" : ""}`}>
    <canvas ref={canvasRef} className="earth-globe-canvas" tabIndex={fallback ? -1 : 0} role="img"
      aria-label="Интерактивный глобус Земли" aria-describedby={helpId}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event=>endPointer(event)} onPointerCancel={event=>endPointer(event,true)} onLostPointerCapture={()=>{gesture.current=null;}} onKeyDown={keyDown} />
    {fallback && <div className="earth-globe-fallback"><img src="/images/globe/earth-day-clouds-2048.jpg" alt="Карта Земли: спутниковая мозаика NASA" /><p>Вращение недоступно в этом браузере. Выберите направление в форме поиска.</p></div>}
    <p className="sr-only" id={helpId}>Перетаскивайте глобус для вращения. Стрелки вращают, Shift ускоряет, пробел включает паузу, Home возвращает Азию, Enter выбирает центральную точку. Доступны Пусан и Сочи.</p>
    <div className="earth-globe-markers">{destinations.map(({region},index)=><button type="button" key={region} ref={node=>{markersRef.current[index]=node;}}
      hidden className={`earth-globe-marker${!visiblePoint && selectedRegion===region ? " is-selected" : ""}`} aria-label={`Выбрать направление ${region}`} aria-pressed={!visiblePoint && selectedRegion===region} onClick={()=>selectRegion(region)}><span className="earth-globe-pin" aria-hidden="true" /><span className="earth-globe-marker-label">{region}{!visiblePoint && selectedRegion===region && <small>{region === "Пусан" ? "Популярное пляжное направление" : "Черноморское побережье"}</small>}</span></button>)}</div>
    {visiblePoint && <div ref={pickedMarkerRef} className="earth-globe-picked-marker"><span aria-hidden="true" />{visiblePoint.latitude.toFixed(1)}°, {visiblePoint.longitude.toFixed(1)}°</div>}
    <div className="earth-globe-toolbar">
      {!fallback && <div className="earth-globe-rotation"><button type="button" onClick={()=>{cancelAnimationFrame(transitionFrame.current);setPaused(value=>!value);}} aria-label={paused ? "Включить вращение глобуса" : "Приостановить вращение глобуса"} aria-pressed={!paused}>{paused ? <Play size={16} aria-hidden="true"/> : <Pause size={16} aria-hidden="true"/>}</button><button type="button" aria-label="Вернуть вид на Азию" onClick={()=>animateTo(INITIAL_GLOBE_CAMERA)}><RotateCcw size={16} aria-hidden="true"/></button></div>}
    </div>
    <div className="earth-globe-caption">
      {visiblePoint && <span>{Math.abs(visiblePoint.latitude).toFixed(1)}° {visiblePoint.latitude>=0 ? "с. ш." : "ю. ш."}, {Math.abs(visiblePoint.longitude).toFixed(1)}° {visiblePoint.longitude>=0 ? "в. д." : "з. д."}</span>}
      <details><summary>Изображения NASA</summary><div>Спутниковые мозаики, не текущая погода. Освещение условное.<br/><a href="https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/" target="_blank" rel="noreferrer">Земля: NASA/GSFC, Reto Stöckli, Robert Simmon</a><br/><a href="https://svs.gsfc.nasa.gov/2916/" target="_blank" rel="noreferrer">Ночные огни: NASA/NOAA</a></div></details>
    </div>
    {assetError && <p className="earth-globe-error" role="status">Не все изображения загрузились. Выбор направлений доступен.</p>}
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </div>;
}
