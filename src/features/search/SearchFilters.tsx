import { useState } from "react";
import type { Preference, Trip } from "../../../shared/types";
import { Modal } from "../../shared/ui/Modal";
import { PreferencePicker } from "../preferences/PreferencePicker";
import { applyFilterDraft, editPreferences } from "./preferences";
import { AdmissionModePicker } from "./AdmissionModePicker";
import type { FeatureId } from "../../../shared/types";
import { CatalogFilterFields } from "./CatalogFilterFields";
import { countHotelFilters } from "../../../shared/catalogFilters";

const groups: { title: string; ids: FeatureId[] }[] = [
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
      title="Настроить поиск"
      className="search-filters-modal"
    >
      <form onSubmit={(event) => { event.preventDefault(); apply(); onClose(); }}>
      <div className="search-filters-body">
        <CatalogFilterFields value={draft.hotelFilters} region={draft.region}
          onChange={(hotelFilters) => setDraft({ ...draft, hotelFilters })} />
        <h3 className="search-filter-section-title">Условия поездки</h3>
        <AdmissionModePicker value={draft.admissionMode}
          onChange={(admissionMode) => setDraft({ ...draft, admissionMode })} />
        <p className="search-dialog-intro">
          «Желательно» влияет на порядок. «Обязательно» исключает известные
          несоответствия. Недостающие сведения учитываем по выбранному режиму.
        </p>
        {groups.map((group) => (
          <section className="search-filter-group" key={group.title}>
            <h3>{group.title}</h3>
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
            setDraft({ ...draft, preferences: [], scenarios: [], text: "", preferenceOverrides: undefined, hotelFilters: undefined });
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
