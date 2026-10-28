import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import type { HotelMatch, Trip } from "../../../../shared/types";
import type { ListingBed } from "../../../../shared/account";
import { features } from "../../../../shared/features";
import { bedTypes, validListingCoordinates } from "../../../../shared/listingDetails";
import { countLabel, directionLabels, price } from "../../account/format";
import { dateFull } from "../../../shared/lib/date";
import { lodgingLabel } from "../../../shared/lib/presentation";
import { accountListingId } from "../../../shared/lib/accommodation";
import type { ComparisonEntry } from "../../search/comparison";
import { LocationCriteria } from "../../places/LocationCriteria";
import { PersonalWishesSummary } from "./PersonalWishesSummary";
import { criterionMatches } from "../../../shared/lib/matchPresentation";
import { Notice } from "../../../shared/ui/Feedback";
import { CapacitySummary } from "./CapacitySummary";
import { CriterionLine } from "./CriterionLine";
import { MatchBadge } from "./MatchBadge";
import { NearbySummary } from "./NearbySummary";

const unknown = <span className="comparison-unknown">Не указано</span>;
const isDemo = (match: HotelMatch) => match.hotel.synthetic || match.best.room.demo;

function bedLabel(bed: ListingBed) {
  if (bed.type === "crib") return `Детская кроватка: ${bed.count} шт., для младенцев, отдельно от основных мест`;
  return `${bedTypes[bed.type].label}: ${bed.count} шт., по ${countLabel(bed.placesPerUnit, ["место", "места", "мест"])}`;
}

function BedList({ beds }: { beds: ListingBed[] }) {
  if (!beds.length) return unknown;
  return <ul className="comparison-list">{beds.map((bed, index) => <li key={index}>{bedLabel(bed)}</li>)}</ul>;
}

function RoomLayout({ beds }: { beds: ListingBed[] }) {
  const rooms = [...new Set(beds.map((bed) => bed.room?.trim()).filter((room): room is string => !!room))];
  if (!rooms.length) return <span className="comparison-unknown">Распределение по комнатам не указано</span>;
  return <>
    <ul className="comparison-list">{rooms.map((room) => <li key={room}>
      <strong>{room}</strong>: {beds.filter((bed) => bed.room?.trim() === room).map(bedLabel).join("; ")}
    </li>)}</ul>
    {beds.some((bed) => !bed.room?.trim()) && <small>Для части кроватей комната не указана.</small>}
    <small>Названия комнат из объявления; общее число комнат не подтверждено.</small>
  </>;
}

