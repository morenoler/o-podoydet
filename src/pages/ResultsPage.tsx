import { useEffect, useMemo, useState } from "react";
import {
  GitCompareArrows,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { FeatureId, Hotel, SearchResult, Trip } from "../../shared/types";
import { useApp } from "../app/providers/TripProvider";
import { useAuth } from "../features/auth/AuthProvider";
import { api } from "../shared/api/client";
import { ErrorMessage, Loading } from "../shared/ui/Feedback";
import { accommodationPhotos } from "../shared/lib/hotelPhotos";
import { HotelCard } from "../features/hotels/components/HotelCard";
import { MappedHotelCard } from "../features/hotels/components/MappedHotelCard";
import { nearbyConditionLabel } from "../../shared/nearby";
import { CompareDialog } from "../features/hotels/components/CompareDialog";
import { AdvisorDrawer } from "../features/advisor/AdvisorDrawer";
import { SearchConversation } from "../features/advisor/SearchConversation";
import { editPreferences } from "../features/search/preferences";
import { features } from "../../shared/features";
import { SearchBar } from "../features/search/SearchBar";
import { SearchDiagnostics } from "../features/search/SearchDiagnostics";
import { SearchMapPanel } from "../features/search/SearchMapPanel";
import { SearchFilters } from "../features/search/SearchFilters";
import { canSearch } from "../features/search/searchTrip";
import { catalogHotelCandidates, catalogRooms, recommendationItem, recommendationMatch, roomHotels } from "../features/search/roomResults";
import { listLimitForSelection, uiAdmissionMode } from "../features/search/searchPolicy";
import { countHotelFilters, hasHotelFilters, matchesHotelFilters } from "../../shared/catalogFilters";
import { lodgingLabels } from "../features/search/CatalogFilterFields";
import "../features/search/search.css";
import "../features/search/catalog-filters.css";

export function ResultsPage() {
  const { user, loading: authLoading } = useAuth();
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
  const [data, setData] = useState<SearchResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [filters, setFilters] = useState(false);
  const [advisor, setAdvisor] = useState(false);
  const [mapView, setMapView] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [limit, setLimit] = useState(8);
  const [hotelLimit, setHotelLimit] = useState(8);
  const [alternativeLimit, setAlternativeLimit] = useState(4);
  const [alternativesOpen, setAlternativesOpen] = useState(false);
  const [sort, setSort] = useState("recommended");
  const [query, setQuery] = useState(trip.hotelFilters?.query || "");
  useEffect(() => setQuery(trip.hotelFilters?.query || ""), [trip.hotelFilters?.query]);
  const validTrip = canSearch(trip);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setData(null);
    setError("");
    setLimit(8);
    setHotelLimit(8);
    setAlternativeLimit(4);
    setCompare([]);
    setShowCompare(false);
    if (!validTrip || authLoading) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<SearchResult>("/search", trip, controller.signal)
      .then((result) => {
        if (!active) return;
        setData(result);
        setAlternativesOpen(!result.roomRecommendations.length);
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
      controller.abort();
    };
  }, [trip, revision, validTrip, authLoading, user?.id]);
  const rooms = useMemo(() => {
    const items = data
      ? data.roomRecommendations.map(recommendationItem)
      : validTrip
        ? []
        : catalogRooms(catalog).filter((item) => matchesHotelFilters(item.hotel, trip.hotelFilters, catalog?.facts, item.room));
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
  }, [data, catalog, sort, validTrip, trip.hotelFilters]);
  const visible = rooms.slice(0, limit);
  const hotelCandidates = useMemo(() => {
    const candidates = data?.hotelCandidates || (validTrip ? [] : catalogHotelCandidates(catalog, trip.hotelFilters));
    const distanceScore = (candidate: (typeof candidates)[number]) => (trip.hotelFilters?.nearby || []).reduce((score, condition) => score + (candidate.nearbyMatches.find((place) => place.kind === condition.kind)?.meters ?? Infinity) / condition.maxMeters, 0);
    return [...candidates].sort((a, b) => sort === "distance" ? (a.hotel.route?.meters ?? Infinity) - (b.hotel.route?.meters ?? Infinity)
      : (sort === "recommended" ? distanceScore(a) - distanceScore(b) : 0) || a.hotel.name.localeCompare(b.hotel.name, "ru"));
  }, [data, validTrip, catalog, trip.hotelFilters, sort]);
  const alternatives = data?.roomAlternatives || [];
  const selectable = [...rooms, ...alternatives.map(recommendationItem)];
  const selected =
    selectable.find((item) => item.id === selectedId) || (hotelCandidates.some((item) => item.hotel.id === selectedId) ? undefined : selectable[0]);
  const selectedHotel = selected?.hotel || (hotelCandidates.find((item) => item.hotel.id === selectedId) || hotelCandidates[0])?.hotel;
  const plotted = [...new Map([...roomHotels(selectable), ...hotelCandidates.map((item) => item.hotel)].map((hotel) => [hotel.id, hotel])).values()];
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
    if (hotelCandidates.some((item) => item.hotel.id === hotel.id)) {
      setSelectedId(hotel.id);
      setHotelLimit((current) => Math.max(current, hotelCandidates.findIndex((item) => item.hotel.id === hotel.id) + 1));
      return;
    }
    const item = selected?.hotel.id === hotel.id ? selected : selectable.find((item) => item.hotel.id === hotel.id);
    if (!item) return;
    setSelectedId(item.id);
    if (rooms.some((room) => room.id === item.id))
      setLimit((current) => listLimitForSelection(rooms, current, item.id));
    else {
      setAlternativesOpen(true);
      setAlternativeLimit((current) => listLimitForSelection(alternatives, current, item.id));
    }
  }
  const provisionalCount = alternatives.filter((item) => item.room.provisional).length;
  const filterCount = effectivePreferences.length + countHotelFilters(trip.hotelFilters);
  return (
    <div className="search-page search-page-conversation">
      <div className={`search-layout${sidePanelOpen ? " is-side-panel-open" : ""}`}>
        <div className="search-primary">
      <SearchBar trip={trip} onSearch={submit} busy={loading} />
      <div className="search-toolbar">
        <form className="search-catalog-query" role="search" aria-label="Поиск в каталоге"
          onSubmit={(event) => { event.preventDefault(); submit({ ...trip, hotelFilters: { ...trip.hotelFilters, query: query.trim() || undefined } }); }}>
          <label className="sr-only" htmlFor="catalog-query">Название или слова в источниках</label>
          <input id="catalog-query" type="search" maxLength={240} value={query}
            onChange={(event) => setQuery(event.target.value)} placeholder="Отель, категория или слово в источниках" />
          <button type="submit" aria-label="Искать в каталоге" disabled={loading}><Search size={20} aria-hidden="true" /></button>
        </form>
        <button
          type="button"
          className="search-chip"
          onClick={() => setFilters(true)}
        >
          <SlidersHorizontal size={21} aria-hidden="true" />
          Фильтры
          {!!filterCount && (
            <span className="search-filter-count">
              {filterCount}
            </span>
          )}
        </button>
      </div>
      {trip.hotelFilters?.query && <p className="search-query-note">Ищем слова в названиях и источниках. Упоминание удобства ещё не подтверждает его наличие в номере.</p>}
      <button className="search-mode-summary" type="button" onClick={() => setFilters(true)}>
        {uiAdmissionMode(trip.admissionMode) === "verified" ? "Только подтверждённые условия" : "Включая варианты для уточнения"}
      </button>
      <button className="button secondary search-mobile-assistant" type="button"
        aria-expanded={sidePanelOpen} aria-controls="search-side-panel"
        onClick={() => setSidePanelOpen((open) => !open)}>
        {sidePanelOpen ? "Скрыть карту и помощника" : "Карта и помощник"}
      </button>
      {hasHotelFilters(trip.hotelFilters) && <div className="search-active-preferences" aria-label="Активные фильтры каталога">
        {([
          ["query", trip.hotelFilters?.query ? `Поиск: ${trip.hotelFilters.query}` : ""],
          ["lodgingTypes", trip.hotelFilters?.lodgingTypes?.map((type) => lodgingLabels[type]).join(", ") || ""],
          ["maxPricePerNight", trip.hotelFilters?.maxPricePerNight ? `До ${trip.hotelFilters.maxPricePerNight.toLocaleString("ru-RU")} ₩ / ночь` : ""],
          ["maxBeachMeters", trip.hotelFilters?.maxBeachMeters ? `До пляжа: до ${trip.hotelFilters.maxBeachMeters} м по сети` : ""],
        ] as const).filter(([, label]) => label).map(([key, label]) => <button key={key} type="button"
          onClick={() => setTrip({ ...trip, hotelFilters: { ...trip.hotelFilters, [key]: undefined } })}
          aria-label={`Убрать фильтр: ${label}`}><span>{label}</span><X size={15} aria-hidden="true" /></button>)}
        {trip.hotelFilters?.nearby?.map((condition) => <button key={condition.kind} type="button"
          onClick={() => setTrip({ ...trip, hotelFilters: { ...trip.hotelFilters, nearby: trip.hotelFilters?.nearby?.filter((item) => item.kind !== condition.kind) } })}
          aria-label={`Убрать условие рядом: ${nearbyConditionLabel(condition)}`}><span>{nearbyConditionLabel(condition)}</span><X size={15} aria-hidden="true" /></button>)}
      </div>}
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
          map={<SearchMapPanel catalog={catalog} selected={selectedHotel} selectedRoom={selected?.room} plotted={plotted} onSelect={selectHotel} />}
        />
        <section className="search-list-section" aria-label="Список отелей и номеров">
          <div className="search-results-heading">
            <div>
              <h1>
                Отели и номера в Пусане
              </h1>
              <p role="status" aria-live="polite">
                {loading
                  ? "Подбираем номера…"
                  : validTrip
                    ? `Категории под ваши условия: ${rooms.length} · Отели без собранных категорий: ${hotelCandidates.length}`
                    : `Категории номеров: ${rooms.length} · Другие отели: ${hotelCandidates.length}`}
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
                  {validTrip || trip.hotelFilters?.nearby?.length ? "Больше совпадений" : "С фотографиями отеля"}
                </option>
                <option value="distance">Ближе к пляжу</option>
                <option value="name">По названию</option>
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
              {!rooms.length && !hotelCandidates.length && !error && validTrip && (
                <div className="search-empty">
                  <Search size={30} aria-hidden="true" />
                  <h2>Точного совпадения пока нет</h2>
                  <p>
                    Для рекомендации все условия должны совпасть в одной категории номера.
                    {uiAdmissionMode(trip.admissionMode) === "verified"
                      ? " Можно посмотреть варианты для уточнения, сохранив ваши пожелания."
                      : " Пожелания сохранены. Варианты с неполными данными и несовпавшими необязательными условиями показаны отдельно."}
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
              {!rooms.length && !hotelCandidates.length && !error && !validTrip && hasHotelFilters(trip.hotelFilters) && <div className="search-empty">
                <h2>В каталоге нет совпадений</h2>
                <p>Измените слова или снимите ограничение. Если цена или маршрут неизвестны, такой вариант не проходит соответствующий фильтр.</p>
                <button className="button secondary" type="button" onClick={() => setTrip({ ...trip, hotelFilters: undefined })}>Сбросить фильтры каталога</button>
              </div>}
              <div className="search-hotel-list">
                {visible.map((item) => (
                  <HotelCard
                    key={item.id}
                    hotel={item.hotel}
                    hotelFilters={trip.hotelFilters}
                    previewRoom={item.room}
                    roomRecommendation={item.recommendation}
                    selected={item.id === selected?.id}
                    onSelect={() => setSelectedId(item.id)}
                    onShowMap={() => {
                      setSelectedId(item.id);
                      setMapView(true);
                      setSidePanelOpen(true);
                      requestAnimationFrame(() => document.getElementById("search-side-panel")?.scrollIntoView({ block: "nearest" }));
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
                <details className="search-room-alternatives" open={alternativesOpen} onToggle={(event) => setAlternativesOpen(event.currentTarget.open)}>
                  <summary>Номера с несовпадениями или неполными данными ({alternatives.length})</summary>
                  <p>По этим категориям совпадение со всеми критериями не подтверждено. Ниже видно, что не совпало или требует уточнения.</p>
                  <div className="search-hotel-list">
                    {alternatives.slice(0, alternativeLimit).map((item) => <HotelCard
                      key={item.id} roomRecommendation={item} alternative hotelFilters={trip.hotelFilters}
                      selected={item.id === selected?.id}
                      onSelect={() => setSelectedId(item.id)}
                      onShowMap={() => {
                        setSelectedId(item.id);
                        setMapView(true);
                        setSidePanelOpen(true);
                        requestAnimationFrame(() => document.getElementById("search-side-panel")?.scrollIntoView({ block: "nearest" }));
                      }}
                    />)}
                  </div>
                  {alternatives.length > alternativeLimit && <button type="button" className="button secondary search-load-more" onClick={() => setAlternativeLimit((value) => value + 4)}>Показать ещё {Math.min(4, alternatives.length - alternativeLimit)} категорий</button>}
                </details>
              )}
              {!!hotelCandidates.length && <section className="mapped-hotel-section" aria-label="Отели без собранных категорий">
                <h2>Ещё отели из каталога · {hotelCandidates.length}</h2>
                <p>Эти объекты подходят под фильтры каталога и расположения. Условия конкретной комнаты, вместимость и наличие на даты нужно уточнить.</p>
                <div className="search-hotel-list">{hotelCandidates.slice(0, hotelLimit).map((candidate) => <MappedHotelCard key={candidate.hotel.id} candidate={candidate}
                  selected={candidate.hotel.id === selectedHotel?.id} onSelect={() => setSelectedId(candidate.hotel.id)}
                  onShowMap={() => { setSelectedId(candidate.hotel.id); setMapView(true); setSidePanelOpen(true); requestAnimationFrame(() => document.getElementById("search-side-panel")?.scrollIntoView({ block: "nearest" })); }} />)}</div>
                {hotelCandidates.length > hotelLimit && <button className="button secondary search-load-more" type="button" onClick={() => setHotelLimit((value) => value + 16)}>Показать ещё {Math.min(16, hotelCandidates.length - hotelLimit)} отелей</button>}
              </section>}
              <p className="search-data-note">
                Подбираем категории номеров. Конкретную комнату и наличие на даты уточняйте у отельера.
                {!!data?.unverifiedHotelCount && ` У ${data.unverifiedHotelCount} объектов нет подтверждённых категорий для рекомендации.`}
                {" Источники и ограничения — в подробностях."}
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
