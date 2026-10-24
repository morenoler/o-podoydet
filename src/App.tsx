import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Compass,
  ExternalLink,
  Footprints,
  Heart,
  Info,
  MapPin,
  MessageCircle,
  Moon,
  Route as RouteIcon,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
  Waves,
  X,
  GitCompareArrows,
  AlertTriangle,
  Building2,
} from "lucide-react";
import { api } from "./api";
import { GeoMap } from "./GeoMap";
import { AreaPanel } from "./AreaPanel";
import { features, featureIds, scenarios } from "../shared/features";
import type {
  Criterion,
  Dataset,
  Draft,
  Fact,
  FeatureId,
  Hotel,
  HotelMatch,
  Preference,
  Question,
  SearchResult,
  Trip,
} from "../shared/types";

type Catalog = Dataset & { mode: "rules" | "llm" };
const lodgingLabels = {
  hotel: "Отель",
  motel: "Мотель",
  guest_house: "Гостевой дом",
  hostel: "Хостел",
  apartment: "Апартаменты",
};
const lodgingLabel = (hotel: Hotel) =>
  lodgingLabels[hotel.lodgingType || "hotel"];
const initialTrip: Trip = {
  region: "Пусан",
  checkIn: "",
  checkOut: "",
  adults: 2,
  children: 0,
  scenarios: [],
  preferences: [],
  text: "",
};
function readTrip() {
  try {
    const saved = JSON.parse(localStorage.getItem("o-trip-busan") || "null");
    return saved &&
      typeof saved === "object" &&
      Array.isArray(saved.preferences) &&
      Array.isArray(saved.scenarios)
      ? { ...initialTrip, ...saved }
      : initialTrip;
  } catch {
    return initialTrip;
  }
}
const Context = createContext<{
  trip: Trip;
  setTrip: (t: Trip) => void;
  catalog: Catalog | null;
  revision: number;
  refresh: () => void;
  effectivePreferences: Preference[];
  rememberSearch: (trip: Trip, preferences: Preference[]) => void;
}>({
  trip: initialTrip,
  setTrip: () => {},
  catalog: null,
  revision: 0,
  refresh: () => {},
  effectivePreferences: [],
  rememberSearch: () => {},
});
const useApp = () => useContext(Context);
const dateLabel = (d: string) =>
  d
    ? new Date(d + "T12:00:00").toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
      })
    : "Даты не выбраны";
