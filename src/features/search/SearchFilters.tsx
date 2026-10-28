import { useState, type CSSProperties } from "react";
import type { Preference, Trip } from "../../../shared/types";
import { Modal } from "../../shared/ui/Modal";
import { PreferencePicker } from "../preferences/PreferencePicker";
import { applyFilterDraft, editPreferences, resetSearchFilters } from "./preferences";
import { AdmissionModePicker } from "./AdmissionModePicker";
import type { FeatureId } from "../../../shared/types";
import { CatalogFilterFields } from "./CatalogFilterFields";
import { countHotelFilters } from "../../../shared/catalogFilters";
import { regionDetails } from "../../../shared/regions";
import { Accessibility, WashingMachine, Waves, Umbrella } from "lucide-react";

const groups: { title: string; description?: string; ids: FeatureId[] }[] = [
  { title: "В номере", description: "Проверяем удобства именно выбранной категории.", ids: ["kitchen", "dishwasher", "washing_machine", "wifi", "air_conditioning", "balcony"] },
  { title: "В отеле", description: "Наличие и условия доступа зависят от сведений источника.", ids: ["pool", "parking", "breakfast"] },
  { title: "С питомцем", ids: ["pets_allowed"] },
  { title: "Пляж и дорога", ids: ["beach_walk", "step_free_route"] },
  { title: "Номер и размещение", ids: ["family", "step_free_access", "courtyard"] },
  { title: "Окружение", ids: ["area_safety", "clean_air", "low_noise"] },
];

export function SearchFilters({
  trip,
  preferences = trip.preferences,
  onApply,
  onClose,
}: {
  trip: Trip;
  preferences?: Preference[];
  onApply: (trip: Trip) => void;
  onClose: () => void;
}) {
  const [initial] = useState({ ...trip, preferences });
  const [draft, setDraft] = useState(initial);
  const [reset, setReset] = useState(false);
  const apply = () => onApply(applyFilterDraft(trip, preferences, initial, draft, reset));
  return (
    <Modal
      open
      onClose={onClose}
      title="Фильтры"
      className="search-filters-modal figcraft-filters-modal"
    >
      <form onSubmit={(event) => { event.preventDefault(); apply(); onClose(); }}>
      <div className="search-filters-body">
        <div className="figcraft-filter-shortcuts" aria-label="Популярные условия">
          {([
            { feature: "beach_walk", label: "Близость к пляжу", Icon: Umbrella },
            { feature: "step_free_access", label: "Без ступеней", Icon: Accessibility },
            { feature: "washing_machine", label: "Стиральная машина", Icon: WashingMachine },
            { feature: "pool", label: "Бассейн", Icon: Waves },
          ] as const).map(({ feature, label, Icon }) => {
            const selected = draft.preferences.some((preference) => preference.feature === feature);
            return <button key={feature} type="button" aria-pressed={selected} onClick={() => setDraft(editPreferences(draft,
              selected ? draft.preferences.filter((preference) => preference.feature !== feature) : [...draft.preferences, { feature, required: false }]))}>
              <span><Icon size={30} strokeWidth={1.5} aria-hidden="true" /></span><strong>{label}</strong>
            </button>;
          })}
        </div>
        <details className="figcraft-filter-disclosure">
          <summary>Цена, тип жилья и расположение{countHotelFilters(draft.hotelFilters) > 0 && <span>{countHotelFilters(draft.hotelFilters)}</span>}</summary>
        <CatalogFilterFields value={draft.hotelFilters} region={draft.region}
          onChange={(hotelFilters) => setDraft({ ...draft, hotelFilters })} />
        </details>
        <details className="figcraft-filter-disclosure">
          <summary>{draft.admissionMode === "verified" ? "Только подтверждённые условия" : "Можно уточнить недостающие сведения"}</summary>
        <AdmissionModePicker value={draft.admissionMode}
          onChange={(admissionMode) => setDraft({ ...draft, admissionMode })} />
        </details>
        <p className="search-dialog-intro">
          «Желательно» влияет на порядок. «Обязательно» исключает известные
          несоответствия. Недостающие сведения учитываем по выбранному режиму.
        </p>
        {groups.map((group) => (
          <section className="search-filter-group" key={group.title}>
            <h3>{group.title}</h3>
            {group.description && <p className="search-filter-description">{group.description}</p>}
            <PreferencePicker preferences={draft.preferences} ids={group.ids}
              onChange={(preferences) => setDraft(editPreferences(draft, preferences))} />
          </section>
        ))}
      <label className="field search-wish-field">
        <span>Что ещё учесть?</span>
        <textarea
          rows={4}
          maxLength={1500}
          value={draft.text}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          placeholder="Например: не выше 3 этажа, окна на восток"
        />
      </label>
      </div>
      <div className="search-dialog-footer search-filters-footer">
        <span className="search-filters-count">Выбрано: {draft.preferences.length + countHotelFilters(draft.hotelFilters)}</span>
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            setReset(true);
            setDraft(resetSearchFilters(draft));
          }}
        >
          Сбросить
        </button>
        <button
          className="button primary"
          type="submit"
        >
          Применить
        </button>
      </div>
      </form>
    </Modal>
  );
}

export function PriceFilter({ trip, onApply, onClose, anchor }: {
  trip: Trip;
  onApply: (trip: Trip) => void;
  onClose: () => void;
  anchor?: { left: number; top: number };
}) {
  const [draft, setDraft] = useState<{ region: string; value: string } | null>(null);
  const [error, setError] = useState("");
  // A draft belongs to one currency. External changes remain current until the user edits.
  const edited = draft?.region === trip.region;
  const value = edited ? draft.value : String(trip.hotelFilters?.maxPricePerNight ?? "");
  const symbol = regionDetails(trip.region)?.currencySymbol || "—";
  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const field = new FormData(event.currentTarget).get("maxPricePerNight");
    const raw = typeof field === "string" ? field.trim() : value;
    const maximum = raw === "" ? undefined : Number(raw);
    if (maximum !== undefined && (!Number.isFinite(maximum) || maximum < 1 || maximum > 100000000)) {
      setError("Введите цену от 1 до 100 000 000 или оставьте поле пустым.");
      return;
    }
    onApply({ ...trip, hotelFilters: { ...trip.hotelFilters, maxPricePerNight: maximum } });
    onClose();
  }
  return <div style={anchor ? { "--price-popover-left": `${anchor.left}px`, "--price-popover-top": `${anchor.top}px` } as CSSProperties : undefined}>
    <Modal open onClose={onClose} title="Цена за ночь" className={`figcraft-trip-modal is-trip figcraft-price-modal${anchor ? " is-anchored" : ""}`}>
      <form onSubmit={apply}>
        <label className="field">
          <span>Максимум, {symbol}</span>
          <input name="maxPricePerNight" type="number" inputMode="decimal" min={1} max={100000000} step="any"
            value={value} placeholder="Любая цена" aria-invalid={!!error} aria-describedby="price-filter-hint"
            onChange={(event) => { setDraft({ region: trip.region, value: event.target.value }); setError(""); }} />
        </label>
        <p id="price-filter-hint" className="search-dialog-intro">Цена за один номер в {symbol}. Варианты без указанной цены не попадут в выборку с ограничением.</p>
        {error && <p className="search-form-error" role="alert">{error}</p>}
        <div className="search-dialog-footer">
          <button type="button" className="button secondary" onClick={() => { setDraft({ region: trip.region, value: "" }); setError(""); }}>Сбросить</button>
          <button type="submit" className="button primary">Применить</button>
        </div>
      </form>
    </Modal>
  </div>;
}
