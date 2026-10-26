import { useEffect, useMemo, useState } from "react";
import {
  Check,
  GitCompareArrows,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { FeatureId, Hotel, SearchResult, Trip } from "../../shared/types";
import { useApp } from "../app/providers/TripProvider";
import { api } from "../shared/api/client";
import { ErrorMessage, Loading } from "../shared/ui/Feedback";
import { accommodationPhotos } from "../shared/lib/hotelPhotos";
import { HotelCard } from "../features/hotels/components/HotelCard";
import { CompareDialog } from "../features/hotels/components/CompareDialog";
import { AdvisorDrawer } from "../features/advisor/AdvisorDrawer";
import { SearchConversation } from "../features/advisor/SearchConversation";
import { useAuth } from "../features/auth/AuthProvider";
import { editPreferences } from "../features/search/preferences";
import { features } from "../../shared/features";
import { SearchBar } from "../features/search/SearchBar";
import { SearchDiagnostics } from "../features/search/SearchDiagnostics";
import { SearchMapPanel } from "../features/search/SearchMapPanel";
import { SearchFilters } from "../features/search/SearchFilters";
import { canSearch } from "../features/search/searchTrip";
import "../features/search/search.css";

export function ResultsPage() {
  const {
    trip,
    setTrip,
    catalog,
    catalogError,
    revision,
    rememberSearch,
    refresh,
    effectivePreferences,
  } = useApp();
  const { user } = useAuth();
  const [data, setData] = useState<SearchResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [filters, setFilters] = useState(false);
  const [advisor, setAdvisor] = useState(false);
  const [mapView, setMapView] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [limit, setLimit] = useState(8);
  const [sort, setSort] = useState("recommended");
  const validTrip = canSearch(trip);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setLimit(8);
    setCompare([]);
    setShowCompare(false);
    if (!validTrip) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<SearchResult>("/search", trip)
      .then((result) => {
        if (!active) return;
        setData(result);
        rememberSearch(trip, result.preferences);
        setLoading(false);
      })
      .catch((cause) => {
        if (active) {
          setError(cause.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [trip, revision, validTrip]);
  const hotels = useMemo(() => {
    const items = data
      ? data.results.map((result) => result.hotel)
      : validTrip
        ? []
        : [...(catalog?.hotels || [])];
    if (sort === "distance")
      return [...items].sort(
        (a, b) => (a.route?.meters ?? Infinity) - (b.route?.meters ?? Infinity),
      );
    if (sort === "name")
      return [...items].sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (!data)
      return [...items].sort(
        (a, b) =>
          Number(!!accommodationPhotos(b.id, b.photos).length) -
          Number(!!accommodationPhotos(a.id, a.photos).length),
      );
    return items;
  }, [data, catalog, sort, validTrip]);
  const visible = hotels.slice(0, limit);
  const selected =
    visible.find((hotel) => hotel.id === selectedId) || visible[0];
  const plotted = visible.filter(
    (hotel) => hotel.coordinates && !hotel.synthetic,
  );
  function submit(nextTrip: Trip) {
    if (JSON.stringify(nextTrip) === JSON.stringify(trip)) refresh();
    else setTrip(nextTrip);
  }
  function toggleCompare(id: string) {
    setCompare((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : previous.length < 3
          ? [...previous, id]
          : previous,
    );
  }
  function quickFilter(feature: FeatureId) {
    const preferences = effectivePreferences.some(
      (value) => value.feature === feature,
    )
      ? effectivePreferences.filter((value) => value.feature !== feature)
      : [...effectivePreferences, { feature, required: false }];
    setTrip(editPreferences(trip, preferences, effectivePreferences));
  }
  function selectHotel(hotel: Hotel) {
    setSelectedId(hotel.id);
  }
  const sea = (data?.preferences || trip.preferences).some(
    (value) => value.feature === "beach_walk",
  );
  return (
    <div className="search-page search-page-conversation">
      <div className="search-layout">
        <div className="search-primary">
      <SearchBar trip={trip} onSearch={submit} busy={loading} />
      <div className="search-toolbar">
        <button
          type="button"
          className="search-chip"
          onClick={() => setFilters(true)}
        >
          <SlidersHorizontal size={21} aria-hidden="true" />
          Фильтры
          {!!effectivePreferences.length && (
            <span className="search-filter-count">
              {effectivePreferences.length}
            </span>
          )}
        </button>
        {(
          [
            { id: "beach_walk", label: "У моря" },
            { id: "family", label: "Для семьи" },
            { id: "step_free_access", label: "С коляской" },
          ] as const
        ).map((item, index) => (
          <button
            type="button"
            className={`search-chip ${index > 0 ? "search-chip-extra " : ""}${effectivePreferences.some((value) => value.feature === item.id) ? "is-active" : ""}`}
            key={item.id}
            aria-pressed={effectivePreferences.some(
              (value) => value.feature === item.id,
            )}
            onClick={() => quickFilter(item.id)}
          >
            {effectivePreferences.some((value) => value.feature === item.id) && (
              <Check size={19} aria-hidden="true" />
            )}
            {item.label}
          </button>
        ))}
      </div>
      {!!effectivePreferences.length && (
        <div className="search-active-preferences" aria-label="Активные условия подбора">
          {effectivePreferences.map((preference) => (
            <button key={preference.feature} type="button" onClick={() => quickFilter(preference.feature)}
              aria-label={`Убрать условие: ${features[preference.feature].label}${preference.required ? ", обязательное" : ""}`}>
              <span>{features[preference.feature].label}{preference.required && <strong>Обязательно</strong>}</span>
              <X size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      {(error || catalogError) && (
        <div className="search-error">
          <ErrorMessage text={error || catalogError} />
          <button
            className="button secondary"
            onClick={error ? refresh : () => window.location.reload()}
          >
            Повторить
          </button>
        </div>
      )}
        </div>
        <SearchConversation
          key={user?.id || "guest"}
          scope={user?.id || "guest"}
          trip={trip}
          onApply={setTrip}
          result={data}
          searching={loading}
          searchError={error}
          onAnalyze={() => setAdvisor(true)}
          mapView={mapView}
          onMapViewChange={setMapView}
          map={<SearchMapPanel catalog={catalog} selected={selected} plotted={plotted} onSelect={selectHotel} />}
        />
        <section className="search-list-section" aria-label="Список отелей">
          <div className="search-results-heading">
            <div>
              <h1>
                {sea && validTrip ? "Отели у моря в Пусане" : "Отели в Пусане"}
              </h1>
              <p role="status" aria-live="polite">
                {loading
                  ? "Подбираем варианты…"
                  : validTrip
                    ? `${hotels.length} вариантов по вашим условиям`
                    : `${hotels.length} вариантов в каталоге Хэундэ`}
              </p>
            </div>
            <label className="search-sort">
              <span>Сначала</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="recommended">
                  {validTrip ? "Подходящие" : "С фотографиями"}
                </option>
                <option value="distance">Ближе к пляжу</option>
                <option value="name">По названию</option>
              </select>
            </label>
          </div>
          {!validTrip && (
            <p className="search-preview-prompt">
              Выберите даты и гостей для подбора по вашим условиям.
            </p>
          )}
          {loading || (!catalog && !catalogError) ? (
            <Loading />
          ) : (
            <>
              {data?.conflicts.map((conflict) => (
                <ErrorMessage key={conflict} text={conflict} />
              ))}
              {!!data?.conflicts.length && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setFilters(true)}
                >
                  Исправить пожелания
                </button>
              )}
              {!hotels.length && !error && validTrip && (
                <div className="search-empty">
                  <Search size={30} aria-hidden="true" />
                  <h2>Точного совпадения пока нет</h2>
                  <p>
                    Обязательные условия сохранены. Помощник объяснит, что
                    исключило варианты и какие сведения стоит уточнить.
                  </p>
                  <button
                    className="button primary"
                    onClick={() => setAdvisor(true)}
                  >
                    Разобраться с помощником
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => setFilters(true)}
                  >
                    Изменить фильтры
                  </button>
                </div>
              )}
              <div className="search-hotel-list">
                {visible.map((hotel) => (
                  <HotelCard
                    key={hotel.id}
                    hotel={hotel}
                    match={data?.results.find(
                      (result) => result.hotel.id === hotel.id,
                    )}
                    selected={hotel.id === selected?.id}
                    onSelect={() => selectHotel(hotel)}
                    onShowMap={() => {
                      selectHotel(hotel);
                      setMapView(true);
                      document.getElementById("search-side-panel")?.scrollIntoView({ block: "nearest" });
                    }}
                    compared={compare.includes(hotel.id)}
                    onCompare={data ? () => toggleCompare(hotel.id) : undefined}
                    compareDisabled={
                      compare.length >= 3 && !compare.includes(hotel.id)
                    }
                  />
                ))}
              </div>
              {hotels.length > limit && (
                <button
                  className="button secondary search-load-more"
                  onClick={() => setLimit((value) => value + 8)}
                >
                  Показать ещё {Math.min(8, hotels.length - limit)} вариантов
                </button>
              )}
              <p className="search-data-note">
                Условия и наличие уточняйте у отельера. Источники и
                предположения указаны в подробностях.
                {catalog?.evidencePolicy === "demo" &&
                  " Варианты «ДЕМО» вымышлены."}
              </p>
              {data && <SearchDiagnostics data={data} />}
            </>
          )}
        </section>
      </div>
      {filters && (
        <SearchFilters
          trip={trip}
          preferences={effectivePreferences}
          onApply={submit}
          onClose={() => setFilters(false)}
        />
      )}
      <AdvisorDrawer
        open={advisor}
        onClose={() => setAdvisor(false)}
        trip={trip}
        result={data}
        onRefresh={refresh}
      />
      {compare.length > 0 && (
        <div className="compare-tray search-compare-tray" role="status">
          <span>
            <strong>{compare.length} из 3</strong> для сравнения
          </span>
          <button
            className="button primary"
            disabled={compare.length < 2}
            onClick={() => setShowCompare(true)}
          >
            Сравнить <GitCompareArrows size={18} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            aria-label="Очистить сравнение"
            onClick={() => setCompare([])}
          >
            <X size={20} />
          </button>
        </div>
      )}
      {showCompare && data && (
        <CompareDialog
          trip={trip}
          matches={[...data.results, ...data.excluded].filter((match) =>
            compare.includes(match.hotel.id),
          )}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  );
}
