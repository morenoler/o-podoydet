import { CapacitySummary } from "../features/hotels/components/CapacitySummary";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useApp } from "../app/providers/TripProvider";
import { useState, useEffect } from "react";
import type {
  HotelMatch,
  Hotel,
  Fact,
  Question,
  FeatureId,
} from "../../shared/types";
import { api } from "../shared/api/client";
import { ErrorMessage, Loading, Notice } from "../shared/ui/Feedback";
import {
  ArrowLeft,
  MapPin,
  ExternalLink,
  MessageCircle,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { TripSummary } from "../features/trip/components/TripSummary";
import { lodgingLabel } from "../shared/lib/presentation";
import { GeoMap } from "../features/map/components/GeoMap";
import { WishMatches } from "../features/hotels/components/WishMatches";
import { features } from "../../shared/features";
import { CriterionLine } from "../features/hotels/components/CriterionLine";
import { dateFull } from "../shared/lib/date";
import { AreaPanel } from "../features/area/components/AreaPanel";
import { FactEvidence } from "../features/hotels/components/FactEvidence";

export function HotelPage() {
  const { id } = useParams();
  const { trip, catalog, revision } = useApp();
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
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null);
    setRanked(null);
    setError("");
    Promise.all([
      api<typeof data>(`/hotels/${id}`),
      api<HotelMatch>(`/hotels/${id}/evaluate`, trip),
    ])
      .then(([d, evaluation]) => {
        if (active) {
          setData(d);
          setRanked(evaluation);
          if (d)
            setRoomId(
              d.hotel.rooms.some((r) => r.id === requestedRoom)
                ? requestedRoom!
                : evaluation.best.room.id,
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
  async function ask(feature: FeatureId) {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ message: string; question: Question | null }>(
        "/questions",
        { hotelId: id, roomId, feature, trip },
      );
      setMessage(result.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (error && !data)
    return (
      <div className="page">
        <ErrorMessage text={error} />
      </div>
    );
  if (!data || !catalog || !ranked)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  const { hotel, facts } = data;
  const labFixture =
    import.meta.env.VITE_LAB_MODE === "true" &&
    hotel.id.startsWith("lab-demo-");
  const room = ranked.rooms.find((r) => r.room.id === roomId) || ranked.best;
  return (
    <div className="page">
      <Link to="/results" className="back-link">
        <ArrowLeft size={16} />К подбору
      </Link>
      <TripSummary trip={trip} />
      <div className="detail-heading">
        <div>
          <h1>{hotel.name}</h1>
          <p className="address">
            <MapPin size={16} />
            {lodgingLabel(hotel)} · {hotel.address}
          </p>
        </div>
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
      {labFixture ? (
        <Notice>
          <strong>Вымышленное тестовое объявление.</strong>{" "}
          {hotel.dataNotes?.join(" ")} Демонстрационные сведения используются
          только для проверки работы этой копии.
        </Notice>
      ) : (
        <Notice>
          Подбор использует проверяемые источники и оценки. Расчётные выводы
          отмечены как «Предположение». Цена и наличие на даты поездки не
          проверены.
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
          <h2>Проверим один номер</h2>
          <p>
            Сильные стороны разных категорий не складываются в один вариант.
          </p>
          <label className="field">
            <span>Категория номера</span>
            <select
              value={roomId}
              onChange={(e) => {
                setRoomId(e.target.value);
                setMessage("");
              }}
            >
              {ranked.rooms.map((entry) => (
                <option key={entry.room.id} value={entry.room.id}>
                  {entry.room.name} ·{" "}
                  {entry.capacityAssumed
                    ? `до ${entry.estimatedCapacity} гостей (предположение)`
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
          <CapacitySummary match={room} />
          <WishMatches
            criteria={room.criteria.filter((c) =>
              (ranked.preferences || trip.preferences).some(
                (p) => p.feature === c.feature,
              ),
            )}
          />
          <div className="room-criteria">
            <h3>Все условия номера</h3>
            {room.criteria
              .filter((c) => features[c.feature].tool !== "area")
              .map((c) => (
                <div className="room-criterion" key={c.feature}>
                  <CriterionLine criterion={c} />
                  {catalog.evidencePolicy === "demo" &&
                    ["unknown", "conflict", "stale"].includes(
                      c.evidenceStatus || "",
                    ) && (
                      <button
                        className="text-link"
                        type="button"
                        disabled={busy}
                        onClick={() => ask(c.feature)}
                      >
                        {c.evidenceStatus === "conflict"
                          ? "Разобраться в противоречии"
                          : "Уточнить условие"}{" "}
                        <MessageCircle size={14} />
                      </button>
                    )}
                </div>
              ))}
          </div>
          {error && <ErrorMessage text={error} />}{" "}
          {message && (
            <div className="notice" role="status">
              <CheckCircle2 size={18} />
              <span>
                {message} <Link to={`/host?hotel=${id}`}>Открыть кабинет</Link>
              </span>
            </div>
          )}
          {catalog.evidencePolicy === "demo" && (
            <Link to={`/host?hotel=${id}`} className="button secondary wide">
              Демонстрационный кабинет <ArrowRight size={16} />
            </Link>
          )}
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
            Эти условия одинаковы для всех номеров отеля. «Обязательно» влияет
            на допуск к подбору; остальные пожелания влияют на порядок
            вариантов.
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
