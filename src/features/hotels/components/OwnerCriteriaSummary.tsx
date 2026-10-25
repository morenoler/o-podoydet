import { CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import type { OwnerCriterion } from "../../../../shared/types";
import "../ownerListings.css";

export function OwnerCriteriaSummary({
  criteria = [],
  detailed = false,
}: {
  criteria?: OwnerCriterion[];
  detailed?: boolean;
}) {
  if (!criteria.length) return null;
  return (
    <section
      className="owner-criteria-summary"
      aria-label="Пожелания к этажу и расположению окон"
    >
      <p className="owner-criteria-heading">Этаж и расположение окон</p>
      <ul>
        {criteria.map((criterion) => {
          const unknown = criterion.evidenceStatus === "unknown";
          const matches = criterion.status === "match";
          const Icon = unknown ? CircleHelp : matches ? CheckCircle2 : XCircle;
          return (
            <li
              key={criterion.id}
              className={
                matches ? "owner-criterion-match" : "owner-criterion-mismatch"
              }
            >
              <Icon size={17} aria-hidden="true" />
              <div>
                <strong>{criterion.label}</strong>
                <small className="owner-criterion-priority">
                  {criterion.required ? "Обязательно" : "Желательно"}
                </small>
                <span>
                  {unknown
                    ? "Нет сведений для проверки"
                    : matches
                      ? "Соответствует по сведениям отельера"
                      : "Не соответствует пожеланию"}
                </span>
                {detailed && <p>{criterion.explanation}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {detailed && (
        <p className="owner-criteria-source">
          {criteria[0]?.sourceExplanation ||
            "Сведения отельера; независимая проверка не проведена."}
        </p>
      )}
    </section>
  );
}
