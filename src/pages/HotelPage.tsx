import { canSearch } from "../features/search/searchTrip";
import { SearchBar } from "../features/search/SearchBar";
import { HotelCatalogPreview } from "../features/hotels/components/HotelCatalogPreview";
import { HotelPhotoGallery } from "../features/hotels/components/HotelPhotoGallery";
import { FavoriteButton } from "../features/favorites/FavoriteButton";
import { roomDetailsLabel } from "../features/account/format";
import "../features/search/search.css";
import "../features/hotels/hotel-details.css";
import { CapacitySummary } from "../features/hotels/components/CapacitySummary";
import { PersonalWishesSummary } from "../features/hotels/components/PersonalWishesSummary";
import { MatchBadge } from "../features/hotels/components/MatchBadge";
import { matchForSelectedPreferences } from "../shared/lib/matchPresentation";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useApp } from "../app/providers/TripProvider";
import { useState, useEffect } from "react";
import type { HotelMatch, Hotel, Fact, Question } from "../../shared/types";
import { api } from "../shared/api/client";
import { ErrorMessage, Loading, Notice } from "../shared/ui/Feedback";
import { ArrowLeft, MapPin, ExternalLink, ShieldCheck } from "lucide-react";
import { TripSummary } from "../features/trip/components/TripSummary";
import { lodgingLabel } from "../shared/lib/presentation";
import { GeoMap } from "../features/map/components/GeoMap";
import { WishMatches } from "../features/hotels/components/WishMatches";
import { OwnerCriteriaSummary } from "../features/hotels/components/OwnerCriteriaSummary";
import { features } from "../../shared/features";
import { CriterionLine } from "../features/hotels/components/CriterionLine";
import { dateFull } from "../shared/lib/date";
import { AreaPanel } from "../features/area/components/AreaPanel";
import { FactEvidence } from "../features/hotels/components/FactEvidence";
import { accommodationPath } from "../shared/lib/accommodation";
import { CatalogClarificationPlan } from "../features/clarifications/CatalogClarificationPlan";
import "../features/clarifications/clarifications.css";

