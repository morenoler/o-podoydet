import { useId } from "react";
import { admissionDescriptions, uiAdmissionMode, type AdmissionMode } from "./searchPolicy";

export function AdmissionModePicker({ value, onChange }: {
  value: unknown;
  onChange: (mode: AdmissionMode) => void;
}) {
  const id = useId();
  const mode = uiAdmissionMode(value);
  return (
    <div className="search-admission">
      <fieldset aria-describedby={`${id}-description`}>
        <legend>Как отбирать варианты</legend>
        <div className="search-admission-options">
          {([
            ["explore", "Без известных препятствий"],
            ["verified", "Только подтверждённые"],
          ] as const).map(([key, label]) => (
            <label key={key} className={mode === key ? "is-selected" : ""}>
              <input type="radio" name={id} value={key} checked={mode === key}
                onChange={() => onChange(key)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p id={`${id}-description`}>{admissionDescriptions[mode]}</p>
    </div>
  );
}
