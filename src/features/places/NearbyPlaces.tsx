import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { api } from "../../shared/api/client";
import { locationDistance } from "./locationPresentation";

interface Place {
  id: string;
  name: string;
  meters: number;
  sourceUrl: string;
  categories?: string[];
  interpretation?: string;
}
interface Surroundings {
  status: "available" | "unknown";
  places: Place[];
  centers: Place[];
  method: string;
  assumptions: string[];
  obtainedAt?: string;
  sourceDate?: string;
}

export function NearbyPlaces({ hotelId }: { hotelId: string }) {
  const [data, setData] = useState<Surroundings | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(false);
    setExpanded(false);
    api<Surroundings>(`/hotels/${encodeURIComponent(hotelId)}/places`)
      .then((result) => { if (active) setData(result); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [hotelId]);
  const places = data?.places || [];
  const centers = data?.centers || [];
  return (
    <section className="nearby-places" aria-label="Что находится рядом с отелем">
      <h2><MapPin size={22} aria-hidden="true" />Рядом с отелем</h2>
      {!data && !error ? <p role="status">Проверяем окружение по сохранённой карте…</p>
        : error ? <p>Сведения о ближайших местах сейчас недоступны.</p>
          : data?.status === "unknown" ? <p>Не хватает картографических данных, чтобы определить ближайшие места.</p>
            : <>
              {places.length ? <ul className="nearby-place-list">
                {(expanded ? places : places.slice(0, 6)).map((place) => <li key={place.id}>
                  <a href={place.sourceUrl} target="_blank" rel="noreferrer">{place.name}</a>
                  <span>{locationDistance(place.meters)} по прямой</span>
                </li>)}
              </ul> : <p>В доступном снимке карты ближайшие места не отмечены. Это не означает, что их нет.</p>}
              {places.length > 6 && <button className="button secondary" type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "Показать меньше" : `Все найденные места (${places.length})`}</button>}
              {!!centers.length && <div className="nearby-centers">
                <h3>Ориентиры центральных районов</h3>
                <ul className="nearby-place-list">{centers.map((place) => <li key={place.id}>
                  <div><a href={place.sourceUrl} target="_blank" rel="noreferrer">{place.name}</a>{place.interpretation && <p>{place.interpretation}</p>}</div>
                  <span>{locationDistance(place.meters)} по прямой</span>
                </li>)}</ul>
              </div>}
            </>}
      <div className="nearby-places-evidence">
        {!!data?.assumptions?.length && <ul>{data.assumptions.map((text, index) => <li key={index}>{text}</li>)}</ul>}
        <p>Расстояния от здания по прямой не заменяют пешеходный маршрут. Часы работы и доступность мест не проверены.</p>
        {data?.obtainedAt && <p>Данные получены: {new Date(data.obtainedAt).toLocaleDateString("ru-RU", { timeZone: "Asia/Seoul" })}{data.sourceDate ? ` · дата источника: ${new Date(data.sourceDate).toLocaleDateString("ru-RU", { timeZone: "Asia/Seoul" })}` : " · дата исходных данных не указана"}</p>}
      </div>
    </section>
  );
}
