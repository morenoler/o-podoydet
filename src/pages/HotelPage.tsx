import { canSearch } from "../features/search/searchTrip";
import { SearchBar } from "../features/search/SearchBar";
import { HotelCatalogPreview } from "../features/hotels/components/HotelCatalogPreview";
import { HotelPhotoGallery } from "../features/hotels/components/HotelPhotoGallery";
import { FavoriteButton } from "../features/favorites/FavoriteButton";
import "../features/search/search.css";
import "../features/hotels/hotel-details.css";
import { NearbySummary } from "../features/hotels/components/NearbySummary";
import "../features/search/catalog-filters.css";
import { PersonalWishesSummary } from "../features/hotels/components/PersonalWishesSummary";
import { MatchBadge } from "../features/hotels/components/MatchBadge";
import { matchForSelectedPreferences } from "../shared/lib/matchPresentation";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { useApp } from "../app/providers/TripProvider";
import { useState, useEffect } from "react";
import type { HotelMatch, Hotel, Fact, Question } from "../../shared/types";
import { api } from "../shared/api/client";
import { ErrorMessage, Loading, Notice } from "../shared/ui/Feedback";
import { ArrowLeft, MapPin, ExternalLink } from "lucide-react";
import { lodgingLabel } from "../shared/lib/presentation";
import { WishMatches } from "../features/hotels/components/WishMatches";
import { OwnerCriteriaSummary } from "../features/hotels/components/OwnerCriteriaSummary";
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
  const navigate = useNavigate();
  const { trip, setTrip, catalog, catalogError, revision, refresh, regions } = useApp();
  const validTrip = canSearch(trip);
  const [params] = useSearchParams();
  const requestedRoom = params.get("room");
  const tripKey = JSON.stringify(trip);
  const [ranked, setRanked] = useState<HotelMatch | null>(null);
  const [data, setData] = useState<{
      region?: string;
      hotel: Hotel;
      facts: Fact[];
      questions: Question[];
    } | null>(null),
    [roomId, setRoomId] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setRanked(null);
    setError("");
    api<typeof data>(`/hotels/${id}`)
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
          setData(d);
          setRanked(evaluation);
          if (d)
            setRoomId(
              d.hotel.rooms.some((r) => r.id === requestedRoom)
                ? requestedRoom!
                : evaluation?.best.room.id || d.hotel.rooms[0]?.id || "",
            );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, revision, requestedRoom, tripKey]);
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
  if (!ranked)
    return (
      <HotelCatalogPreview hotel={hotel} facts={facts} catalog={catalog} selectedRoomId={requestedRoom} />
    );
  const labFixture =
    import.meta.env.VITE_LAB_MODE === "true" &&
    hotel.id.startsWith("lab-demo-");
  const room = ranked.rooms.find((r) => r.room.id === roomId) || ranked.best;
  const selectedCriteria = room.criteria.filter((criterion) =>
    (ranked.preferences || trip.preferences).some(
      (preference) => preference.feature === criterion.feature,
    ),
  );
  const hasOwnerCriteria = !!ranked.ownerCriteria?.length;
  const preferences = ranked.preferences || trip.preferences;
  const otherCriteria = room.criteria.filter((criterion) =>
    !preferences.some((preference) => preference.feature === criterion.feature));
  const needsClarification = !labFixture && clarificationItems(room, preferences).length > 0;
  return (
    <div className="page hotel-detail-page">
      <Link to="/results" className="back-link"><ArrowLeft size={16} aria-hidden="true" />К подбору</Link>
      <div className="detail-heading">
        <div>
          <h1>{room.room.name}</h1>
          <p className="hotel-detail-hotel-name">{hotel.name}</p>
          <p className="address"><MapPin size={16} aria-hidden="true" />{lodgingLabel(hotel)} · {hotel.address}</p>
        </div>
        <FavoriteButton label item={{
          id: `${hotel.id}::${room.room.id}`, name: `${room.room.name} · ${hotel.name}`,
          path: accommodationPath(hotel, room.room.id), hotelId: hotel.id,
          photos: hotel.photos, address: hotel.address,
        }} />
      </div>
      <HotelPhotoGallery hotel={hotel} />
      {requestedRoom && !ranked.rooms.some((entry) => entry.room.id === requestedRoom) && (
        <Notice>Запрошенная категория больше не доступна. Показана другая категория; проверьте её условия.</Notice>
      )}
      {labFixture && <Notice><strong>Вымышленное тестовое объявление.</strong> {hotel.dataNotes?.join(" ")}</Notice>}
      <div className="detail-grid hotel-primary-information">
        <section className="hotel-room-overview" aria-labelledby="hotel-about-title">
          <h2 id="hotel-about-title">О размещении</h2>
          {ranked.rooms.length > 1 && <label className="field">
            <span>Категория номера</span>
            <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
              {ranked.rooms.map((entry) => <option key={entry.room.id} value={entry.room.id}>{entry.room.name}</option>)}
            </select>
          </label>}
          <CatalogRoomDetails hotel={hotel} room={room.room} match={room} />
        </section>
        <HotelLocation hotel={hotel} catalog={catalog} />
      </div>
      <section className="subsection hotel-trip-fit" aria-labelledby="hotel-trip-title">
        <h2 id="hotel-trip-title">Для вашей поездки</h2>
        <SearchBar trip={trip} regions={regions} onSearch={(next) => {
          if (next.region !== trip.region) { setTrip(next); navigate("/results"); }
          else if (JSON.stringify(next) === JSON.stringify(trip)) refresh();
          else setTrip(next);
        }} />
        <MatchBadge match={matchForSelectedPreferences(ranked, preferences, room)} />
        <NearbySummary matches={room.nearbyMatches || []} region={trip.region} />
        {selectedCriteria.length > 0 && <WishMatches criteria={selectedCriteria} />}
        {hasOwnerCriteria && <OwnerCriteriaSummary criteria={ranked.ownerCriteria} />}
        <PersonalWishesSummary match={{ ...ranked, best: room }} />
        {ranked.warnings?.map((text, index) => <Notice key={`warning-${index}`}>{text}</Notice>)}
        {ranked.conflicts?.map((text, index) => <Notice key={`conflict-${index}`}>{text}</Notice>)}
        {error && <ErrorMessage text={error} />}
      </section>
      <section className="subsection hotel-additional" aria-labelledby="hotel-additional-title">
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
    </div>
  );
}
