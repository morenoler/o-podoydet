import { useState } from "react";
import type { Trip } from "../../../shared/types";
import { Modal } from "../../shared/ui/Modal";
import { PreferencePicker } from "../preferences/PreferencePicker";
import { Link } from "react-router-dom";
import { canSearch } from "./searchTrip";
import { AdmissionModePicker } from "./AdmissionModePicker";
import type { FeatureId } from "../../../shared/types";

const groups: { title: string; ids: FeatureId[] }[] = [
  { title: "Пляж и дорога", ids: ["beach_walk", "step_free_route"] },
  { title: "Номер и размещение", ids: ["family", "step_free_access", "courtyard"] },
  { title: "Окружение", ids: ["area_safety", "clean_air", "low_noise"] },
];

export function SearchFilters({
  trip,
  onApply,
  onClose,
}: {
  trip: Trip;
  onApply: (trip: Trip) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(trip);
  return (
    <Modal
      open
      onClose={onClose}
      title="Настроить поиск"
      className="search-filters-modal"
    >
      <div className="search-filters-body">
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
              onChange={(preferences) => setDraft({ ...draft, preferences })} />
          </section>
        ))}
      <label className="field search-wish-field">
        <span>Что ещё учесть?</span>
        <textarea
          rows={4}
          maxLength={1500}
          value={draft.text}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          placeholder="Например: нужен второй этаж и окна на восток"
        />
      </label>
      <p className="search-dialog-intro">
        Неизвестные условия и предположения будут отмечены в результатах.
      </p>
      <p className="search-dialog-intro">
        {draft.scenarios.length
          ? "Также учтены сценарии вашей поездки. "
          : "Можно выбрать готовый сценарий поездки. "}
        <Link
          to={canSearch(draft) ? "/wishes" : "/trip"}
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          {canSearch(draft)
            ? "Сценарии и пожелания"
            : "Выбрать даты и сценарий"}
        </Link>
      </p>
      </div>
      <div className="search-dialog-footer search-filters-footer">
        <span className="search-filters-count">Выбрано: {draft.preferences.length}</span>
        <button
          className="button secondary"
          type="button"
          onClick={() =>
            setDraft({ ...draft, preferences: [], scenarios: [], text: "" })
          }
        >
          Сбросить
        </button>
        <button
          className="button primary"
          type="button"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          Применить
        </button>
      </div>
    </Modal>
  );
}