const dateFull = (d: string) =>
  new Date(d).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function App() {
  const [trip, setTripState] = useState<Trip>(readTrip),
    [catalog, setCatalog] = useState<Catalog | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [resolved, setResolved] = useState<{
    key: string;
    preferences: Preference[];
  } | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem("o-resolved-busan") || "null");
    } catch {
      return null;
    }
  });
  const effectivePreferences =
    resolved?.key === JSON.stringify(trip)
      ? resolved.preferences
      : trip.preferences;
  const rememberSearch = (requestTrip: Trip, preferences: Preference[]) => {
    const value = { key: JSON.stringify(requestTrip), preferences };
    setResolved(value);
    try {
      sessionStorage.setItem("o-resolved-busan", JSON.stringify(value));
    } catch {
      /* optional cache */
    }
  };
  const { pathname } = useLocation();
  const setTrip = (value: Trip) => {
    setTripState(value);
    try {
      localStorage.setItem("o-trip-busan", JSON.stringify(value));
    } catch {
      /* storage can be unavailable in private mode */
    }
  };
  useEffect(() => {
    let active = true;
    api<Catalog>("/catalog")
      .then((c) => {
        if (active) setCatalog(c);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <Context.Provider
      value={{
        trip,
        setTrip,
        catalog,
        revision,
        refresh: () => setRevision((r) => r + 1),
        effectivePreferences,
        rememberSearch,
      }}
    >
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <Header />
      <main id="main" tabIndex={-1}>
        {error ? (
          <div className="page">
            <ErrorMessage text={error} />
            <button className="button" onClick={() => window.location.reload()}>
              Повторить загрузку
            </button>
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<TripPage />} />
            <Route
              path="/wishes"
              element={
                <RequireTrip>
                  <WishesPage />
                </RequireTrip>
              }
            />
            <Route
              path="/results"
              element={
                <RequireTrip>
                  <ResultsPage />
                </RequireTrip>
              }
            />
            <Route
              path="/hotels/:id"
              element={
                <RequireTrip>
                  <HotelPage />
                </RequireTrip>
              }
            />
            <Route path="/host" element={<HostPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
      <footer className="footer">
        <Link to="/" className="brand small">
          <span className="brand-mark">О!</span>Подойдёт
        </Link>
        <span>Меньше сомнений. Больше отдыха.</span>
        <span>
          Прототип ·{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            © OpenStreetMap contributors
          </a>{" "}
          · проверяемые источники
        </span>
      </footer>
    </Context.Provider>
  );
}
function RequireTrip({ children }: { children: ReactNode }) {
  const { trip } = useApp();
  return trip.checkIn && trip.checkOut ? children : <Navigate to="/" replace />;
}
function Header() {
  const location = useLocation();
  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="brand" aria-label="О!Подойдёт — начать подбор">
          <span className="brand-mark">О!</span>Подойдёт
          <span className="brand-dot" />
        </Link>
        <nav aria-label="Главная навигация">
          <Link
            to="/"
            className={
              location.pathname !== "/host" ? "nav-link active" : "nav-link"
            }
          >
            <Compass size={18} />
            Найти свой отдых
          </Link>
          <Link
            to="/host"
            className={
              location.pathname === "/host" ? "nav-link active" : "nav-link"
            }
          >
            <Building2 size={18} />
            Отельерам
          </Link>
        </nav>
        <span className="prototype">MVP</span>
      </div>
    </header>
  );
}
function Steps({ current }: { current: number }) {
  return (
    <ol className="steps" aria-label="Шаги подбора">
      {["Куда и когда", "Что вам важно", "Ваши отели"].map((label, i) => (
        <li
          key={label}
          className={i === current ? "current" : i < current ? "complete" : ""}
          aria-current={i === current ? "step" : undefined}
        >
          <span>{i < current ? <Check size={14} /> : i + 1}</span>
          {label}
          {i < 2 && <ChevronRight size={15} className="step-arrow" />}
        </li>
      ))}
    </ol>
  );
}
function ErrorMessage({ text }: { text: string }) {
  return (
    <div className="notice error" role="alert">
      <AlertTriangle size={18} />
      <span>{text}</span>
    </div>
  );
}
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice">
      <Info size={18} />
      <span>{children}</span>
    </div>
  );
}
function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      Проверяем подходящие варианты…
    </div>
  );
}
function TripSummary() {
  const { trip } = useApp();
  return (
    <div className="trip-summary">
      <MapPin size={17} />
      <strong>{trip.region}</strong>
      <span className="summary-divider" />
      <span>
        {dateLabel(trip.checkIn)} — {dateLabel(trip.checkOut)}
      </span>
      <span className="summary-divider" />
      <span>{trip.adults + trip.children} гостей</span>
      <Link to="/">Изменить</Link>
    </div>
  );
}

