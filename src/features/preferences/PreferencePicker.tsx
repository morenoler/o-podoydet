import { featureIds, features } from "../../../shared/features";
import type { Preference, FeatureId } from "../../../shared/types";
import { Check } from "lucide-react";

export function PreferencePicker({
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
