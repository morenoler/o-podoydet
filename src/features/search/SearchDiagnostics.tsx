import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import type { SearchResult } from "../../../shared/types";
import { features } from "../../../shared/features";
import { accommodationPath } from "../../shared/lib/accommodation";
import { capacityNeedsClarification, criterionNeedsClarification } from "../../shared/lib/matchPresentation";

export function SearchDiagnostics({ data }: { data: SearchResult }) {
  return (
    <div className="search-explanations">
      {(!!data.warnings.length || !!data.preferences.length) && (
        <details>
          <summary>
            Условия текущего поиска <ChevronDown size={18} aria-hidden="true" />
          </summary>
          {data.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          <div className="tag-row">
            {data.preferences.map((preference) => (
              <span className="tag" key={preference.feature}>
                {features[preference.feature].label}
                {preference.required ? " · обязательно" : ""}
              </span>
            ))}
          </div>
          <Link to="/wishes">Изменить пожелания</Link>
        </details>
      )}
      {!!data.excluded.length && (
        <details>
          <summary>
            {data.excluded.length} вариантов не прошли обязательные условия{" "}
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          {data.excluded.map((match) => (
            <div className="search-excluded-row" key={match.hotel.id}>
              <Link to={accommodationPath(match.hotel)}>
                {match.hotel.name}
              </Link>
              <span>
                {match.best.capacityStatus === "mismatch"
                  ? capacityNeedsClarification(match.best)
                    ? "Вместимость требует уточнения"
                    : "Недостаточная вместимость категорий"
                  : [
                      ...match.best.criteria
                        .filter(
                          (criterion) =>
                            criterion.required &&
                            criterion.status === "mismatch",
                        )
                        .map((criterion) => `${features[criterion.feature].label}${criterionNeedsClarification(criterion) ? " — требует уточнения" : " — не соответствует"}`),
                      ...(match.ownerCriteria || [])
                        .filter(
                          (criterion) =>
                            criterion.required &&
                            criterion.status === "mismatch",
                        )
                        .map(
                          (criterion) =>
                            `${criterion.label}${criterion.evidenceStatus === "unknown" ? " — нет данных" : ""}`,
                        ),
                    ].join(", ")}
              </span>
            </div>
          ))}
        </details>
      )}
      <details>
        <summary>
          Источники и ход подбора <ChevronDown size={18} aria-hidden="true" />
        </summary>
        {data.trace.map((trace) => (
          <p key={trace.step}>
            <strong>{trace.step}.</strong> {trace.detail}
          </p>
        ))}
      </details>
    </div>
  );
}