function TripPage() {
  const { trip, setTrip, catalog } = useApp();
  const [form, setForm] = useState(trip),
    [error, setError] = useState("");
  const navigate = useNavigate();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.checkIn || !form.checkOut || form.checkOut <= form.checkIn) {
      setError("Выберите даты: выезд должен быть позже заезда.");
      return;
    }
    if (form.checkIn < today()) {
      setError("Выберите дату заезда не раньше сегодняшнего дня.");
      return;
    }
    setTrip(form);
    navigate("/wishes");
  }
  return (
    <div className="page trip-page">
      <Steps current={0} />
      <div className="trip-layout">
        <section className="trip-intro">
          <div className="intro-note">
            <span className="tiny-sun" />
            Отдых начинается с вас
          </div>
          <h1>
            Тот самый отель.
            <br />
            Для вашей поездки.
          </h1>
          <p className="lead">
            Сначала выберем место и даты.
            <br />А потом найдём то, что важно именно вам.
          </p>
          <form className="trip-form" onSubmit={submit}>
            <label className="field region-field">
              <span>Куда едем?</span>
              <div className="input-icon">
                <MapPin size={20} />
                <select
                  aria-label="Регион отдыха"
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                >
                  <option value="Пусан">Пусан, Южная Корея</option>
                </select>
                <ChevronDown size={17} />
              </div>
              <small>В этой версии исследуем район пляжа Хэундэ</small>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Заезд</span>
                <input
                  type="date"
                  aria-label="Дата заезда"
                  required
                  min={today()}
                  value={form.checkIn}
                  onChange={(e) =>
                    setForm({ ...form, checkIn: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Выезд</span>
                <input
                  type="date"
                  aria-label="Дата выезда"
                  required
                  min={form.checkIn || today()}
                  value={form.checkOut}
                  onChange={(e) =>
                    setForm({ ...form, checkOut: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Взрослые</span>
                <select
                  aria-label="Количество взрослых"
                  value={form.adults}
                  onChange={(e) =>
                    setForm({ ...form, adults: Number(e.target.value) })
                  }
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}{" "}
                      {n === 1 ? "взрослый" : n < 5 ? "взрослых" : "взрослых"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Дети</span>
                <select
                  aria-label="Количество детей"
                  value={form.children}
                  onChange={(e) =>
                    setForm({ ...form, children: Number(e.target.value) })
                  }
                >
                  {[0, 1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n === 0
                        ? "Без детей"
                        : `${n} ${n === 1 ? "ребёнок" : "детей"}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {error && <ErrorMessage text={error} />}
            <button className="button primary wide" type="submit">
              Продолжить <ArrowRight size={19} />
            </button>
            <p className="form-footnote">
              Дальше — несколько пожеланий. Можно выбрать кнопками.
            </p>
          </form>
        </section>
        <aside className="destination">
          <div className="destination-map">
            {catalog ? (
              <GeoMap dataset={catalog} />
            ) : (
              <div className="map-loading">Готовим карту побережья…</div>
            )}
          </div>
          <div className="destination-title">
            <div>
              <span>Место для вашей истории</span>
              <h2>Пусан</h2>
              <p>Море, прогулки и свой ритм.</p>
            </div>
            <span className="destination-symbol">
              <Waves size={34} />
            </span>
          </div>
          <div className="destination-proof">
            <ShieldCheck size={22} />
            <p>
              <strong>Смотрим чуть глубже</strong>
              <br />
              На дорогу к пляжу, сторону окон и ступени у входа.
            </p>
          </div>
        </aside>
      </div>
      <div className="how-row">
        <div>
          <RouteIcon />
          <span>
            <strong>Проверяем маршрут</strong>Считаем путь по улицам
          </span>
        </div>
        <div>
          <MessageCircle />
          <span>
            <strong>Уточняем детали</strong>Задаём вопрос отельеру
          </span>
        </div>
        <div>
          <ShieldCheck />
          <span>
            <strong>Объясняем выбор</strong>Показываем источники и оговорки
          </span>
        </div>
      </div>
    </div>
  );
}

function PreferencePicker({
  preferences,
  onChange,
  ids = featureIds,
}: {
  preferences: Preference[];
  onChange: (p: Preference[]) => void;
  ids?: FeatureId[];
}) {
  return (
    <div className="preference-list">
      {ids.map((id) => {
        const selected = preferences.find((p) => p.feature === id);
        return (
          <div className={`preference ${selected ? "selected" : ""}`} key={id}>
            <button
              type="button"
              aria-pressed={!!selected}
              className="preference-button"
              onClick={() =>
                onChange(
                  selected
                    ? preferences.filter((p) => p.feature !== id)
                    : [...preferences, { feature: id, required: false }],
                )
              }
            >
              <span className="check-box">
                {selected && <Check size={14} />}
              </span>
              <span>
                <strong>{features[id].label}</strong>
                <small>{features[id].detail}</small>
              </span>
            </button>
            {selected && (
              <label className="required-toggle">
                <input
                  type="checkbox"
                  checked={selected.required}
                  onChange={(e) =>
                    onChange(
                      preferences.map((p) =>
                        p.feature === id
                          ? { ...p, required: e.target.checked }
                          : p,
                      ),
                    )
                  }
                />
                Обязательно
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
function WishesPage() {
  const { trip, setTrip } = useApp();
  const navigate = useNavigate();
  const suggested = [
    ...new Set([
      ...trip.scenarios.flatMap(
        (id) => scenarios.find((s) => s.id === id)?.features || [],
      ),
    ]),
  ];
  return (
    <div className="page">
      <Steps current={1} />
      <TripSummary />
      <div className="section-intro">
        <h1>Как хочется отдохнуть?</h1>
        <p className="lead">
          Выберите близкие вам варианты. Можно несколько — или сразу к отелям.
        </p>
      </div>
      <div className="wishes-layout">
        <section>
          <div className="scenario-grid">
            {scenarios.map((s, i) => {
              const Icon = [Waves, UsersRound, Moon][i];
              const selected = trip.scenarios.includes(s.id);
              return (
                <button
                  type="button"
                  className={`scenario ${selected ? "selected" : ""}`}
                  key={s.id}
                  aria-pressed={selected}
                  onClick={() =>
                    setTrip({
                      ...trip,
                      scenarios: selected
                        ? trip.scenarios.filter((x) => x !== s.id)
                        : [...trip.scenarios, s.id],
                    })
                  }
                >
                  <span className="scenario-icon">
                    <Icon size={27} />
                  </span>
                  <span className="scenario-text">
                    <strong>{s.title}</strong>
                    <small>{s.description}</small>
                  </span>
                  <span className="round-check">
                    {selected && <Check size={14} />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="subsection">
            <h2>Что особенно важно?</h2>
            <p>Сценарий предлагает пожелания. Вы решаете, какие учитывать.</p>
            <PreferencePicker
              preferences={trip.preferences}
              ids={[...new Set([...suggested, ...featureIds])]}
              onChange={(preferences) => setTrip({ ...trip, preferences })}
            />
          </div>
          <label className="field text-field">
            <span>
              Есть особое пожелание? <small>Необязательно</small>
            </span>
            <textarea
              rows={3}
              maxLength={1500}
              value={trip.text}
              onChange={(e) => setTrip({ ...trip, text: e.target.value })}
              placeholder="Например: ребёнок спит днём, нужен номер во двор"
            />
            <small>
              Тишина внутри номера не определяется одной стороной окон. Мы
              покажем ограничения проверки.
            </small>
          </label>
          <div className="actions">
            <Link to="/" className="button secondary">
              <ArrowLeft size={17} />
              Назад
            </Link>
            <button
              type="button"
              className="button primary"
              onClick={() => navigate("/results")}
            >
              Показать отели <Search size={18} />
            </button>
          </div>
        </section>
        <aside className="side-note">
          <span className="note-icon">
            <Heart size={25} />
          </span>
          <h3>У каждого свой идеальный отдых</h3>
          <p>
            Кому-то нужен короткий путь к морю. Кому-то — номер во двор и
            дневной сон ребёнка.
          </p>
          <hr />
          <p>
            Мы проверим, совпадают ли ваши пожелания в одном номере, и расскажем
            о компромиссах.
          </p>
          <div className="small-note">
            <CheckCircle2 size={18} />
            Можно ничего не писать
          </div>
        </aside>
      </div>
    </div>
  );
}

function CriterionLine({
  criterion,
  detailed = false,
}: {
  criterion: Criterion;
  detailed?: boolean;
}) {
  const Icon =
    criterion.status === "match"
      ? CheckCircle2
      : criterion.status === "mismatch"
        ? X
        : criterion.status === "conflict"
          ? AlertTriangle
          : CircleHelp;
  return (
    <div className={`criterion ${criterion.status}`}>
      <Icon size={17} />
      <div className="criterion-body">
        <strong>
          {features[criterion.feature].label}
          {criterion.required && (
            <span className="required-label">Обязательно</span>
          )}
        </strong>
        <small>{criterion.explanation}</small>
        {criterion.assessmentBasis === "historical" && (
          <small>Историческая оценка · не прогноз на даты поездки</small>
        )}
        {detailed &&
          ((criterion.details?.length || 0) > 0 ||
            (criterion.environmentalEvidence?.length || 0) > 0) && (
            <details className="criterion-evidence">
              <summary>Расчёт и источники</summary>
              {criterion.details?.map((detail, i) => (
                <p key={i}>{detail}</p>
              ))}
              {criterion.environmentalEvidence?.map((e, i) => (
                <p key={i}>
                  <a href={e.sourceUrl} target="_blank" rel="noreferrer">
                    {e.details} <ExternalLink size={12} />
                  </a>
                  {e.observedAt && (
                    <small>Данные: {dateFull(e.observedAt)}</small>
                  )}
                </p>
              ))}
            </details>
          )}
      </div>
    </div>
  );
}
function MatchBadge({ match }: { match: HotelMatch }) {
  const unknown = match.best.criteria.some(
    (c) => !["match", "mismatch"].includes(c.status),
  );
  return (
    <span
      className={`match-badge ${match.best.status === "excluded" ? "excluded" : match.best.status === "clarify" || unknown ? "clarify" : ""}`}
    >
      {match.best.status === "excluded"
        ? "Не подходит по условиям"
        : match.best.status === "clarify"
          ? "Нужно уточнить"
          : unknown || match.best.criteria.some((c) => c.status === "mismatch")
            ? "Есть оговорки"
            : match.best.criteria.length
              ? "Совпадает по данным источников"
              : "Рядом с вашим отдыхом"}
    </span>
  );
}
function WishMatches({ criteria }: { criteria: Criterion[] }) {
  if (!criteria.length)
    return (
      <div className="wish-empty">
        <strong>Пожелания пока не выбраны</strong>
        <p>Выберите, что важно вам, и здесь появятся совпадения.</p>
        <Link to="/wishes">
          Выбрать пожелания <ArrowRight size={14} />
        </Link>
      </div>
    );
  const matched = criteria.filter((c) => c.status === "match");
  const groups = [
    {
      key: "match",
      title: "Совпадает с вашими пожеланиями",
      Icon: CheckCircle2,
      items: matched,
    },
    {
      key: "mismatch",
      title: "Не совпадает",
      Icon: X,
      items: criteria.filter((c) => c.status === "mismatch"),
    },
    {
      key: "pending",
      title: "Нужно уточнить",
      Icon: CircleHelp,
      items: criteria.filter((c) => !["match", "mismatch"].includes(c.status)),
    },
  ];
  return (
    <section
      className="wish-matches"
      aria-label="Совпадения с вашими пожеланиями"
    >
      <div className="wish-summary">
        <strong>Ваши пожелания</strong>
        <span>
          Совпало {matched.length} из {criteria.length}
        </span>
      </div>
      {groups
        .filter((group) => group.key === "match" || group.items.length)
        .map(({ key, title, Icon, items }) => (
          <div className={`wish-group wish-${key}`} key={key}>
            <p className="wish-group-title">
              <Icon size={18} aria-hidden="true" />
              <strong>{title}</strong>
              <span>{items.length}</span>
            </p>
            {items.length ? (
              <ul>
                {[...items]
                  .sort((a, b) => Number(b.required) - Number(a.required))
                  .map((criterion) => (
                    <li key={criterion.feature}>
                      <CriterionLine criterion={criterion} />
                      {criterion.facts.some((fact) => fact.demo) && (
                        <span className="wish-demo">
                          Условие номера · демоданные
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="wish-no-match">
                Пока нет подтверждённых совпадений по выбранным пожеланиям.
              </p>
            )}
          </div>
        ))}
    </section>
  );
}
function HotelCard({
  match,
  compared,
  onCompare,
  compareDisabled = false,
}: {
  match: HotelMatch;
  compared: boolean;
  onCompare: () => void;
  compareDisabled?: boolean;
}) {
  const { catalog } = useApp();
  const { hotel, best } = match;
  return (
    <article className="hotel-card">
      <Link
        to={`/hotels/${hotel.id}?room=${best.room.id}`}
        className="hotel-map-link"
        aria-label={`Подробнее об отеле ${hotel.name}`}
      >
        {catalog && <GeoMap dataset={catalog} hotel={hotel} compact />}
        <span className="distance-pill">
          <Footprints size={15} />
          {hotel.route
            ? `${hotel.route.meters} м до пляжа`
            : "Маршрут не найден"}
        </span>
      </Link>
      <div className="hotel-card-body">
        <div className="card-top">
          <MatchBadge match={match} />
          <button
            type="button"
            className={`compare-button ${compared ? "selected" : ""}`}
            aria-pressed={compared}
            aria-label={`${compared ? "Убрать из сравнения" : "Сравнить"} ${hotel.name}`}
            onClick={onCompare}
            disabled={compareDisabled}
            title={
              compareDisabled
                ? "Можно сравнить не больше трёх отелей"
                : undefined
            }
          >
            <GitCompareArrows size={18} />
          </button>
        </div>
        <Link
          to={`/hotels/${hotel.id}?room=${best.room.id}`}
          className="hotel-title"
        >
          <h2>{hotel.name}</h2>
        </Link>
        <p className="address">
          <MapPin size={14} />
          {lodgingLabel(hotel)} · {hotel.address}
        </p>
        <div className="room-label">
          <Building2 size={15} />
          {best.room.name}
          <span>
            {best.room.evidenceStatus === "verified"
              ? "Официальный источник"
              : "Нет данных о категории"}
          </span>
        </div>
        {best.capacityStatus === "unknown" && (
          <p className="muted">
            Вместимость не подтверждена — нужно уточнить размещение всех гостей.
          </p>
        )}
        <div className="card-criteria">
          <WishMatches criteria={best.criteria} />
        </div>
        <div className="card-bottom">
          <span>Цена и наличие не проверены</span>
          <Link
            to={`/hotels/${hotel.id}?room=${best.room.id}`}
            className="text-link"
          >
            Подробнее <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </article>
  );
}

function ResultsPage() {
  const { trip, setTrip, revision, rememberSearch } = useApp();
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
      <TripSummary />
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
        источников. Неподтверждённые параметры остаются неизвестными. Наличие
        номеров на ваши даты не проверено.
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
                        ? "Недостаточная вместимость проверенных категорий"
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
          matches={[...data.results, ...data.excluded].filter((m) =>
            compare.includes(m.hotel.id),
          )}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  );
}
function CompareDialog({
  matches,
  onClose,
}: {
  matches: HotelMatch[];
  onClose: () => void;
}) {
  const { trip } = useApp();
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
            <h3>{m.hotel.name}</h3>
            <p>{lodgingLabel(m.hotel)}</p>
            <p>{m.best.room.name}</p>
            <p>{m.best.capacityExplanation}</p>
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
        Совпадения основаны на сохранённых источниках. Цена и наличие на
        выбранные даты не проверены.
      </Notice>
    </dialog>
  );
}

function FactEvidence({ fact }: { fact: Fact }) {
  return (
    <article className={`evidence ${fact.supersededBy ? "superseded" : ""}`}>
      <div className="evidence-title">
        <strong>
          {features[fact.feature].label}:{" "}
          {typeof fact.value === "boolean"
            ? fact.value
              ? "да"
              : "нет"
            : typeof fact.value === "number"
              ? `${fact.value} м`
              : (fact.value ?? "не подтверждено")}
        </strong>
        <span className={`tag ${fact.demo ? "demo" : ""}`}>
          {fact.demo
            ? "Демонстрация · не влияет на подбор"
            : fact.method === "official"
              ? "Официальный источник"
              : "Расчёт по OSM"}
        </span>
      </div>
      <blockquote>{fact.quote}</blockquote>
      <p className="evidence-source">
        {fact.sourceUrl ? (
          <a href={fact.sourceUrl} target="_blank" rel="noreferrer">
            {fact.source} <ExternalLink size={12} />
          </a>
        ) : (
          fact.source
        )}
      </p>
      <p className="muted">
        Получено {dateFull(fact.obtainedAt)} · перепроверить до{" "}
        {dateFull(fact.expiresAt)}
        {fact.sourceDate
          ? ` · исходные данные ${dateFull(fact.sourceDate)}`
          : ""}
      </p>
      <p className="muted">
        Уверенность:{" "}
        {fact.confidence === "high"
          ? "высокая"
          : fact.confidence === "medium"
            ? "средняя"
            : "низкая"}
        . {fact.confidenceReason}
      </p>
      {fact.supersededBy && (
        <p className="muted">
          Заменено новым подтверждённым ответом. Сохранено в истории.
        </p>
      )}
    </article>
  );
}
function HotelPage() {
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
  const room = ranked.rooms.find((r) => r.room.id === roomId) || ranked.best;
  return (
    <div className="page">
      <Link to="/results" className="back-link">
        <ArrowLeft size={16} />К подбору
      </Link>
      <TripSummary />
      <div className="detail-heading">
        <div>
          <h1>{hotel.name}</h1>
          <p className="address">
            <MapPin size={16} />
            {lodgingLabel(hotel)} · {hotel.address}
          </p>
        </div>
        <a
          href={hotel.osmUrl}
          className="button secondary"
          target="_blank"
          rel="noreferrer"
        >
          Объект на OSM <ExternalLink size={16} />
        </a>
      </div>
      <Notice>
        Подбор использует проверяемые источники. Если категория или условие не
        подтверждены, показываем это явно. Цена и наличие на даты поездки не
        проверены.
      </Notice>
      <div className="detail-grid">
        <section>
          <GeoMap dataset={catalog} hotel={hotel} />
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
          ) : (
            <Notice>
              Пешеходный маршрут до пляжа пока не рассчитан. На карте показано
              расположение объекта; расстояние и доступность пути остаются
              неизвестными.
            </Notice>
          )}
          {hotel.route?.noStepsAlternative && (
            <Notice>
              Найден альтернативный путь без отмеченных лестниц:{" "}
              {hotel.route.noStepsAlternative.meters} м. Отображён пунктиром;
              доступность не обследована.
            </Notice>
          )}
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
              {hotel.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ·{" "}
                  {r.capacity === null
                    ? "вместимость не подтверждена"
                    : `до ${r.capacity} гостей`}
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
          {room.room.capacity === null && (
            <Notice>
              Вместимость категории не подтверждена. Нужно уточнить размещение
              всех гостей.
            </Notice>
          )}
          {room.capacityStatus === "unknown" && room.room.capacity !== null && (
            <Notice>
              {room.capacityExplanation ||
                "Дополнительные гости размещаются только по отдельным условиям отеля. Нужно подтверждение."}
            </Notice>
          )}
          {room.capacityStatus === "mismatch" && (
            <ErrorMessage text="Эта категория не вмещает всех гостей." />
          )}
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
                    ["unknown", "conflict", "stale"].includes(c.status) && (
                      <button
                        className="text-link"
                        type="button"
                        disabled={busy}
                        onClick={() => ask(c.feature)}
                      >
                        {c.status === "conflict"
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
          Эти условия одинаковы для всех номеров отеля. «Обязательно» влияет на
          допуск к подбору; остальные пожелания влияют на порядок вариантов.
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
      <AreaPanel hotelId={hotel.id} />
      <section className="subsection evidence-section">
        <h2>Почему мы так считаем</h2>
        <p>
          Источники и история для выбранной категории. Реальные факты отделены
          от демонстрации.
        </p>
        {facts
          .filter((f) => !f.roomId || f.roomId === roomId)
          .map((f) => (
            <FactEvidence key={f.id} fact={f} />
          ))}
      </section>
    </div>
  );
}

function HostPage() {
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
        Вы играете роль отельера. Ответы сохраняются локально как
        демонстрационные и не подтверждают условия в подборе. Это не сведения,
        полученные от реальных отелей.
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
function QuestionCard({
  question: q,
  onSaved,
}: {
  question: Question;
  onSaved: () => void;
}) {
  const [text, setText] = useState(""),
    [draft, setDraft] = useState<Draft | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [resolveConflict, setResolveConflict] = useState(false);
  async function preview() {
    setBusy(true);
    setError("");
    setDraft(null);
    try {
      setDraft(await api<Draft>(`/questions/${q.id}/preview`, { text }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await api(`/drafts/${draft.id}/confirm`, { resolveConflict });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="question-card">
      <div className="question-top">
        <span className={`tag ${q.status === "open" ? "pending" : ""}`}>
          {q.status === "open" ? "Ждёт ответа" : "Ответ сохранён"}
        </span>
        <small>{dateFull(q.createdAt)}</small>
      </div>
      <h2>{q.text}</h2>
      <details className="question-reason">
        <summary>Почему возник этот вопрос?</summary>
        {q.trace.map((t) => (
          <p key={t.step}>
            <strong>{t.step}:</strong> {t.detail}
          </p>
        ))}
      </details>
      {q.status === "answered" ? (
        <blockquote>{q.answer}</blockquote>
      ) : (
        <>
          <label className="field">
            <span>Ваш ответ для этой категории</span>
            <textarea
              rows={3}
              value={text}
              maxLength={1500}
              onChange={(e) => {
                setText(e.target.value);
                setDraft(null);
              }}
              placeholder={
                q.feature === "step_free_access"
                  ? "Например: перед входом три ступени, пандуса нет."
                  : "Ответьте, к какой стороне или условию относится эта категория."
              }
            />
          </label>
          <button
            className="button secondary"
            onClick={preview}
            disabled={busy || text.trim().length < 3}
          >
            {busy ? "Обрабатываем…" : "Разобрать ответ"}
            <Sparkles size={16} />
          </button>
          {draft && (
            <div className="extraction">
              <h3>Проверьте, правильно ли мы поняли</h3>
              {draft.extractions.map((e, i) => (
                <div key={i}>
                  <strong>
                    {features[e.feature].label}: {e.value ? "да" : "нет"}
                  </strong>
                  <blockquote>{e.quote}</blockquote>
                </div>
              ))}
              {draft.warnings.map((w) => (
                <p className="warning-text" key={w}>
                  {w}
                </p>
              ))}
              {draft.extractions.length > 0 && (
                <>
                  <label className="resolve-check">
                    <input
                      type="checkbox"
                      checked={resolveConflict}
                      onChange={(e) => setResolveConflict(e.target.checked)}
                    />
                    Этот ответ исправляет прежние сведения по этому условию.
                    Сохранить прежние значения в истории.
                  </label>
                  <p className="muted">
                    Без этой отметки противоречащие ответы останутся конфликтом
                    и потребуют уточнения.
                  </p>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={save}
                  >
                    Подтвердить и обновить подбор <Check size={17} />
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
      {error && <ErrorMessage text={error} />}
    </article>
  );
}
