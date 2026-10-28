import { canSearch } from "../features/search/searchTrip";
import { DetailTripControls } from "../features/hotels/components/DetailTripControls";
import { HotelCatalogPreview } from "../features/hotels/components/HotelCatalogPreview";
import { DetailLayout } from "../features/hotels/components/DetailLayout";
import { DetailGallery } from "../features/hotels/components/DetailGallery";
import { DetailSidebar } from "../features/hotels/components/DetailSidebar";
import { DetailHeading } from "../features/hotels/components/DetailHeading";
import { CatalogSummary } from "../features/hotels/components/CatalogSummary";
import { FavoriteButton } from "../features/favorites/FavoriteButton";
import "../features/search/search.css";
import "../features/hotels/hotel-details.css";
import "../features/search/catalog-filters.css";
import { useParams, useSearchParams, useLocation } from "react-router-dom";
import { useAuth } from "../features/auth/AuthProvider";
import { NearbyPlaces } from "../features/places/NearbyPlaces";
import { CatalogAvailability } from "../features/clarifications/DecisionNextSteps";
import "../features/places/places.css";
import { useApp } from "../app/providers/TripProvider";
import { useState, useEffect } from "react";
import type { HotelMatch, Hotel, Fact, Question } from "../../shared/types";
import { api } from "../shared/api/client";
import { ErrorMessage, Loading, Notice } from "../shared/ui/Feedback";
import { ExternalLink } from "lucide-react";
import { HotelReviews } from "../features/hotels/components/HotelReputation";
import { CriterionLine } from "../features/hotels/components/CriterionLine";
import { dateFull } from "../shared/lib/date";
import { AreaPanel } from "../features/area/components/AreaPanel";
import { FactEvidence } from "../features/hotels/components/FactEvidence";
import { accommodationPath } from "../shared/lib/accommodation";
import { CatalogClarificationPlan } from "../features/clarifications/CatalogClarificationPlan";
import "../features/clarifications/clarifications.css";
import { changeTripRegion } from "../features/search/searchPolicy";
import { hasEvaluableRooms } from "../features/search/roomResults";

import { CatalogRoomDetails } from "../features/hotels/components/CatalogRoomDetails";
import { HotelLocation } from "../features/hotels/components/HotelLocation";
import { clarificationItems } from "../features/clarifications/clarificationPresentation";

