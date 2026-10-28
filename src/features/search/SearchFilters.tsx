import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";
import type { FeatureId, Preference, Trip } from "../../../shared/types";
import { Modal } from "../../shared/ui/Modal";
import { PreferencePicker } from "../preferences/PreferencePicker";
import { applyFilterDraft, editPreferences, hasSearchFilters, resetSearchFilters } from "./preferences";
import { AdmissionModePicker } from "./AdmissionModePicker";
import { CatalogFilterFields } from "./CatalogFilterFields";
import { countHotelFilters } from "../../../shared/catalogFilters";
import { regionDetails } from "../../../shared/regions";

const groups: { title: string; description?: string; ids: FeatureId[] }[] = [
  { title: "В номере", description: "Проверяем удобства именно выбранной категории.", ids: ["kitchen", "dishwasher", "washing_machine", "wifi", "air_conditioning", "balcony"] },
  { title: "В отеле", description: "Наличие и условия доступа зависят от сведений источника.", ids: ["pool", "parking", "breakfast"] },
  { title: "С питомцем", ids: ["pets_allowed"] },
  { title: "Пляж и дорога", ids: ["beach_walk", "step_free_route"] },
  { title: "Номер и размещение", ids: ["family", "step_free_access", "courtyard"] },
  { title: "Окружение", ids: ["area_safety", "clean_air", "low_noise"] },
];
const shortcuts = [
  { feature: "beach_walk", label: "Близость к пляжу", image: "beach" },
  { feature: "step_free_access", label: "Доступность с коляской", image: "stroller" },
  { feature: "breakfast", label: "Завтраки", image: "breakfast" },
] as const;
const popular = [
  { feature: "beach_walk", label: "Близко к морю" }, { feature: "pool", label: "Бассейн" }, { feature: "wifi", label: "Wi-Fi" },
  { feature: "washing_machine", label: "Стиральная машина" }, { feature: "dishwasher", label: "Посудомойка" }, { feature: "kitchen", label: "Кухня" },
] as const;

