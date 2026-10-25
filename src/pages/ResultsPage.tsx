import { useEffect, useMemo, useState } from "react";
import {
  Check,
  GitCompareArrows,
  List,
  Map,
  Search,
  SlidersHorizontal,
  Sparkles,
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
import { SearchBar } from "../features/search/SearchBar";
import { SearchDiagnostics } from "../features/search/SearchDiagnostics";
import { SearchMapPanel } from "../features/search/SearchMapPanel";
import { SearchFilters } from "../features/search/SearchFilters";
import { canSearch } from "../features/search/searchTrip";
import { AdmissionModePicker } from "../features/search/AdmissionModePicker";
import { listLimitForSelection, uiAdmissionMode } from "../features/search/searchPolicy";
import { features } from "../../shared/features";
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
  } = useApp();
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
    hotels.find((hotel) => hotel.id === selectedId) || hotels[0];
  const plotted = hotels.filter(
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
    const preferences = trip.preferences.some(
      (value) => value.feature === feature,
    )
      ? trip.preferences.filter((value) => value.feature !== feature)
      : [...trip.preferences, { feature, required: false }];
    setTrip({ ...trip, preferences });
  }
  function selectHotel(hotel: Hotel) {
    setSelectedId(hotel.id);
    setLimit((current) => listLimitForSelection(hotels, current, hotel.id));
  }
  const provisionalCount = data?.results.filter((result) => result.best.provisional).length || 0;
  const sea = (data?.preferences || trip.preferences).some(
    (value) => value.feature === "beach_walk",
  );
  return (
    <div className={`search-page${mapView ? " is-map-view" : ""}`}>
      <SearchBar trip={trip} onSearch={submit} busy={loading} />
      <div className="search-toolbar">
        <button
          type="button"
          className="search-chip"
          onClick={() => setFilters(true)}
        >
          <SlidersHorizontal size={21} aria-hidden="true" />
          Фильтры
          {!!trip.preferences.length && (
            <span className="search-filter-count">
              {trip.preferences.length}
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
            className={`search-chip ${index > 0 ? "search-chip-extra " : ""}${trip.preferences.some((value) => value.feature === item.id) ? "is-active" : ""}`}
            key={item.id}
            aria-pressed={trip.preferences.some(
              (value) => value.feature === item.id,
            )}
            onClick={() => quickFilter(item.id)}
          >
            {trip.preferences.some((value) => value.feature === item.id) && (
              <Check size={19} aria-hidden="true" />
            )}
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className="search-ai-trigger"
          onClick={() => setAdvisor(true)}
        >
          <Sparkles size={23} aria-hidden="true" />
          <span className="search-ai-full">AI-помощник</span>
          <span className="search-ai-short">AI</span>
        </button>
      </div>
      <AdmissionModePicker value={trip.admissionMode}
        onChange={(admissionMode) => setTrip({ ...trip, admissionMode })} />
      {!!trip.preferences.length && (
        <div className="search-selected-preferences" aria-label="Выбранные пожелания">
          {trip.preferences.map((preference) => (
            <button type="button" key={preference.feature}
              onClick={() => quickFilter(preference.feature)}
              aria-label={`Убрать пожелание: ${features[preference.feature].label}`}>
              <span>{features[preference.feature].label} · {preference.required ? "обязательно" : "желательно"}</span>
              <X size={14} aria-hidden="true" />
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
      <div className="search-workspace">
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
                    ? `Вариантов по вашим условиям: ${hotels.length}`
                    : `${hotels.length} вариантов в каталоге Хэундэ`}
              </p>
              {validTrip && !loading && provisionalCount > 0 && (
                <p className="search-provisional-count">
                  В {provisionalCount} вариантах нужно уточнить вместимость или обязательные условия.
                </p>
              )}
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
                    {uiAdmissionMode(trip.admissionMode) === "verified"
                      ? "Для этих условий пока нет полностью подтверждённых вариантов. Можно посмотреть варианты для уточнения, сохранив ваши пожелания."
                      : "По выбранным обязательным условиям есть несоответствия или противоречивые сведения. Измените пожелания или посмотрите объяснения ниже."}
                  </p>
                  {uiAdmissionMode(trip.admissionMode) === "verified" && <button
                    className="button primary"
                    onClick={() => setTrip({ ...trip, admissionMode: "explore" })}
                  >
                    Посмотреть варианты для уточнения
                  </button>}
                  <button
                    className="button secondary"
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
                      if (window.matchMedia("(max-width: 900px)").matches) {
                        setMapView(true);
                        window.scrollTo({ top: 0 });
                      }
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
                Недостающие сведения отмечены отдельно и не считаются подтверждением.
                Источники указаны в подробностях. Наличие на ваши даты не проверено.
                {catalog?.evidencePolicy === "demo" &&
                  " Варианты «ДЕМО» вымышлены."}
              </p>
              {data && <SearchDiagnostics data={data} />}
            </>
          )}
        </section>
        <SearchMapPanel
          catalog={catalog}
          selected={selected}
          plotted={plotted}
          onSelect={selectHotel}
        />
      </div>
      <button
        className="button primary search-map-toggle"
        onClick={() => setMapView((value) => !value)}
        aria-pressed={mapView}
      >
        {mapView ? (
          <List size={23} aria-hidden="true" />
        ) : (
          <Map size={23} aria-hidden="true" />
        )}
        {mapView ? "Списком" : "На карте"}
      </button>
      {filters && (
        <SearchFilters
          trip={trip}
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
