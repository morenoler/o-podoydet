import { useSurroundings } from "./useSurroundings";
import { locationDistance } from "./locationPresentation";
import { nearbyDisplayPlaces, PlaceIcon, type SurroundingPlace } from "./placePresentation";

export function NearbyPlaceList({ places }: { places: SurroundingPlace[] }) {
  return <ul className="nearby-place-list">{places.map(place => <li key={place.id}>
    <PlaceIcon categories={place.categories} />
    <a href={place.sourceUrl} target="_blank" rel="noreferrer" title={`${place.name} · расстояние по прямой`}>
      <span>{place.name}</span><span className="nearby-place-distance"> · {locationDistance(place.meters)}</span>
    </a>
  </li>)}</ul>;
}

export function NearbyPlaces({ hotelId }: { hotelId: string }) {
  const { data, error } = useSurroundings(hotelId);
  const places = nearbyDisplayPlaces(data?.places || [], hotelId);
  return <section className="nearby-places" aria-label="Что находится рядом с отелем">
    <h2>Рядом с отелем</h2>
    {!data && !error ? <p role="status">Проверяем окружение по сохранённой карте…</p>
      : error ? <p>Сведения о ближайших местах сейчас недоступны.</p>
        : data?.status === "unknown" ? <p>Не хватает данных карты, чтобы определить ближайшие места.</p>
          : places.length ? <NearbyPlaceList places={places.slice(0, 6)} />
            : <p>В доступном снимке карты ближайшие места не отмечены.</p>}
    {data && <details className="nearby-place-details" key={hotelId}>
      <summary>Подробнее</summary>
      {places.length > 6 && <NearbyPlaceList places={places.slice(6)} />}
      {!!data.centers?.length && <div className="nearby-centers"><h3>Ориентиры центральных районов</h3><NearbyPlaceList places={data.centers} /></div>}
      <div className="nearby-places-evidence">
        <p>Расстояния по прямой от здания. Маршруты, часы работы и доступность входов не проверены. Отсутствие места в снимке карты не означает, что его нет.</p>
        {!!data.assumptions?.length && <ul>{data.assumptions.map((text, index) => <li key={index}>{text}</li>)}</ul>}
        {data.obtainedAt && <p>Данные получены: {new Date(data.obtainedAt).toLocaleDateString("ru-RU", { timeZone: "UTC" })}{data.sourceDate ? ` · дата источника: ${new Date(data.sourceDate).toLocaleDateString("ru-RU", { timeZone: "UTC" })}` : " · дата исходных данных не указана"}</p>}
      </div>
    </details>}
  </section>;
}
