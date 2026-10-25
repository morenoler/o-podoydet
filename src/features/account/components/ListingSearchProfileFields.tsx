import { useId } from "react";
import { LockKeyhole } from "lucide-react";
import type { ListingSearchProfile } from "../../../../shared/account";
import "../searchProfile.css";

export const emptySearchProfile: ListingSearchProfile = { notes: "" };

export function ListingSearchProfileFields({
  value,
  onChange,
}: {
  value: ListingSearchProfile;
  onChange: (profile: ListingSearchProfile) => void;
}) {
  const id = useId();
  return (
    <fieldset className="listing-ai-profile" aria-describedby={id + "-privacy"}>
      <legend>Данные для ИИ</legend>
      <p className="listing-ai-privacy" id={id + "-privacy"}>
        <LockKeyhole size={19} aria-hidden="true" />
        <span>
          Эти заметки доступны только вам. Помощник использует сведения при
          подборе жилья, а исходный текст не показывается гостям.
        </span>
      </p>
      <label className="field">
        <span>
          Подробности для подбора{" "}
          <span className="account-optional">(необязательно)</span>
        </span>
        <textarea
          rows={5}
          maxLength={6000}
          value={value.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          aria-describedby={id + "-notes-hint"}
          placeholder="Расскажите своими словами об особенностях жилья. Например: семейный номер, окна выходят во двор, путь от улицы до номера без ступенек."
        />
        <span className="listing-ai-notes-hint" id={id + "-notes-hint"}>
          <span>
            Сейчас распознаются семейное размещение, окна во двор, путь до
            номера и до пляжа без ступенек, расстояние до пляжа. Неоднозначные
            формулировки требуют уточнения.
          </span>
          <span>{value.notes.length} / 6000</span>
        </span>
      </label>
    </fieldset>
  );
}
