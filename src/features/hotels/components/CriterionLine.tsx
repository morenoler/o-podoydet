import type { CriterionDecision } from "../../../../shared/types";
import { CheckCircle2, X, ExternalLink } from "lucide-react";
import { features } from "../../../../shared/features";
import { dateFull } from "../../../shared/lib/date";

export function CriterionLine({
  criterion,
  detailed = false,
}: {
  criterion: CriterionDecision;
  detailed?: boolean;
}) {
  const Icon = criterion.status === "match" ? CheckCircle2 : X;
  return (
    <div className={`criterion ${criterion.status}`}>
      <Icon
        size={17}
        role="img"
        aria-label={
          criterion.status === "match"
            ? "Соответствует фильтру"
            : "Не соответствует фильтру"
        }
      />
      <div className="criterion-body">
        <strong>
          {features[criterion.feature].label}
          {criterion.required && (
            <span className="required-label">Обязательно</span>
          )}
        </strong>
        {criterion.assumed && (
          <span className="assumption-label">Предположение</span>
        )}
        <small>{criterion.explanation}</small>
        {criterion.assessmentBasis === "historical" && (
          <small>Историческая оценка · не прогноз на даты поездки</small>
        )}
        {detailed &&
          (criterion.sourceExplanation !== criterion.explanation ||
            (criterion.details?.length || 0) > 0 ||
            (criterion.environmentalEvidence?.length || 0) > 0) && (
            <details className="criterion-evidence">
              <summary>
                {criterion.decisionBasis === "estimate"
                  ? "Основания предположения и источники"
                  : "Расчёт и источники"}
              </summary>
              {criterion.assumed && (
                <p className="muted">
                  Источники ниже использованы для оценки. Они не подтверждают
                  результат фильтра сами по себе.
                </p>
              )}
              {criterion.sourceExplanation !== criterion.explanation && (
                <p>{criterion.sourceExplanation}</p>
              )}
              {criterion.details?.map((detail, i) => (
                <p key={i}>{detail}</p>
              ))}
              {criterion.environmentalEvidence?.map((e, i) => (
                <p key={i}>
                  <a href={e.sourceUrl} target="_blank" rel="noreferrer">
                    {e.details} <ExternalLink size={12} />
                  </a>
                  {e.observedAt && (
                    <small>Данные: {dateFull(e.observedAt)}</small>
                  )}
                </p>
              ))}
            </details>
          )}
      </div>
    </div>
  );
}
