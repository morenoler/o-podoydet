import type { CriterionDecision } from "../../../../shared/types";
import { CheckCircle2, CircleHelp, X, ExternalLink } from "lucide-react";
import { features } from "../../../../shared/features";
import { dateFull } from "../../../shared/lib/date";
import { criterionNeedsClarification } from "../../../shared/lib/matchPresentation";

export function CriterionLine({
  criterion,
  detailed = false,
}: {
  criterion: CriterionDecision;
  detailed?: boolean;
}) {
  const unconfirmed = criterionNeedsClarification(criterion);
  const Icon = unconfirmed ? CircleHelp : criterion.status === "match" ? CheckCircle2 : X;
  return (
    <div className={`criterion ${unconfirmed ? "unknown" : criterion.status}`}>
      <Icon
        size={17}
        role="img"
        aria-label={
          unconfirmed ? "Требует уточнения" : criterion.status === "match"
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
        {unconfirmed && (
          <span className="assumption-label">Требует уточнения</span>
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
                  ? "Доступные сведения и ограничения"
                  : "Расчёт и источники"}
              </summary>
              {unconfirmed && (
                <p className="muted">
                  Этих сведений недостаточно, чтобы подтвердить условие.
                  Обязательный фильтр пропускает только подтверждённые совпадения.
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