export function SearchFilters({ trip, preferences = trip.preferences, onApply, onClose, sort = "recommended", onSortChange }: {
  trip: Trip; preferences?: Preference[]; onApply: (trip: Trip) => void; onClose: () => void;
  sort?: string; onSortChange?: (sort: string) => void;
}) {
  const [initial] = useState({ ...trip, preferences });
  const [draft, setDraft] = useState(initial);
  const [sortDraft, setSortDraft] = useState<string | null>(null);
  const [reset, setReset] = useState(false);
  const scrollBody = useRef<HTMLDivElement>(null);
  const scrollContent = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  useEffect(() => {
    const body = scrollBody.current, content = scrollContent.current;
    if (!body || !content) return;
    const update = () => setMoreBelow(body.scrollHeight - body.clientHeight - body.scrollTop > 1);
    const observer = new ResizeObserver(update);
    observer.observe(body); observer.observe(content);
    body.addEventListener("scroll", update, { passive: true });
    const frame = requestAnimationFrame(update);
    return () => { observer.disconnect(); body.removeEventListener("scroll", update); cancelAnimationFrame(frame); };
  }, []);
  const hasFilters = hasSearchFilters(draft, draft.preferences, sortDraft ?? sort);
  const selected = (feature: FeatureId) => draft.preferences.find((preference) => preference.feature === feature);
  function toggle(feature: FeatureId) {
    setDraft(editPreferences(draft, selected(feature) ? draft.preferences.filter((preference) => preference.feature !== feature)
      : [...draft.preferences, { feature, required: false }]));
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply(applyFilterDraft(trip, preferences, initial, draft, reset));
    if (sortDraft !== null) onSortChange?.(sortDraft);
    onClose();
  }
  return <Modal open onClose={onClose} title="Фильтры" className="search-filters-modal figcraft-filters-modal">
    <form onSubmit={apply}>
      <div className="search-filters-body" ref={scrollBody}>
        <div className="search-filter-content" ref={scrollContent}>
        <div className="figcraft-filter-shortcuts" aria-label="Популярные условия">
          {[...shortcuts, ...shortcuts].map(({ feature, label, image }, index) =>
            <button key={`${feature}-${index}`} type="button" aria-pressed={!!selected(feature)} onClick={() => toggle(feature)}>
              <span><img src={`/images/design/figcraft-${image}.png`} alt="" width={image === "beach" ? 53 : 48} height={48} /></span>
              <strong>{label}</strong>
            </button>)}
        </div>
        <section className="figcraft-filter-sort">
          <label htmlFor="filter-sort">Сортировать</label>
          <div className="figcraft-sort-select"><select id="filter-sort" value={sortDraft ?? sort} disabled={!onSortChange}
            onChange={(event) => setSortDraft(event.target.value)}>
            <option value="recommended">По совпадениям</option><option value="distance">Ближе к пляжу</option><option value="name">По названию</option>
          </select><ChevronDown size={16} aria-hidden="true" /></div>
        </section>
        <section className="figcraft-popular-amenities" aria-label="Удобства">
          <h3>Удобства</h3>
          <div className="figcraft-popular-pills">
            {popular.map(({ feature, label }) => <button type="button" key={feature} aria-pressed={!!selected(feature)}
              aria-label={`${label}${selected(feature) ? selected(feature)?.required ? ", обязательно" : ", желательно" : ""}`}
              onClick={() => toggle(feature)}>{label}</button>)}
          </div>
        </section>
        <details className="figcraft-all-filters">
          <summary aria-label="Показать все удобства и настроить обязательность"><span>Показать ещё</span><ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="figcraft-expanded-filters">
            <p className="search-dialog-intro">«Желательно» влияет на порядок. «Обязательно» исключает известные несоответствия. Недостающие сведения учитываем по выбранному режиму.</p>
            {groups.slice(0, 3).map((group) => <section className="search-filter-group" key={group.title}>
              <h3>{group.title}</h3>{group.description && <p className="search-filter-description">{group.description}</p>}
              <PreferencePicker preferences={draft.preferences} ids={group.ids} onChange={(next) => setDraft(editPreferences(draft, next))} />
            </section>)}
          </div>
        </details>
        <div className="figcraft-expanded-filters figcraft-additional-filters">
            <details className="figcraft-filter-disclosure"><summary><span>Цена, тип жилья и расположение</span>{countHotelFilters(draft.hotelFilters) > 0 && <span className="figcraft-filter-count">{countHotelFilters(draft.hotelFilters)}</span>}<ChevronDown size={18} aria-hidden="true" /></summary>
              <CatalogFilterFields value={draft.hotelFilters} region={draft.region} onChange={(hotelFilters) => setDraft({ ...draft, hotelFilters })} />
            </details>
            <details className="figcraft-filter-disclosure"><summary><span>{draft.admissionMode === "verified" ? "Только подтверждённые условия" : "Можно уточнить недостающие сведения"}</span><ChevronDown size={18} aria-hidden="true" /></summary>
              <AdmissionModePicker value={draft.admissionMode} onChange={(admissionMode) => setDraft({ ...draft, admissionMode })} />
            </details>
            {groups.slice(3).map((group) => <section className="search-filter-group" key={group.title}>
              <h3>{group.title}</h3>{group.description && <p className="search-filter-description">{group.description}</p>}
              <PreferencePicker preferences={draft.preferences} ids={group.ids} onChange={(next) => setDraft(editPreferences(draft, next))} />
            </section>)}
            <label className="field search-wish-field"><span>Что ещё учесть?</span><textarea rows={3} maxLength={1500}
              value={draft.text} onChange={(event) => setDraft({ ...draft, text: event.target.value })} placeholder="Например: не выше 3 этажа, окна на восток" /></label>
        </div>
        </div>
      </div>
      <div className={`search-dialog-footer search-filters-footer${moreBelow ? " has-scroll-shadow" : ""}`}>
        <button className="button secondary" type="button" disabled={!hasFilters} onClick={() => { setReset(true); setDraft(resetSearchFilters(draft)); setSortDraft("recommended"); }}>Сбросить</button>
        <button className="button primary" type="submit">Применить</button>
      </div>
    </form>
  </Modal>;
}

