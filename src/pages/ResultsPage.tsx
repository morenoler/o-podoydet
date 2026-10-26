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
import { catalogRooms, recommendationItem, recommendationMatch, roomHotels } from "../features/search/roomResults";
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
  const [alternativeLimit, setAlternativeLimit] = useState(4);
  const [sort, setSort] = useState("recommended");
  const validTrip = canSearch(trip);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setLimit(8);
    setAlternativeLimit(4);
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
  const rooms = useMemo(() => {
    const items = data
      ? data.roomRecommendations.map(recommendationItem)
      : validTrip
        ? []
        : catalogRooms(catalog);
    if (sort === "distance")
      return [...items].sort(
        (a, b) => (a.hotel.route?.meters ?? Infinity) - (b.hotel.route?.meters ?? Infinity),
      );
    if (sort === "name")
      return [...items].sort((a, b) => a.room.name.localeCompare(b.room.name, "ru") || a.hotel.name.localeCompare(b.hotel.name, "ru"));
    if (!data)
      return [...items].sort(
        (a, b) =>
          Number(!!accommodationPhotos(b.hotel.id, b.hotel.photos).length) -
          Number(!!accommodationPhotos(a.hotel.id, a.hotel.photos).length),
      );
    return items;
  }, [data, catalog, sort, validTrip]);
  const visible = rooms.slice(0, limit);
  const alternatives = data?.roomAlternatives || [];
  const selectable = [...visible, ...alternatives.slice(0, alternativeLimit).map(recommendationItem)];
  const selected =
    selectable.find((item) => item.id === selectedId) || visible[0];
  const plotted = roomHotels(selected && !visible.some((item) => item.id === selected.id) ? [...visible, selected] : visible);
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
    if (selected?.hotel.id === hotel.id) return;
    setSelectedId(selectable.find((item) => item.hotel.id === hotel.id)?.id || "");
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
          map={<SearchMapPanel catalog={catalog} selected={selected?.hotel} selectedRoom={selected?.room} plotted={plotted} onSelect={selectHotel} />}
        />
        <section className="search-list-section" aria-label="Список номеров">
          <div className="search-results-heading">
            <div>
              <h1>
                {sea && validTrip ? "Номера у моря в Пусане" : "Номера в Пусане"}
              </h1>
              <p role="status" aria-live="polite">
                {loading
                  ? "Подбираем номера…"
                  : validTrip
                    ? `${rooms.length} категорий номеров соответствуют всем критериям`
                    : `${rooms.length} категорий номеров в каталоге Хэундэ`}
              </p>
            </div>
            <label className="search-sort">
              <span>Сначала</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="recommended">
                  {validTrip ? "По совпадению условий" : "С фотографиями отеля"}
                </option>
                <option value="distance">Ближе к пляжу</option>
                <option value="name">По названию номера</option>
              </select>
            </label>
          </div>
          {!validTrip && (
            <p className="search-preview-prompt">
              Выберите даты и гостей, чтобы проверить все критерии в одной категории номера.
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
              {!rooms.length && !error && validTrip && (
                <div className="search-empty">
                  <Search size={30} aria-hidden="true" />
                  <h2>Номер под все критерии пока не найден</h2>
                  <p>
                    Для рекомендации все условия должны совпасть в одном номере.
                    Пожелания сохранены; помощник покажет, каких сведений не хватает.
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
                {visible.map((item) => (
                  <HotelCard
                    key={item.id}
                    hotel={item.hotel}
                    previewRoom={item.room}
                    roomRecommendation={item.recommendation}
                    selected={item.id === selected?.id}
                    onSelect={() => setSelectedId(item.id)}
                    onShowMap={() => {
                      setSelectedId(item.id);
                      setMapView(true);
                      document.getElementById("search-side-panel")?.scrollIntoView({ block: "nearest" });
                    }}
                    compared={compare.includes(item.id)}
                    onCompare={data ? () => toggleCompare(item.id) : undefined}
                    compareDisabled={
                      compare.length >= 3 && !compare.includes(item.id)
                    }
                  />
                ))}
              </div>
              {rooms.length > limit && (
                <button
                  className="button secondary search-load-more"
                  onClick={() => setLimit((value) => value + 8)}
                >
                  Показать ещё {Math.min(8, rooms.length - limit)} категорий номеров
                </button>
              )}
              {!!alternatives.length && (
                <details className="search-room-alternatives">
                  <summary>Номера с несовпадениями или неполными данными ({alternatives.length})</summary>
                  <p>Эти категории не соответствуют всем критериям. Ниже видно, что не совпало или требует уточнения.</p>
                  <div className="search-hotel-list">
                    {alternatives.slice(0, alternativeLimit).map((item) => <HotelCard
                      key={item.id} roomRecommendation={item} alternative
                      selected={item.id === selected?.id}
                      onSelect={() => setSelectedId(item.id)}
                      onShowMap={() => {
                        setSelectedId(item.id);
                        setMapView(true);
                        document.getElementById("search-side-panel")?.scrollIntoView({ block: "nearest" });
                      }}
                    />)}
                  </div>
                  {alternatives.length > alternativeLimit && <button type="button" className="button secondary search-load-more" onClick={() => setAlternativeLimit((value) => value + 4)}>Показать ещё {Math.min(4, alternatives.length - alternativeLimit)} категорий</button>}
                </details>
              )}
              <p className="search-data-note">
                Подбираем конкретную категорию номера. Физический номер комнаты и наличие на даты уточняйте у отельера.
                {!!data?.unverifiedHotelCount && ` У ${data.unverifiedHotelCount} объектов нет подтверждённых категорий для рекомендации.`}
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
            <strong>{compare.length} из 3</strong> номеров для сравнения
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
          matches={data.roomRecommendations.filter((item) => compare.includes(item.id)).map(recommendationMatch)}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  );
}
