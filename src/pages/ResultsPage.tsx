import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  RotateCcw,
  List,
  Map as MapIcon,
  MessageCircle,
  X,
  ChevronDown,
  ChevronRight,
  Filter,
} from "lucide-react";
import type { FeatureId, Hotel, SearchResult, Trip } from "../../shared/types";
import { useApp } from "../app/providers/TripProvider";
import { useAuth } from "../features/auth/AuthProvider";
import { api } from "../shared/api/client";
import { ErrorMessage, Loading } from "../shared/ui/Feedback";
import { accommodationPhotos } from "../shared/lib/hotelPhotos";
import { HotelCard } from "../features/hotels/components/HotelCard";
import { AdvisorDrawer } from "../features/advisor/AdvisorDrawer";
import { SearchConversation } from "../features/advisor/SearchConversation";
import { editPreferences, resetSearchFilters } from "../features/search/preferences";
import { features } from "../../shared/features";
import { SearchBar } from "../features/search/SearchBar";
import { SearchDiagnostics } from "../features/search/SearchDiagnostics";
import { SearchMapPanel } from "../features/search/SearchMapPanel";
import { PriceFilter, SearchFilters } from "../features/search/SearchFilters";
import { canSearch } from "../features/search/searchTrip";
import { catalogRooms, recommendationItem, roomHotels } from "../features/search/roomResults";
import { countHotelFilters, hasHotelFilters, matchesHotelFilters } from "../../shared/catalogFilters";
import { regionDetails } from "../../shared/regions";
import "../features/search/catalog-filters.css";
import { listLimitForSelection, uiAdmissionMode } from "../features/search/searchPolicy";
import { locationWishLabel } from "../features/places/locationPresentation";
import { resultFeed } from "../features/search/resultFeed";
import "../features/places/places.css";
import "../features/search/search.css";
import "../features/search/search-experience.css";
import "../features/search/figcraft-results.css";
import "../features/hotels/reputation.css";