export function priceDistribution(prices: readonly number[]) {
  const known = prices.filter((price) => Number.isFinite(price) && price >= 1 && price <= 100000000);
  if (!known.length) return null;
  const min = Math.min(...known), max = Math.max(...known);
  const bins = Array.from({ length: 44 }, () => 0);
  for (const price of known) bins[Math.min(43, max === min ? 22 : Math.floor((price - min) / (max - min) * 44))]++;
  return { min, max, bins, count: known.length };
}

export function PriceFilter({ trip, onApply, onClose, anchor, prices = [] }: {
  trip: Trip; onApply: (trip: Trip) => void; onClose: () => void;
  anchor?: { left: number; top: number }; prices?: readonly number[];
}) {
  const [draft, setDraft] = useState<{ region: string; value: string } | null>(null);
  const [error, setError] = useState("");
  const value = draft?.region === trip.region ? draft.value : String(trip.hotelFilters?.maxPricePerNight ?? "");
  const symbol = regionDetails(trip.region)?.currencySymbol || "—";
  const distribution = priceDistribution(prices);
  const rangeMaximum = distribution?.max ?? 1;
  const limit = Number(value) || rangeMaximum;
  function edit(value: string) { setDraft({ region: trip.region, value }); setError(""); }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = String(new FormData(event.currentTarget).get("maxPricePerNight") ?? "").trim();
    const maximum = raw === "" ? undefined : Number(raw);
    if (maximum !== undefined && (!Number.isFinite(maximum) || maximum < 1 || maximum > 100000000)) {
      setError("Введите цену от 1 до 100 000 000 или оставьте поле пустым."); return;
    }
    onApply({ ...trip, hotelFilters: { ...trip.hotelFilters, maxPricePerNight: maximum } }); onClose();
  }
  return <div style={anchor ? { "--price-popover-left": `${anchor.left}px`, "--price-popover-top": `${anchor.top}px` } as CSSProperties : undefined}>
    <Modal open onClose={onClose} title="Цена за ночь" className={`figcraft-trip-modal is-trip figcraft-price-modal${anchor ? " is-anchored" : ""}`}>
      <form onSubmit={apply}>
        <div className="figcraft-price-chart">
          {distribution ? <>
            <div className="figcraft-price-bars" aria-hidden="true">{distribution.bins.map((count, index) =>
              <i key={index} style={{ height: `${count / Math.max(...distribution.bins) * 53}px` }}
                className={distribution.min + (distribution.max - distribution.min) * index / 43 <= limit ? "is-included" : ""} />)}</div>
            <input className="figcraft-price-range" type="range" aria-label={`Максимальная цена за ночь, ${symbol}`} min={distribution.min} max={rangeMaximum} step={1}
              value={Math.max(distribution.min, Math.min(rangeMaximum, limit))} disabled={distribution.min === distribution.max}
              onChange={(event) => edit(event.target.value)} />
            <span className="sr-only">Распределение {distribution.count} известных цен за ночь.</span>
          </> : <p>Цены пока не указаны</p>}
        </div>
        <div className="figcraft-price-values">
          <div><span>от</span><output aria-label="Минимальная известная цена, справочно" title="Минимальная известная цена в каталоге">{distribution ? `${distribution.min.toLocaleString("ru-RU")} ${symbol}` : "—"}</output></div>
          <label><span>до</span><span className="figcraft-price-input"><input name="maxPricePerNight" type="number" inputMode="decimal"
            aria-label={`Максимум, ${symbol}`} min={1} max={100000000} step="any" value={value} placeholder="Любая"
            aria-invalid={!!error} onChange={(event) => edit(event.target.value)} /><span aria-hidden="true">{symbol}</span></span></label>
        </div>
        {error && <p className="search-form-error" role="alert">{error}</p>}
        <div className="search-dialog-footer"><button type="button" className="button secondary" onClick={() => edit("")}>Сбросить</button>
          <button type="submit" className="button primary">Применить</button></div>
      </form>
    </Modal>
  </div>;
}