export function HotelPage() {
  const { id } = useParams();
  const { trip, setTrip, catalog, catalogError, revision, refresh } = useApp();
  const validTrip = canSearch(trip);
  const [params] = useSearchParams();
  const requestedRoom = params.get("room");
  const tripKey = JSON.stringify(trip);
  const [ranked, setRanked] = useState<HotelMatch | null>(null);
  const [data, setData] = useState<{
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
    Promise.all([
      api<typeof data>(`/hotels/${id}`),
      validTrip
        ? api<HotelMatch>(`/hotels/${id}/evaluate`, trip)
        : Promise.resolve(null),
    ])
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
  if (!data || !catalog || (validTrip && !ranked))
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
  const allConditionsMatch = room.status === "fits" && room.capacityEvidenceStatus === "match"
    && !room.capacityAssumed && room.room.evidenceStatus === "verified"
    && [...selectedCriteria, ...(ranked.ownerCriteria || [])].every((criterion) =>
      criterion.status === "match" && criterion.evidenceStatus === "match" && !criterion.assumed);
  return (
    <div className="page hotel-detail-page">
      <Link to="/results" className="back-link">
        <ArrowLeft size={16} />К подбору
      </Link>
      <SearchBar
        trip={trip}
        onSearch={(next) =>
          JSON.stringify(next) === JSON.stringify(trip)
            ? refresh()
            : setTrip(next)
        }
      />
      <div className="detail-heading">
        <div>
          <h1>{room.room.name}</h1>
          <p className="hotel-detail-hotel-name">{hotel.name}</p>
          <p className="address">
            <MapPin size={16} />
            {lodgingLabel(hotel)} · {hotel.address}
          </p>
          <p className="hotel-detail-room-meta">
            {roomDetailsLabel(hotel.floor, hotel.windowDirections)}
          </p>
        </div>
        <div className="hotel-detail-actions">
          <FavoriteButton
            label
            item={{
              id: `${hotel.id}::${room.room.id}`,
              name: `${room.room.name} · ${hotel.name}`,
              path: accommodationPath(hotel, room.room.id),
              hotelId: hotel.id,
              photos: hotel.photos,
              address: hotel.address,
            }}
          />
          {hotel.osmUrl && !labFixture && (
            <a
              href={hotel.osmUrl}
              className="button secondary"
              target="_blank"
              rel="noreferrer"
            >
              Объект на OSM <ExternalLink size={16} />
            </a>
          )}
        </div>
      </div>
      <HotelPhotoGallery hotel={hotel} />
      {requestedRoom && !ranked.rooms.some((entry) => entry.room.id === requestedRoom) && (
        <Notice>Сведения о запрошенной категории больше не доступны. Ниже показана другая категория; проверьте её условия заново.</Notice>
      )}
      {labFixture ? (
        <Notice>
          <strong>Вымышленное тестовое объявление.</strong>{" "}
          {hotel.dataNotes?.join(" ")} Демонстрационные сведения используются
          только для проверки работы этой копии.
        </Notice>
      ) : (
        <Notice>
          Подбор использует проверяемые источники. Недостающие сведения отмечены
          «Требует уточнения». Цена и наличие на даты поездки не проверены.
        </Notice>
      )}
      <div className="detail-grid">
        <section>
          {labFixture ? (
            <Notice>
              Координаты этого объявления условные. Карта реального размещения и
              маршрут для него не показываются.
            </Notice>
          ) : (
            <GeoMap dataset={catalog} hotel={hotel} />
          )}
          {hotel.route && (
            <div className="route-stats">
              <div>
                <strong>
                  {hotel.route?.meters ?? "—"} <small>м</small>
                </strong>
                <span>по пешеходной сети</span>
              </div>
              <div>
                <strong>
                  ≈ {hotel.route ? Math.ceil(hotel.route.meters / 65) : "—"}{" "}
                  <small>мин</small>
                </strong>
                <span>при скорости 65 м/мин</span>
              </div>
              <div>
                <strong>{hotel.route?.steps ?? "—"}</strong>
                <span>участков с лестницами</span>
              </div>
            </div>
          )}
          {hotel.route ? (
            <p className="muted map-caveat">
              Маршрут до подхода к пляжу «{hotel.route?.beachName}». Вход
              приближённый: {hotel.route?.connectionMeters} м до сети.
              Соединительные участки не включены в длину. Отсутствие отмеченных
              лестниц не подтверждает доступность всего пути.
            </p>
          ) : !labFixture ? (
            <Notice>
              Пешеходный маршрут до пляжа пока не рассчитан. На карте показано
              расположение объекта; расстояние и доступность пути остаются
              неизвестными.
            </Notice>
          ) : null}
          {hotel.route?.noStepsAlternative && (
            <Notice>
              Найден альтернативный путь без отмеченных лестниц:{" "}
              {hotel.route.noStepsAlternative.meters} м. Отображён пунктиром;
              доступность не обследована.
            </Notice>
          )}
          {!labFixture && (
            <div className="subsection">
              <h2>Что находится рядом</h2>
              <p>
                Возможные источники внешнего шума. Уровень шума внутри номера не
                измерен.
              </p>
              {hotel.noise.length ? (
                hotel.noise.map((n) => (
                  <a
                    className="noise-row"
                    key={n.osmUrl}
                    href={n.osmUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>
                      <span className="noise-dot" />
                      {n.name}
                    </span>
                    <span>
                      ≈ {n.meters} м <ExternalLink size={13} />
                    </span>
                  </a>
                ))
              ) : (
                <Notice>
                  В выгрузке не обнаружены учитываемые источники рядом. Это не
                  подтверждает тишину.
                </Notice>
              )}
              <p className="muted">
                Расстояния до ближайшей точки геометрии в выгрузке, по прямой.
              </p>
            </div>
          )}
        </section>
        <aside className="room-panel">
          <h2>{allConditionsMatch ? "Этот номер подходит по всем условиям" : "Условия выбранного номера"}</h2>
          <p>
            Все пожелания проверяются в одной категории. Наличие конкретного номера на даты нужно уточнить у отеля.
          </p>
          <label className="field">
            <span>Категория номера</span>
            <select
              value={roomId}
              onChange={(e) => {
                setRoomId(e.target.value);
              }}
            >
              {ranked.rooms.map((entry) => (
                <option key={entry.room.id} value={entry.room.id}>
                  {entry.room.name} ·{" "}
                  {entry.capacityRule
                    ? `до ${entry.capacityRule.maxGuests} гостей по правилу размещения`
                    : entry.room.capacity === null
                      ? "вместимость требует уточнения"
                      : `до ${entry.room.capacity} гостей`}
                </option>
              ))}
            </select>
          </label>
          {room.room.sourceUrl && (
            <p className="muted">
              <a href={room.room.sourceUrl} target="_blank" rel="noreferrer">
                Категория на сайте отеля <ExternalLink size={12} />
              </a>
              {room.room.quote && (
                <>
                  <br />
                  {room.room.quote}
                </>
              )}
            </p>
          )}
          <MatchBadge
            match={matchForSelectedPreferences(
              ranked,
              ranked.preferences || trip.preferences,
              room,
            )}
          />
          <CapacitySummary match={room} />
          {(selectedCriteria.length > 0 || !hasOwnerCriteria) && (
            <WishMatches criteria={selectedCriteria} />
          )}
          {hasOwnerCriteria && (
            <OwnerCriteriaSummary criteria={ranked.ownerCriteria} detailed />
          )}
          {!labFixture && (
            <CatalogClarificationPlan
              match={{
                ...ranked,
                preferences: ranked.preferences || trip.preferences,
              }}
              room={room}
            />
          )}
          <div className="room-criteria">
            <h3>Все условия номера</h3>
            {room.criteria
              .filter((c) => features[c.feature].tool !== "area")
              .map((c) => (
                <div className="room-criterion" key={c.feature}>
                  <CriterionLine criterion={c} />
                </div>
              ))}
          </div>
          <PersonalWishesSummary match={{ ...ranked, best: room }} />
          {error && <ErrorMessage text={error} />}
          <Notice>
            Это объект из исследовательского каталога. Задать вопрос владельцу и
            отправить заявку можно в{" "}
            <Link to="/stays">объявлениях отельеров</Link>.
          </Notice>
        </aside>
      </div>
      {!labFixture && (
        <section className="subsection trip-environment">
          <div className="environment-heading">
            <span className="note-icon">
              <ShieldCheck size={25} />
            </span>
            <div>
              <h2>Район на даты вашей поездки</h2>
              <p>
                {dateFull(trip.checkIn)} — {dateFull(trip.checkOut)} · время
                Пусана
              </p>
            </div>
          </div>
          <p>
            Эти условия одинаковы для всех номеров отеля. В основной список
            рекомендаций попадают категории, где совпали все выбранные пожелания.
          </p>
          {ranked.warnings?.map((text, i) => (
            <Notice key={`w${i}`}>{text}</Notice>
          ))}
          {ranked.conflicts?.map((text, i) => (
            <Notice key={`c${i}`}>{text}</Notice>
          ))}
          <div className="environment-criteria">
            {room.criteria
              .filter((c) => features[c.feature].tool === "area")
              .map((c) => (
                <div className="environment-criterion" key={c.feature}>
                  <CriterionLine criterion={c} detailed />
                  <span className="muted">
                    {ranked.preferences?.some((p) => p.feature === c.feature)
                      ? "Учтено в подборе"
                      : "Справочно · не выбрано в пожеланиях"}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}
      {!labFixture && <AreaPanel hotelId={hotel.id} />}
      <section className="subsection evidence-section">
        <h2>Почему мы так считаем</h2>
        <p>
          Источники и история для выбранной категории. Реальные факты отделены
          от демонстрации.
        </p>
        {facts
          .filter((f) => !f.roomId || f.roomId === roomId)
          .map((f) => (
            <FactEvidence
              key={f.id}
              fact={f}
              allowDemo={
                import.meta.env.VITE_LAB_MODE === "true" &&
                catalog.evidencePolicy === "demo"
              }
            />
          ))}
      </section>
    </div>
  );
}
