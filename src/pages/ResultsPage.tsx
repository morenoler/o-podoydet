import { useApp } from "../app/providers/TripProvider";
import { useState, useEffect } from "react";
import type { SearchResult } from "../../shared/types";
import { api } from "../shared/api/client";
import { Steps } from "../app/layout/Steps";
import { TripSummary } from "../features/trip/components/TripSummary";
import {
  SlidersHorizontal,
  ArrowRight,
  ChevronDown,
  Search,
  GitCompareArrows,
  X,
} from "lucide-react";
import { PreferencePicker } from "../features/preferences/PreferencePicker";
import { Link } from "react-router-dom";
import { Notice, ErrorMessage, Loading } from "../shared/ui/Feedback";
import { features } from "../../shared/features";
import { HotelCard } from "../features/hotels/components/HotelCard";
import { CompareDialog } from "../features/hotels/components/CompareDialog";

export function ResultsPage() {
  const { trip, setTrip, catalog, revision, rememberSearch } = useApp();
  const [data, setData] = useState<SearchResult | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [compare, setCompare] = useState<string[]>([]),
    [showCompare, setShowCompare] = useState(false),
    [filter, setFilter] = useState(false),
    [limit, setLimit] = useState(8);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<SearchResult>("/search", trip)
      .then((d) => {
        if (active) {
          setData(d);
          rememberSearch(trip, d.preferences);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [trip, revision]);
  const toggle = (id: string) =>
    setCompare((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 3
          ? [...prev, id]
          : prev,
    );
  return (
    <div className="page">
      <Steps current={2} />
      <TripSummary trip={trip} />
      <div className="results-heading">
        <div>
          <h1>Место, где вам подойдёт</h1>
          <p>
            {data && !loading
              ? `${data.results.length} вариантов по вашим условиям`
              : "Подбираем варианты для вашей поездки"}
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => setFilter((x) => !x)}
          aria-expanded={filter}
        >
          <SlidersHorizontal size={17} />
          Пожелания
          {(data?.preferences.length ?? trip.preferences.length) > 0 && (
            <span className="count">
              {data?.preferences.length ?? trip.preferences.length}
            </span>
          )}
        </button>
      </div>
      {filter && (
        <section className="filter-panel">
          <PreferencePicker
            preferences={trip.preferences}
            onChange={(preferences) => setTrip({ ...trip, preferences })}
          />
          <Link to="/wishes" className="text-link">
            Изменить сценарий и текстовое пожелание <ArrowRight size={16} />
          </Link>
        </section>
      )}
      <Notice>
        География — из OpenStreetMap, условия номеров — из официальных
        источников. Когда данных недостаточно, используем оценку с пометкой
        «Предположение». Наличие номеров на ваши даты не проверено.
      </Notice>
      {error && <ErrorMessage text={error} />}{" "}
      {loading ? (
        <Loading />
      ) : (
        data && (
          <>
            {data.conflicts.map((c) => (
              <ErrorMessage key={c} text={c} />
            ))}
            {data.conflicts.length > 0 && (
              <Link to="/wishes" className="button secondary">
                Исправить пожелания
              </Link>
            )}
            {data.warnings.length > 0 && (
              <details className="disclosure text-recognition">
                <summary>
                  Как поняли текстовое пожелание <ChevronDown size={16} />
                </summary>
                {data.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
                <div className="tag-row">
                  {data.preferences.map((p) => (
                    <span className="tag" key={p.feature}>
                      {features[p.feature].label}
                      {p.required ? " · обязательно" : ""}
                    </span>
                  ))}
                </div>
                <Link to="/wishes" className="text-link">
                  Исправить
                </Link>
              </details>
            )}
            {!data.results.length && !data.conflicts.length && (
              <div className="empty">
                <Search size={32} />
                <h2>Точного совпадения пока нет</h2>
                <p>
                  Обязательные условия сохранены. Можно изменить состав гостей
                  или снять обязательность отдельных пожеланий.
                </p>
                <Link to="/wishes" className="button primary">
                  Пересмотреть пожелания
                </Link>
              </div>
            )}
            <div className="hotel-grid">
              {data.results.slice(0, limit).map((m) => (
                <HotelCard
                  key={m.hotel.id}
                  match={m}
                  dataset={catalog}
                  compared={compare.includes(m.hotel.id)}
                  compareDisabled={
                    compare.length >= 3 && !compare.includes(m.hotel.id)
                  }
                  onCompare={() => toggle(m.hotel.id)}
                />
              ))}
            </div>
            {data.results.length > limit && (
              <button
                className="button secondary load-more"
                onClick={() => setLimit((x) => x + 8)}
              >
                Показать ещё {Math.min(8, data.results.length - limit)}{" "}
                вариантов
              </button>
            )}
            {data.excluded.length > 0 && (
              <details className="disclosure">
                <summary>
                  {data.excluded.length} вариантов не прошли обязательные
                  условия <ChevronDown size={16} />
                </summary>
                {data.excluded.map((m) => (
                  <div className="excluded-row" key={m.hotel.id}>
                    <Link to={`/hotels/${m.hotel.id}`}>{m.hotel.name}</Link>
                    <span>
                      {m.best.capacityStatus === "mismatch"
                        ? "Недостаточная вместимость категорий"
                        : m.best.criteria
                            .filter(
                              (c) => c.required && c.status === "mismatch",
                            )
                            .map((c) => features[c.feature].label)
                            .join(", ")}
                    </span>
                  </div>
                ))}
              </details>
            )}
            <details className="disclosure">
              <summary>
                Как получен подбор <ChevronDown size={16} />
              </summary>
              {data.trace.map((t) => (
                <p key={t.step}>
                  <strong>{t.step}.</strong> {t.detail}
                </p>
              ))}
            </details>
          </>
        )
      )}
      {compare.length > 0 && (
        <div className="compare-tray" role="status">
          <span>
            <strong>{compare.length} из 3</strong> для сравнения
          </span>
          <button
            className="button primary"
            disabled={compare.length < 2}
            onClick={() => setShowCompare(true)}
          >
            Сравнить <GitCompareArrows size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Очистить сравнение"
            onClick={() => setCompare([])}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {showCompare && data && (
        <CompareDialog
          trip={trip}
          matches={[...data.results, ...data.excluded].filter((m) =>
            compare.includes(m.hotel.id),
          )}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  );
}