function Location({ match }: { match: HotelMatch }) {
  const coordinates = match.hotel.coordinates;
  if (!validListingCoordinates(coordinates)) return <span className="comparison-unknown">Точка на карте не указана</span>;
  const [lon, lat] = coordinates;
  const label = `${lat.toFixed(5)}° широты, ${lon.toFixed(5)}° долготы`;
  if (isDemo(match)) return <>{label}<small>Демонстрационная точка, не подтверждение реального расположения.</small></>;
  return <>
    <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`} target="_blank" rel="noreferrer">{label}</a>
    <small>{accountListingId(match.hotel) ? "Точка указана отельером." : "Точка из каталога."} Расположение входа не проверено.</small>
  </>;
}

function RouteSummary({ match }: { match: HotelMatch }) {
  const route = match.hotel.route;
  if (accountListingId(match.hotel) || isDemo(match) || !route) return <span className="comparison-unknown">Нет данных о маршруте до пляжа</span>;
  return <>
    {Math.round(route.meters).toLocaleString("ru-RU")} м по пешеходной сети до пляжа
    {route.connectionMeters > 0 && <small>Подходы к сети: ещё ≈{Math.round(route.connectionMeters)} м, не проверены.</small>}
  </>;
}

export function CompareDialog({ entries, trip, onClose, onRemove }: { entries: ComparisonEntry[]; trip: Trip; onClose: () => void; onRemove: (id: string) => void }) {
  const matches = entries.flatMap((entry) => entry.match ? [entry.match] : []);
  const ref = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState<number>();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    // clientWidth excludes a native vertical scrollbar; container units do not on Windows.
    const measure = () => { if (viewport.clientWidth > 0) setViewportWidth(viewport.clientWidth); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(viewport);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const ids = [...new Set(matches.flatMap((match) => match.best.criteria.map((criterion) => criterion.feature)))];
  const ownerIds = [...new Set(matches.flatMap((match) => (match.ownerCriteria || []).map((criterion) => criterion.id)))];
  const row = (key: string, label: string, content: (match: HotelMatch) => ReactNode) => <tr key={key}>
    <th scope="row">{label}</th>
    {entries.map(({ selection, match, message }) => <td key={selection.id}>{match ? content(match) : <span className="comparison-unknown">{message || "Оценка ещё не получена."}</span>}</td>)}
  </tr>;
  return <dialog ref={ref} className="compare-dialog comparison-dialog" onCancel={onClose} aria-labelledby="compare-title">
    <div className="dialog-head">
      <div>
        <h2 id="compare-title">Сравним детали</h2>
        <p>{dateFull(trip.checkIn)} — {dateFull(trip.checkOut)} · {trip.region}</p>
        <p id="comparison-scroll-hint">Каждый столбец — выбранная категория или объявление. Таблицу можно прокручивать.</p>
      </div>
      <button type="button" className="icon-button" aria-label="Закрыть сравнение" onClick={onClose}><X aria-hidden="true" /></button>
    </div>
    <div ref={scrollRef} className="comparison-table-scroll" role="region" aria-label="Таблица сравнения вариантов" aria-describedby="comparison-scroll-hint" tabIndex={0}>
      <table className="comparison-table" style={{ "--comparison-count": entries.length, "--comparison-viewport-width": viewportWidth == null ? undefined : `${viewportWidth}px` } as CSSProperties}>
        <caption className="comparison-caption">Характеристики выбранных вариантов и состояние сведений</caption>
        <thead><tr>
          <th scope="col">Параметр</th>
          {entries.map(({ selection, match, message, outsideResults }) => <th scope="col" key={selection.id}>
            {match && <MatchBadge match={match} />}
            <h3>{match?.best.room.name || selection.name}</h3>
            <p>{match?.hotel.name || selection.hotelName}</p>
            {outsideResults && match && <small>Не входит в текущую подборку. Показана отдельная проверка по новым условиям.</small>}
            {!match && <p role="status">{message || "Оценка ещё не получена."}</p>}
            {match && (match.best.criteria.length > 0 || !!match.ownerCriteria?.length) && <small>
              Совпало {match.best.criteria.filter(criterionMatches).length + (match.ownerCriteria?.filter((criterion) => criterion.status === "match" && criterion.evidenceStatus === "match").length || 0)} из {match.best.criteria.length + (match.ownerCriteria?.length || 0)} условий
            </small>}
            <button type="button" className="text-link" onClick={() => onRemove(selection.id)} aria-label={`Убрать из сравнения ${selection.name}, ${selection.hotelName}`}>Убрать</button>
          </th>)}
        </tr></thead>
        <tbody>
          {row("source", "Источник сведений", (match) => <>
            {isDemo(match) ? <strong>Демонстрационные данные</strong> : accountListingId(match.hotel) ? <strong>Сведения отельера</strong> : match.best.room.sourceUrl ? "Каталог и источники категории" : "Каталог; источник категории не указан"}
            {accountListingId(match.hotel) && <small>Независимая проверка не проведена.</small>}
            {match.best.room.sourceUrl && <small><a href={match.best.room.sourceUrl} target="_blank" rel="noreferrer">Источник категории</a></small>}
            {match.best.room.obtainedAt && <small>Получено {dateFull(match.best.room.obtainedAt)}</small>}
          </>)}
          {row("lodging", "Тип размещения", (match) => match.hotel.lodgingType ? lodgingLabel(match.hotel) : unknown)}
          {row("price", "Цена за ночь", (match) => typeof match.hotel.pricePerNight === "number" && Number.isFinite(match.hotel.pricePerNight) && match.hotel.pricePerNight > 0 ? <>
            {(match.hotel.currency === "KRW" || match.hotel.currency === "RUB") ? price(match.hotel.pricePerNight, match.hotel.currency) : `${match.hotel.pricePerNight.toLocaleString("ru-RU")} · валюта не указана`}
            <small>По цене объявления; стоимость на даты поездки не проверена. Полную стоимость и наличие уточняйте.</small>
          </> : <span className="comparison-unknown">Цена не указана · цена неизвестна</span>)}
          {row("capacity", "Максимум гостей", (match) => <>
            {match.best.room.capacity == null && !match.best.capacityRule && <span className="comparison-unknown">Не указан</span>}
            <CapacitySummary match={match.best} />
          </>)}
          {row("sleeping-places", "Спальные места", (match) => match.best.room.sleepingPlaces == null ? unknown : <>
            {countLabel(match.best.room.sleepingPlaces, ["место", "места", "мест"])}<small>Без детских кроваток. Число мест не означает отдельную кровать для каждого.</small>
          </>)}
          {row("beds", "Кровати и диваны", (match) => <BedList beds={match.best.room.beds || []} />)}
          {row("rooms", "Распределение по комнатам", (match) => <RoomLayout beds={match.best.room.beds || []} />)}
          {row("floor", "Этаж", (match) => match.hotel.floor == null ? unknown : match.hotel.floor)}
          {row("windows", "Стороны окон", (match) => match.hotel.windowDirections?.length ? match.hotel.windowDirections.map((direction) => directionLabels[direction]).join(", ") : unknown)}
          {row("amenities", "Удобства", (match) => match.best.room.amenities?.length ? <>{match.best.room.amenities.join(", ")}<small>Из описания категории; наличие и условия использования проверяйте отдельно.</small></> : <span className="comparison-unknown">Не указаны</span>)}
          {row("address", "Адрес", (match) => match.hotel.address.trim() || unknown)}
          {row("coordinates", "Точка на карте", (match) => <Location match={match} />)}
          {row("route", "Маршрут до пляжа", (match) => <RouteSummary match={match} />)}
          {(!!trip.hotelFilters?.nearby?.length || matches.some((match) => match.best.nearbyMatches?.length)) && row("nearby", "Рядом по карте", (match) => match.best.nearbyMatches?.length ? <NearbySummary matches={match.best.nearbyMatches} region={trip.region} /> : <span className="comparison-unknown">Нет сведений для выбранных условий</span>)}
          {ids.map((id) => row(`criterion-${id}`, features[id].label, (match) => {
            const criterion = match.best.criteria.find((item) => item.feature === id);
            return criterion ? <CriterionLine criterion={criterion} detailed /> : <span className="comparison-unknown">Не оценивалось для этого варианта</span>;
          }))}
          {ownerIds.map((id) => row(`owner-${id}`, matches.flatMap((match) => match.ownerCriteria || []).find((criterion) => criterion.id === id)!.label, (match) => {
            const criterion = match.ownerCriteria?.find((item) => item.id === id);
            if (!criterion) return <span className="comparison-unknown">Не оценивалось для этого варианта</span>;
            return <>
              <strong>{criterion.evidenceStatus === "unknown" ? "Нет сведений для проверки" : criterion.status === "match" && criterion.evidenceStatus === "match" ? "Соответствует по сведениям отельера" : "Не соответствует пожеланию"}</strong>
              <small>{criterion.required ? "Обязательно" : "Желательно"}</small>
              <p>{criterion.explanation}</p>
              <small>{criterion.sourceExplanation || "Сведения отельера; независимая проверка не проведена."}</small>
            </>;
          }))}
          {row("location-criteria", "Условия расположения", (match) => <LocationCriteria criteria={match.locationCriteria} detailed />)}
          {row("personal-wishes", "Пожелания своими словами", (match) => <PersonalWishesSummary match={match} />)}
          <tr><th scope="row">Подробнее</th>{entries.map(({ selection }) => <td key={selection.id}>
            <Link to={selection.path} className="button secondary" onClick={onClose}>Посмотреть детали<span className="comparison-sr-only">: {selection.name}, {selection.hotelName}</span></Link>
          </td>)}</tr>
        </tbody>
      </table>
    </div>
    <Notice>Недостающие сведения отмечены отдельно от подтверждённых фактов. Цена и наличие на выбранные даты не проверены.</Notice>
  </dialog>;
}
