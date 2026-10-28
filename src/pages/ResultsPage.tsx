import { useEffect, useMemo, useState } from "react";
import {
  Check,
  GitCompareArrows,
  Search,
  SlidersHorizontal,
  RotateCcw,
  List,
  Map,
  MessageCircle,
  X,
} from "lucide-react";
import type { FeatureId, Hotel, SearchResult, Trip } from "../../shared/types";
import { useApp } from "../app/providers/TripProvider";
import { useAuth } from "../features/auth/AuthProvider";
import { api } from "../shared/api/client";
import { ErrorMessage, Loading } from "../shared/ui/Feedback";
import { accommodationPhotos } from "../shared/lib/hotelPhotos";
import { HotelCard } from "../features/hotels/components/HotelCard";
import { CompareDialog } from "../features/hotels/components/CompareDialog";
import { AdvisorDrawer } from "../features/advisor/AdvisorDrawer";
import { SearchConversation } from "../features/advisor/SearchConversation";
import { editPreferences, resetSearchFilters } from "../features/search/preferences";
import { features } from "../../shared/features";
import { SearchBar } from "../features/search/SearchBar";
import { SearchDiagnostics } from "../features/search/SearchDiagnostics";
import { SearchMapPanel } from "../features/search/SearchMapPanel";
import { SearchFilters } from "../features/search/SearchFilters";
import { canSearch } from "../features/search/searchTrip";
import { catalogRooms, recommendationItem, roomHotels } from "../features/search/roomResults";
import { useRoomComparison } from "../features/search/useRoomComparison";
import { groupRoomAlternatives } from "../features/search/resultGroups";
import { AdmissionModePicker } from "../features/search/AdmissionModePicker";
import { listLimitForSelection, uiAdmissionMode } from "../features/search/searchPolicy";
import { locationWishLabel } from "../features/places/locationPresentation";
import "../features/places/places.css";
import "../features/search/search.css";
import "../features/search/search-experience.css";

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
  const scope = user?.id || "guest";
  const searchKey = JSON.stringify([trip, revision, scope]);
  const [response, setResponse] = useState<{ key: string; data: SearchResult | null; error: string } | null>(null);
  const data = !authLoading && response?.key === searchKey ? response.data : null;
  const error = !authLoading && response?.key === searchKey ? response.error : "";
  const [showCompare, setShowCompare] = useState(false);
  const [filters, setFilters] = useState(false);
  const [advisor, setAdvisor] = useState(false);
  const [mapView, setMapView] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "map" | "assistant">("list");
  const [selectedId, setSelectedId] = useState("");
  const [limit, setLimit] = useState(8);
  const [alternativeLimit, setAlternativeLimit] = useState(4);
  const [alternativesOpen, setAlternativesOpen] = useState(false);
  const [sort, setSort] = useState("recommended");
  const validTrip = canSearch(trip);
  const loading = validTrip && (authLoading || response?.key !== searchKey);
  const comparison = useRoomComparison(authLoading ? "auth-pending" : scope, trip, searchKey, data, error);
  const compare = comparison.selections.map((selection) => selection.id);
  useEffect(() => { setShowCompare(false); }, [scope]);
  useEffect(() => {
    let active = true;
    setLimit(8);
    setAlternativeLimit(4);
    if (!validTrip || authLoading) return;
    api<SearchResult>("/search", trip)
      .then((result) => {
        if (!active) return;
        setResponse({ key: searchKey, data: result, error: "" });
        setAlternativesOpen(!result.roomRecommendations.length);
        rememberSearch(trip, result.preferences);
      })
      .catch((cause) => {
        if (active) {
          setResponse({ key: searchKey, data: null, error: cause.message });
        }
      });
    return () => {
      active = false;
    };
  }, [trip, revision, validTrip, authLoading, user?.id]);
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
  const alternativeGroups = groupRoomAlternatives(alternatives);
  const selectable = [...rooms, ...alternatives.map(recommendationItem)];
  const selected =
    selectable.find((item) => item.id === selectedId) || selectable[0];
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
    else {
      setAlternativesOpen(true);
      const group = alternativeGroups.find((group) => group.items.some((value) => value.id === item.id));
      setAlternativeLimit((current) => listLimitForSelection(group?.items || alternatives, current, item.id));
    }
  }
  const provisionalCount = alternatives.filter((item) => item.room.provisional).length;
  const sea = (data?.preferences || trip.preferences).some(
    (value) => value.feature === "beach_walk",
  );
  const ResultsHeading = validTrip ? "h1" : "h2";
  return (
    <div className={`search-page search-page-conversation search-experience mobile-view-${mobileView}${compare.length ? " has-comparison" : ""}`}>
      {!validTrip && <div className="search-introduction">
        <h1>Номер, в котором совпадёт важное для вас</h1>
        <p>Начнём с Пусана, район Хэундэ. Сравните условия одной категории номера и узнайте, что уточнить до поездки.</p>
      </div>}
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
        <button
          type="button"
          className="search-chip search-reset-filters"
          disabled={!effectivePreferences.length && !trip.locationWishes?.length && !trip.pendingLocationQuery && !trip.scenarios.length && !trip.text.trim() && !trip.preferenceOverrides?.length && uiAdmissionMode(trip.admissionMode) === "explore" && sort === "recommended"}
          onClick={() => {
            setSort("recommended");
            setTrip(resetSearchFilters(trip));
          }}
          title="Сбросить условия, пожелания и порядок выдачи. Даты и гости сохранятся."
        >
          <RotateCcw size={19} aria-hidden="true" />
          Сбросить все
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
      <div className="search-inline-admission"><AdmissionModePicker value={trip.admissionMode}
        onChange={(admissionMode) => setTrip({ ...trip, admissionMode })} /></div>
      <button className="search-mobile-admission" type="button" aria-haspopup="dialog" onClick={() => setFilters(true)}>
        <span><small>Режим подбора</small><strong>{uiAdmissionMode(trip.admissionMode) === "verified" ? "Только подтверждённые" : "Без известных препятствий"}</strong></span>
        <SlidersHorizontal size={18} aria-hidden="true" />
      </button>
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
      {!!trip.locationWishes?.length && (
        <div className="search-location-wishes">
          <p>Пожелания о расположении из диалога</p>
          <div className="search-active-preferences" aria-label="Пожелания о расположении">
            {trip.locationWishes.map((wish, index) => (
              <button key={`${wish.query}-${index}`} type="button"
                onClick={() => setTrip({ ...trip, locationWishes: trip.locationWishes?.filter((_, itemIndex) => itemIndex !== index) })}
                aria-label={`Убрать пожелание: ${locationWishLabel(wish)}`}>
                <span>{locationWishLabel(wish)}{wish.required && <strong>Обязательно</strong>}</span>
                <X size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      )}
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
          {([{ id: "list", label: "Варианты", icon: List }, { id: "map", label: "Карта", icon: Map }, { id: "assistant", label: "Помощник", icon: MessageCircle }] as const).map(({ id, label, icon: Icon }) =>
            <button key={id} type="button" aria-pressed={mobileView === id} aria-controls={id === "list" ? "search-room-results" : "search-side-panel"} onClick={() => { setMobileView(id); if (id !== "list") setMapView(id === "map"); }}><Icon size={18} aria-hidden="true" />{label}</button>)}
        </nav>
        <section id="search-room-results" className="search-list-section" aria-label="Список номеров">
          <div className="search-results-heading">
            <div>
              <ResultsHeading>
                {sea && validTrip ? "Номера у моря в Пусане" : "Номера в Пусане"}
              </ResultsHeading>
              <p role="status" aria-live="polite">
                {loading
                  ? "Подбираем номера…"
                  : error ? "Подборку не удалось обновить. Ваши условия сохранены."
                  : validTrip && data
                    ? `Соответствуют всем критериям: ${rooms.length}`
                    : validTrip ? "Подготовим подборку по вашим условиям."
                    : `Категорий номеров в каталоге Хэундэ: ${rooms.length}`}
              </p>
              {validTrip && !loading && provisionalCount > 0 && (
                <p className="search-provisional-count">
                  Нужно уточнить вместимость или обязательные условия: {provisionalCount}.
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
              {!rooms.length && data && !error && validTrip && (
                <div className="search-empty">
                  <Search size={30} aria-hidden="true" />
                  <h2>Номер под все критерии пока не найден</h2>
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
                      showPanel("map");
                    }}
                    compared={compare.includes(item.id)}
                    onCompare={data ? () => comparison.toggle(item) : undefined}
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
                  <summary>Другие варианты для решения ({alternatives.length})</summary>
                  <p>Посмотрите, где не хватает сведений, а где есть известный компромисс.</p>
                  {alternativeGroups.map((group) => <section key={group.id} className="search-alternative-group" aria-labelledby={`alternatives-${group.id}`}>
                  <h3 id={`alternatives-${group.id}`}>{group.title} <span>{group.items.length}</span></h3>
                  <p>{group.description}</p>
                  <div className="search-hotel-list">
                    {group.items.slice(0, alternativeLimit).map((item) => <HotelCard
                      key={item.id} roomRecommendation={item} alternative
                      selected={item.id === selected?.id}
                      onSelect={() => setSelectedId(item.id)}
                      onShowMap={() => {
                        setSelectedId(item.id);
                        showPanel("map");
                      }}
                      compared={compare.includes(item.id)}
                      onCompare={() => comparison.toggle(recommendationItem(item))}
                      compareDisabled={compare.length >= 3 && !compare.includes(item.id)}
                    />)}
                  </div>
                  {group.items.length > alternativeLimit && <button type="button" className="button secondary search-load-more" onClick={() => setAlternativeLimit((value) => value + 4)}>Показать ещё {Math.min(4, group.items.length - alternativeLimit)} категорий</button>}
                  </section>)}
                </details>
              )}
              <p className="search-data-note">
                Подбираем конкретную категорию номера. Физический номер комнаты и наличие на даты уточняйте у отельера.
                {!!data?.unverifiedHotelCount && ` У ${data.unverifiedHotelCount} объектов нет подтверждённых категорий для рекомендации.`}
                Недостающие сведения отмечены отдельно и не считаются подтверждением.
                Источники указаны в подробностях. Наличие на ваши даты не проверено.
                {catalog?.evidencePolicy === "demo" &&
                  " Варианты «ДЕМО» вымышлены."}
              </p>
              {data && <SearchDiagnostics data={data} />}
            </>
          )}
        </section>
        {authLoading ? <aside className="search-conversation" aria-label="Проверка аккаунта"><Loading /></aside> : <SearchConversation
          key={scope}
          scope={scope}
          trip={trip}
          contextHotelId={selected?.hotel.id}
          onApply={setTrip}
          result={data}
          searching={loading}
          searchError={error}
          onAnalyze={() => setAdvisor(true)}
          mapView={mapView}
          onMapViewChange={(value) => { setMapView(value); setMobileView(value ? "map" : "assistant"); }}
          map={<SearchMapPanel catalog={catalog} selected={selected?.hotel} selectedRoom={selected?.room} plotted={plotted} onSelect={selectHotel} />}
        />}
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
        <div className="compare-tray search-compare-tray" aria-label="Выбранные номера для сравнения">
          <span>
            <strong>{compare.length} из 3</strong> номеров для сравнения
            {comparison.entries.some((entry) => !entry.match) && <small>Оценки обновятся по условиям поездки</small>}
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
            onClick={() => { comparison.clear(); setShowCompare(false); }}
          >
            <X size={20} />
          </button>
        </div>
      )}
      {showCompare && compare.length > 0 && (
        <CompareDialog
          trip={trip}
          entries={comparison.entries}
          onRemove={(id) => { comparison.remove(id); if (compare.length < 2) setShowCompare(false); }}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  );
}
