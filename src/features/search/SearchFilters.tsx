import { useState } from "react";
import type { Trip } from "../../../shared/types";
import { Modal } from "../../shared/ui/Modal";
import { PreferencePicker } from "../preferences/PreferencePicker";
import { Link } from "react-router-dom";
import { canSearch } from "./searchTrip";

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
      <p className="search-dialog-intro">
        Выберите условия, которые важны в поездке. Отметка «Обязательно»
        исключит неподходящие варианты.
      </p>
      <PreferencePicker
        preferences={draft.preferences}
        onChange={(preferences) => setDraft({ ...draft, preferences })}
      />
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
      <div className="search-dialog-footer">
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