export function HotelPage() {
  const { id } = useParams();
  const { hash } = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { trip, setTrip, catalog, catalogError, revision, refresh } = useApp();
  const validTrip = canSearch(trip);
  const [params] = useSearchParams();
  const requestedRoom = params.get("room");
  const tripKey = JSON.stringify(trip);
  const requestKey = JSON.stringify([id, requestedRoom, tripKey, revision, user?.id || "guest"]);
  const sourceKey = JSON.stringify([id, user?.id || "guest"]);
  type DetailData = { region?: string; hotel: Hotel; facts: Fact[]; questions: Question[] };
  const [response, setResponse] = useState<{ key: string; sourceKey: string; data: DetailData | null; ranked: HotelMatch | null; error: string } | null>(null);
  const current = !authLoading && response?.key === requestKey ? response : null;
  // Public detail content and the chat shell may remain mounted during a new evaluation.
  // Private verdicts below still require an exact trip + account key.
  const data = current?.data || (!authLoading && response?.sourceKey === sourceKey ? response.data : null);
  const ranked = current?.ranked || null;
  const error = current?.error || "";
  const [roomId, setRoomId] = useState("");
  useEffect(() => {
    if (authLoading) return;
    let active = true;
    api<DetailData>(`/hotels/${id}`)
      .then(async (d) => {
        if (!active || !d) return [null, null] as const;
        const region = d.region || d.hotel.region;
        if (region && region !== trip.region) {
          setTrip(changeTripRegion(trip, region));
          return [null, null] as const;
        }
        const evaluation = validTrip && hasEvaluableRooms(d.hotel) ? await api<HotelMatch>(`/hotels/${id}/evaluate`, trip) : null;
        return [d, evaluation] as const;
      })
      .then(([d, evaluation]) => {
        if (active) {
          setResponse({ key: requestKey, sourceKey, data: d, ranked: evaluation, error: "" });
          if (d)
            setRoomId(
              d.hotel.rooms.some((r) => r.id === requestedRoom)
                ? requestedRoom!
                : evaluation?.best.room.id || d.hotel.rooms[0]?.id || "",
            );
        }
      })
      .catch((e) => {
        if (active) setResponse((previous) => ({ key: requestKey, sourceKey, data: previous?.sourceKey === sourceKey ? previous.data : null, ranked: null, error: e.message }));
      });
    return () => {
      active = false;
    };
  }, [id, revision, requestedRoom, tripKey, user?.id, authLoading]);
  useEffect(() => {
    if (!data || !["#hotel-reviews", "#availability-request"].includes(hash)) return;
    const frame = requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [hash, data, ranked]);
  if (catalogError)
    return (
      <div className="page">
        <ErrorMessage text={catalogError} />
        <button
          className="button secondary"
          onClick={() => window.location.reload()}
        >
          Повторить загрузку каталога
        </button>
      </div>
    );
  if (error && !data)
    return (
      <div className="page">
        <ErrorMessage text={error} />
      </div>
    );
  if (!data || !catalog || (data.region && data.region !== catalog.region))
    return (
      <div className="page">
        <Loading />
      </div>
    );
  const { hotel, facts } = data;
  if (!ranked) return <DetailLayout backTo="/results"
    gallery={<DetailGallery name={hotel.name} hotelId={hotel.id} photos={hotel.photos} />}
    saved={<FavoriteButton label item={{ id: requestedRoom ? `${hotel.id}::${requestedRoom}` : hotel.id, name: hotel.name, path: accommodationPath(hotel, requestedRoom || undefined), hotelId: hotel.id, photos: hotel.photos, address: hotel.address }} />}
    sidebar={<DetailSidebar hotelId={hotel.id} region={hotel.region || trip.region} map={<HotelLocation hotel={hotel} catalog={catalog} />} />}>
    {!current && validTrip && <p role="status">Перепроверяем условия для новой поездки…</p>}
    {error && <ErrorMessage text={error} />}
    <HotelCatalogPreview embedded hotel={hotel} facts={facts} catalog={catalog} selectedRoomId={requestedRoom} />
  </DetailLayout>;
  const labFixture =
    import.meta.env.VITE_LAB_MODE === "true" &&
    hotel.id.startsWith("lab-demo-");
  const room = ranked.rooms.find((r) => r.room.id === roomId) || ranked.best;
  const preferences = ranked.preferences || trip.preferences;
  const otherCriteria = room.criteria.filter((criterion) =>
    !preferences.some((preference) => preference.feature === criterion.feature));
  const needsClarification = !labFixture && clarificationItems(room, preferences).length > 0;
  return (
    <DetailLayout backTo="/results" gallery={<DetailGallery name={hotel.name} hotelId={hotel.id} photos={hotel.photos} />}
      saved={<FavoriteButton label item={{ id: `${hotel.id}::${room.room.id}`, name: `${room.room.name} · ${hotel.name}`, path: accommodationPath(hotel, room.room.id), hotelId: hotel.id, photos: hotel.photos, address: hotel.address }} />}
      sidebar={<DetailSidebar hotelId={hotel.id} region={hotel.region || trip.region} map={<HotelLocation hotel={hotel} catalog={catalog} />} />}>
      <DetailHeading hotelId={hotel.id} title={hotel.name} address={hotel.address} pricePerNight={hotel.pricePerNight} currency={hotel.currency} demo={hotel.synthetic} />
      <CatalogSummary hotel={hotel} room={room.room} />
      {requestedRoom && !ranked.rooms.some((entry) => entry.room.id === requestedRoom) && (
        <Notice>Запрошенная категория больше не доступна. Показана другая категория; проверьте её условия.</Notice>
      )}
      {labFixture && <Notice><strong>Вымышленное тестовое объявление.</strong> {hotel.dataNotes?.join(" ")}</Notice>}
      <DetailTripControls trip={trip} onChange={(next) => {
        if (JSON.stringify(next) === JSON.stringify(trip)) refresh(); else setTrip(next);
      }} />
      <section className="figcraft-detail-section" aria-labelledby="hotel-about-title">
        <h2 id="hotel-about-title">Категории номеров</h2>
        <div className="detail-room-list">{ranked.rooms.map((entry) => <CatalogRoomDetails key={entry.room.id} hotel={hotel} room={entry.room} match={entry}
          selected={room.room.id === entry.room.id}
          />)}</div>
      </section>
      {error && <ErrorMessage text={error} />}
      {!hotel.synthetic && <>
        {ranked.rooms.length > 1 && <label className="field detail-request-category"><span>Категория для уточнения наличия</span>
          <select value={room.room.id} onChange={event => setRoomId(event.target.value)}>
            {ranked.rooms.map(entry => <option key={entry.room.id} value={entry.room.id}>{entry.room.name}</option>)}
          </select>
        </label>}
        <CatalogAvailability key={room.room.id} hotel={hotel} room={room.room} trip={trip} match={ranked} roomMatch={room} />
      </>}
      <NearbyPlaces hotelId={hotel.id} />
      <HotelReviews hotelId={hotel.id} />
      <section className="figcraft-detail-section hotel-additional" aria-labelledby="hotel-additional-title">
        <h2 id="hotel-additional-title">Дополнительно</h2>
        <details className="hotel-detail-disclosure" key={`additional-${room.room.id}`}>
          <summary>Уточнения и окружение</summary>
          <div className="hotel-disclosure-content">
            {needsClarification && <CatalogClarificationPlan match={{ ...ranked, preferences }} room={room} />}
            {otherCriteria.length > 0 && <section className="room-criteria">
              <h3>Другие условия</h3>
              {otherCriteria.map((criterion) => <div className="room-criterion" key={criterion.feature}>
                <CriterionLine criterion={criterion} />
              </div>)}
            </section>}
            {!labFixture && <>
              <h3>Район на даты поездки</h3>
              <p className="muted">{dateFull(trip.checkIn)} — {dateFull(trip.checkOut)} · {trip.region}</p>
              <AreaPanel hotelId={hotel.id} region={trip.region} />
              {hotel.route && <section className="hotel-route-details">
                <h3>Путь к пляжу</h3>
                <p>{hotel.route.meters} м по пешеходной сети, около {Math.ceil(hotel.route.meters / 65)} мин при скорости 65 м/мин.
                  Приближённое соединение со входом: {hotel.route.connectionMeters} м, не включено в длину.
                  Участков с отмеченными лестницами: {hotel.route.steps}. Доступность всего пути не проверена.</p>
                {hotel.route.noStepsAlternative && <p>Альтернативный путь без отмеченных лестниц: {hotel.route.noStepsAlternative.meters} м. Доступность не обследована.</p>}
              </section>}
              <section className="hotel-noise-details">
                <h3>Возможные источники шума</h3>
                {hotel.noise.map((noise) => <a className="noise-row" key={noise.osmUrl} href={noise.osmUrl} target="_blank" rel="noreferrer">
                  <span>{noise.name}</span><span>≈ {noise.meters} м <ExternalLink size={13} aria-hidden="true" /></span>
                </a>)}
                <p className="muted">{hotel.noise.length ? "Расстояния по прямой, по данным карты." : "В выгрузке нет отмеченных источников рядом; это не подтверждает тишину."} Шум внутри номера не измерен.</p>
              </section>
            </>}
          </div>
        </details>
        <details className="hotel-detail-disclosure" key={`evidence-${room.room.id}`}>
          <summary>Источники сведений</summary>
          <div className="hotel-disclosure-content evidence-section">
            {facts.filter((fact) => !fact.roomId || fact.roomId === room.room.id).map((fact) => (
              <FactEvidence key={fact.id} fact={fact} allowDemo={labFixture && catalog.evidencePolicy === "demo"} />
            ))}
          </div>
        </details>
      </section>
      </DetailLayout>
  );
}
