import { CapacitySummary } from "./CapacitySummary";
import type { HotelMatch, Trip } from "../../../../shared/types";
import { useRef, useEffect } from "react";
import { dateFull } from "../../../shared/lib/date";
import { X, Footprints } from "lucide-react";
import { MatchBadge } from "./MatchBadge";
import { lodgingLabel } from "../../../shared/lib/presentation";
import { CriterionLine } from "./CriterionLine";
import { Link } from "react-router-dom";
import { Notice } from "../../../shared/ui/Feedback";

export function CompareDialog({
  matches,
  trip,
  onClose,
}: {
  matches: HotelMatch[];
  trip: Trip;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => {
      ref.current?.close();
    };
  }, []);
  const ids = [
    ...new Set(matches.flatMap((m) => m.best.criteria.map((c) => c.feature))),
  ];
  return (
    <dialog
      ref={ref}
      className="compare-dialog"
      onCancel={onClose}
      aria-labelledby="compare-title"
    >
      <div className="dialog-head">
        <div>
          <h2 id="compare-title">Сравним детали</h2>
          <p>
            Одна категория номера в каждом отеле. Для воздуха и шума показываем
            доступные данные и ограничения оценки.
          </p>
          <p className="muted">
            {dateFull(trip.checkIn)} — {dateFull(trip.checkOut)} · Пусан
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Закрыть сравнение"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      <div
        className="comparison-grid"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, matches.length)}, minmax(220px,1fr))`,
        }}
      >
        {matches.map((m) => (
          <section key={m.hotel.id}>
            <MatchBadge match={m} />
            {m.best.criteria.length > 0 && (
              <p className="muted">
                Совпало{" "}
                {m.best.criteria.filter((c) => c.status === "match").length} из{" "}
                {m.best.criteria.length}
              </p>
            )}
            <h3>{m.hotel.name}</h3>
            <p>{lodgingLabel(m.hotel)}</p>
            <p>{m.best.room.name}</p>
            <CapacitySummary match={m.best} />
            <div className="comparison-distance">
              <Footprints size={18} />
              {m.hotel.route?.meters ?? "—"} м до пляжа
            </div>
            {ids.map((id) => {
              const c = m.best.criteria.find((c) => c.feature === id);
              return c ? (
                <CriterionLine key={id} criterion={c} detailed />
              ) : (
                <p key={id}>Нет сведений</p>
              );
            })}
            <Link
              to={`/hotels/${m.hotel.id}?room=${m.best.room.id}`}
              className="button secondary"
              onClick={onClose}
            >
              Посмотреть детали
            </Link>
          </section>
        ))}
      </div>
      <Notice>
        Предположения отмечены отдельно от подтверждённых фактов. Цена и наличие
        на выбранные даты не проверены.
      </Notice>
    </dialog>
  );
}