export function ResultsPage() {
  const { user, loading: authLoading } = useAuth();
  const {
    trip,
    setTrip,
    catalog,
    regions,
    catalogError,
    revision,
    rememberSearch,
    refresh,
    effectivePreferences,
  } = useApp();
  const scope = user?.id || "guest";
  const searchKey = JSON.stringify([trip, revision, scope]);
  const [response, setResponse] = useState<{ key: string; data: SearchResult | null; error: string } | null>(null);
  const data = !authLoading && response?.key === searchKey ? response.data : null;
  const error = !authLoading && response?.key === searchKey ? response.error : "";
  const [filters, setFilters] = useState(false);
  const [priceAnchor, setPriceAnchor] = useState<{ left: number; top: number } | null>(null);
  const [advisor, setAdvisor] = useState(false);
  const [mapView, setMapView] = useState(true);
  const [mobileView, setMobileView] = useState<"list" | "map" | "assistant">("list");
  const [selectedId, setSelectedId] = useState("");
  const [limit, setLimit] = useState(8);
  const [manualLoading, setManualLoading] = useState(false);
  const listRef = useRef<HTMLElement>(null);
  const loadTrigger = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState("recommended");
  const filterScroll = useRef<HTMLDivElement>(null);
  const validTrip = canSearch(trip) && regions.includes(trip.region);
  const loading = validTrip && (authLoading || response?.key !== searchKey);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLimit(8);
    setSelectedId("");
    if (!validTrip || authLoading) return;
    api<SearchResult>("/search", trip, controller.signal)
      .then((result) => {
        if (!active) return;
        setResponse({ key: searchKey, data: result, error: "" });
        rememberSearch(trip, result.preferences);
      })
      .catch((cause) => {
        if (active) {
          setResponse({ key: searchKey, data: null, error: cause.message });
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [trip, revision, validTrip, authLoading, user?.id]);
  const rooms = useMemo(() => {
    const items = data
      ? resultFeed(data, trip.admissionMode).map(recommendationItem)
      : validTrip
        ? []
        : catalogRooms(catalog).filter((item) => matchesHotelFilters(item.hotel, trip.hotelFilters, catalog?.facts, item.room, regionDetails(trip.region)?.currency));
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
  }, [data, catalog, sort, validTrip, trip.hotelFilters, trip.region, trip.admissionMode]);
  const visible = rooms.slice(0, limit);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") { setManualLoading(true); return; }
    const node = loadTrigger.current;
    if (!node || loading || limit >= rooms.length) return;
    const desktop = window.matchMedia("(min-width: 901px)");
    let observer: IntersectionObserver;
    const observe = () => {
      observer?.disconnect();
      if (!desktop.matches && mobileView !== "list") return;
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) setLimit(value => Math.min(rooms.length, value + 8));
      }, { root: desktop.matches ? listRef.current : null, rootMargin: "0px 0px 240px 0px" });
      observer.observe(node);
    };
    observe();
    desktop.addEventListener("change", observe);
    return () => { observer?.disconnect(); desktop.removeEventListener("change", observe); };
  }, [loading, limit, rooms.length, mobileView]);
  const selectable = rooms;
  const selected = selectable.find((item) => item.id === selectedId) || selectable[0];
  const selectedHotel = selected?.hotel;
  const plotted = roomHotels(selectable);
  function submit(nextTrip: Trip) {
    if (JSON.stringify(nextTrip) === JSON.stringify(trip)) refresh();
    else setTrip(nextTrip);
  }
  function showPanel(view: "map" | "assistant") {
    setMobileView(view);
    setMapView(view === "map");
    requestAnimationFrame(() => document.getElementById("search-side-panel")?.scrollIntoView({ block: "nearest" }));
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
    const item = selected?.hotel.id === hotel.id ? selected : selectable.find((item) => item.hotel.id === hotel.id);
    if (!item) return;
    setSelectedId(item.id);
    if (rooms.some((room) => room.id === item.id))
      setLimit((current) => listLimitForSelection(rooms, current, item.id));
  }
  const provisionalCount = rooms.filter((item) => item.recommendation?.room.provisional).length;
  const filterCount = effectivePreferences.length + countHotelFilters(trip.hotelFilters) + (trip.locationWishes?.length || 0);
  return (
    <div className={`search-page search-page-conversation search-experience mobile-view-${mobileView}`}>
      <div className="search-layout">
        <div className="search-primary">
      <SearchBar trip={trip} regions={regions} onSearch={submit} busy={loading} />
      <div className="search-toolbar">
        <button type="button" className={`search-chip search-all-filters${filterCount ? " is-active" : ""}`} onClick={() => setFilters(true)} aria-label={`Фильтры${filterCount ? `: выбрано ${filterCount}` : ""}`}>
          <Filter size={16} aria-hidden="true" />Фильтры
          {!!filterCount && <span className="search-filter-dot" aria-hidden="true" />}
        </button>
        <span className="search-toolbar-divider" aria-hidden="true" />
        <div className="search-filter-scroll" ref={filterScroll}>
          {!!filterCount && <div className="search-chip-with-reset search-selection-summary">
            <button type="button" className="search-chip is-active" onClick={() => setFilters(true)}>{effectivePreferences.length ? effectivePreferences.map((item) => features[item.feature].label).join(", ") : trip.locationWishes?.length ? trip.locationWishes.map(locationWishLabel).join(", ") : `Выбрано условий: ${filterCount}`}</button>
            <button type="button" className="search-chip-reset" aria-label="Сбросить выбранные условия" onClick={() => setTrip(resetSearchFilters(trip))}><X size={14} aria-hidden="true" /></button>
          </div>}
          <div className={`search-chip-with-reset${trip.hotelFilters?.maxPricePerNight ? " is-active" : ""}`}><button type="button" className={`search-chip${trip.hotelFilters?.maxPricePerNight ? " is-active" : ""}`}
            aria-haspopup="dialog" aria-expanded={!!priceAnchor} onClick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); setPriceAnchor({ left: bounds.left, top: bounds.bottom + 16 }); }}>
            Цена <ChevronDown size={16} aria-hidden="true" />
          </button>
          {!!trip.hotelFilters?.maxPricePerNight && <button type="button" className="search-chip-reset" aria-label="Сбросить ограничение цены" onClick={() => setTrip({ ...trip, hotelFilters: { ...trip.hotelFilters, maxPricePerNight: undefined } })}><X size={14} aria-hidden="true" /></button>}</div>
          {([
            { id: "beach_walk", label: "Близко к пляжу" },
            { id: "pool", label: "С бассейном" },
            { id: "washing_machine", label: "Стиральная машина" },
            { id: "dishwasher", label: "Посудомойка" },
            { id: "breakfast", label: "Завтрак" },
            { id: "wifi", label: "Wi-Fi" },
          ] as const).map((item) => <div className={`search-chip-with-reset${effectivePreferences.some((value) => value.feature === item.id) ? " is-active" : ""}`} key={item.id}><button type="button"
            className={`search-chip${effectivePreferences.some((value) => value.feature === item.id) ? " is-active" : ""}`}
            aria-pressed={effectivePreferences.some((value) => value.feature === item.id)} onClick={() => quickFilter(item.id)}>
            {item.label}
          </button>{effectivePreferences.some((value) => value.feature === item.id) && <button type="button" className="search-chip-reset" aria-label={`Сбросить фильтр: ${item.label}`} onClick={() => quickFilter(item.id)}><X size={14} aria-hidden="true" /></button>}</div>)}
          <button type="button" className="search-chip" onClick={() => setFilters(true)}><Search size={16} aria-hidden="true" />Название</button>
          {(filterCount > 0 || trip.text.trim() || trip.preferenceOverrides?.length || trip.scenarios.length || sort !== "recommended" || uiAdmissionMode(trip.admissionMode) !== "explore") &&
            <button type="button" className="search-chip search-reset-filters" onClick={() => { setSort("recommended"); setTrip(resetSearchFilters(trip)); }} aria-label="Сбросить все фильтры"><RotateCcw size={16} aria-hidden="true" />Сбросить</button>}
        </div>
        <button type="button" className="search-filter-next" aria-label="Следующие быстрые фильтры" onClick={() => filterScroll.current?.scrollBy({ left: 250, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
      {trip.pendingLocationQuery && <p className="search-location-pending" role="status"><strong>Нужно уточнить: {trip.pendingLocationQuery.query}.</strong> Ответьте помощнику в чате. Это пожелание ещё не участвует в подборе.</p>}
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
        <nav className="search-mobile-navigation" aria-label="Способ просмотра подборки">
          {([{ id: "list", label: "Варианты", icon: List }, { id: "map", label: "Карта", icon: MapIcon }, { id: "assistant", label: "Помощник", icon: MessageCircle }] as const).map(({ id, label, icon: Icon }) =>
            <button key={id} type="button" aria-pressed={mobileView === id} aria-controls={id === "list" ? "search-room-results" : "search-side-panel"} onClick={() => { setMobileView(id); if (id !== "list") setMapView(id === "map"); }}><Icon size={18} aria-hidden="true" />{label}</button>)}
        </nav>
        <section id="search-room-results" className="search-list-section" aria-label="Список номеров" ref={listRef}>
          <h1 className="sr-only">Отели и номера {regionDetails(trip.region)?.inName || trip.region}</h1>
          <p className="sr-only" role="status" aria-live="polite">{loading ? "Подбираем номера…" : `Категории: ${rooms.length}. Варианты для уточнения: ${provisionalCount}.`}</p>
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
              {!rooms.length && data && !error && validTrip && (
                <div className="search-empty">
                  <Search size={30} aria-hidden="true" />
                  <h2>Точного совпадения пока нет</h2>
                  <p>
                    Для рекомендации все условия должны совпасть в одной категории номера.
                    {uiAdmissionMode(trip.admissionMode) === "verified"
                      ? " Можно посмотреть варианты для уточнения, сохранив ваши пожелания."
                      : " Пожелания сохранены. Попробуйте изменить фильтры."}
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
              {!rooms.length && !error && !validTrip && hasHotelFilters(trip.hotelFilters) && <div className="search-empty">
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
                      showPanel("map");
                    }}
                  />
                ))}
              </div>
              {rooms.length > limit && <div ref={loadTrigger} className="search-feed-trigger" role="status">
                {manualLoading ? <button className="button secondary" type="button" onClick={() => setLimit(value => Math.min(rooms.length, value + 8))}>Загрузить следующие номера</button>
                  : <span className="sr-only">Следующие номера загрузятся при прокрутке</span>}
              </div>}
              <p className="search-data-note">
                Подбираем категории номеров. Конкретную комнату и наличие на даты уточняйте у отельера.
                {catalog?.evidencePolicy === "demo" &&
                  " Варианты «ДЕМО» вымышлены."}
              </p>
              {data && <SearchDiagnostics data={data} />}
            </>
          )}
        </section>
        {authLoading ? <aside className="search-conversation" aria-label="Проверка аккаунта"><Loading /></aside> : <SearchConversation
          key={`${scope}:${trip.region}`}
          scope={scope}
          trip={trip}
          contextHotelId={selectedId ? selectedHotel?.id : undefined}
          onApply={setTrip}
          result={data}
          searching={loading}
          searchError={error}
          onAnalyze={() => setAdvisor(true)}
          mapView={mapView}
          onMapViewChange={(value) => { setMapView(value); setMobileView(value ? "map" : "assistant"); }}
          map={<SearchMapPanel catalog={catalog} selected={selectedId ? selectedHotel : undefined} selectedRoom={selectedId ? selected?.room : undefined} plotted={plotted} focusHotels={roomHotels(rooms).slice(0, 12)} onSelect={selectHotel} />}
        />}
      </div>
      {filters && (
        <SearchFilters
          trip={trip}
          preferences={effectivePreferences}
          sort={sort}
          onSortChange={setSort}
          onApply={submit}
          onClose={() => setFilters(false)}
        />
      )}
      {priceAnchor && <PriceFilter trip={trip} prices={(catalog?.hotels || []).filter((hotel) => hotel.currency === regionDetails(trip.region)?.currency).map((hotel) => hotel.pricePerNight).filter((value): value is number => typeof value === "number" && value > 0)} onApply={submit} onClose={() => setPriceAnchor(null)} anchor={priceAnchor} />}
      <AdvisorDrawer
        open={advisor}
        onClose={() => setAdvisor(false)}
        trip={trip}
        result={data}
        onRefresh={refresh}
      />
    </div>
  );
}
