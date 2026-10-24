import { useApp } from "../app/providers/TripProvider";
import { useSearchParams, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import type { Question, FeatureId } from "../../shared/types";
import { api } from "../shared/api/client";
import { today } from "../shared/lib/date";
import { MessageCircle, ChevronDown, Sparkles, ArrowLeft } from "lucide-react";
import { Notice, Loading, ErrorMessage } from "../shared/ui/Feedback";
import { featureIds, features } from "../../shared/features";
import { QuestionCard } from "../features/host/components/QuestionCard";

export function HostPage() {
  const { catalog, trip, refresh } = useApp();
  const [params, setParams] = useSearchParams();
  const [questions, setQuestions] = useState<Question[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [hotelId, setHotelId] = useState(params.get("hotel") || ""),
    [roomId, setRoomId] = useState(""),
    [feature, setFeature] = useState<FeatureId>("step_free_access"),
    [loading, setLoading] = useState(false);
  const hotel =
    catalog?.hotels.find((h) => h.id === hotelId) || catalog?.hotels[0];
  const load = () =>
    api<Question[]>("/questions")
      .then(setQuestions)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (hotel) {
      setHotelId(hotel.id);
      setRoomId(hotel.rooms[0]?.id || "");
    }
  }, [hotel?.id]);
  async function create() {
    if (!hotel) return;
    setLoading(true);
    setError("");
    try {
      const validTrip =
        trip.checkIn && trip.checkOut
          ? trip
          : {
              ...trip,
              checkIn: today(),
              checkOut: new Date(Date.now() + 86400000)
                .toISOString()
                .slice(0, 10),
            };
      const result = await api<{ message: string }>("/questions", {
        hotelId: hotel.id,
        roomId,
        feature,
        trip: validTrip,
      });
      setNotice(result.message);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="page">
      <div className="host-heading">
        <div>
          <span className="tag demo">Демонстрационный кабинет</span>
          <h1>Расскажите о деталях</h1>
          <p className="lead">
            Ответьте один раз — и помогите гостям выбрать подходящий номер.
          </p>
        </div>
        <span className="host-icon">
          <MessageCircle size={38} />
        </span>
      </div>
      <Notice>
        {import.meta.env.VITE_LAB_MODE === "true" &&
        catalog?.evidencePolicy === "demo" ? (
          "Вы играете роль отельера в тестовой копии. Подтверждённые демонстрационные ответы меняют только подбор этой копии. Это не сведения, полученные от реальных отелей."
        ) : (
          <>
            Вы играете роль отельера. Ответы сохраняются локально как
            демонстрационные и не подтверждают условия в подборе. Это не
            сведения, полученные от реальных отелей.
          </>
        )}
      </Notice>
      {!catalog ? (
        <Loading />
      ) : (
        <>
          <div className="host-toolbar">
            <label className="field">
              <span>Отель</span>
              <select
                value={hotel?.id || ""}
                onChange={(e) => {
                  setHotelId(e.target.value);
                  setParams({ hotel: e.target.value });
                  setNotice("");
                }}
              >
                {catalog.hotels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="host-mode">
              <span className="live-dot" />
              {catalog.mode === "llm"
                ? "Подключена языковая модель"
                : "Локальный разбор по правилам"}
              <small>
                {catalog.mode === "rules"
                  ? "Работает без API-ключа. Не понимает произвольные формулировки."
                  : "С проверкой структуры и цитат перед сохранением."}
              </small>
            </div>
          </div>
          <details
            className="disclosure host-create"
            open={
              !questions.some(
                (q) => q.hotelId === hotel?.id && q.status === "open",
              )
            }
          >
            <summary>
              Создать уточнение для демонстрации <ChevronDown size={16} />
            </summary>
            <div className="host-create-fields">
              <label className="field">
                <span>Категория номера</span>
                <select
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                >
                  {hotel?.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Что уточнить</span>
                <select
                  value={feature}
                  onChange={(e) => setFeature(e.target.value as FeatureId)}
                >
                  {featureIds
                    .filter((f) => features[f].tool === "host")
                    .map((f) => (
                      <option key={f} value={f}>
                        {features[f].label}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="button primary"
                onClick={create}
                disabled={loading}
              >
                {loading ? "Готовим вопрос…" : "Сформулировать вопрос"}
                <Sparkles size={17} />
              </button>
            </div>
          </details>
          {error && <ErrorMessage text={error} />}{" "}
          {notice && (
            <div role="status" className="small-status">
              {notice}
            </div>
          )}
          <div className="questions-list">
            {questions
              .filter((q) => q.hotelId === hotel?.id)
              .map((q) => (
                <QuestionCard
                  key={`${q.id}-${q.status}-${q.createdAt}`}
                  question={q}
                  onSaved={() => {
                    load();
                    refresh();
                  }}
                />
              ))}
          </div>
          {!questions.some((q) => q.hotelId === hotel?.id) && (
            <div className="empty">
              <MessageCircle size={30} />
              <h2>Вопросов пока нет</h2>
              <p>
                Создайте уточнение выше или откройте неизвестное условие в
                карточке отеля.
              </p>
            </div>
          )}
          <Link
            to={trip.checkIn ? `/hotels/${hotel?.id}` : "/"}
            className="button secondary"
          >
            <ArrowLeft size={16} />
            Посмотреть результат для гостя
          </Link>
        </>
      )}
    </div>
  );
}
