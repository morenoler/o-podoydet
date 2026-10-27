import type { CriterionDecision } from "../../../../shared/types";
import { CheckCircle2, CircleHelp, X, ExternalLink } from "lucide-react";
import { features } from "../../../../shared/features";
import { dateFull } from "../../../shared/lib/date";
import { criterionNeedsClarification } from "../../../shared/lib/matchPresentation";
import { clarificationDate } from "../../clarifications/clarificationDates";
import { timeZoneLabel } from "../../../../shared/regions";

export function CriterionLine({
  criterion,
  detailed = false,
}: {
  criterion: CriterionDecision;
  detailed?: boolean;
}) {
  const unconfirmed = criterionNeedsClarification(criterion);
  const Icon = unconfirmed
    ? CircleHelp
    : criterion.status === "match"
      ? CheckCircle2
      : X;
  return (
    <div className={`criterion ${unconfirmed ? "unknown" : criterion.status}`}>
      <Icon
        size={17}
        role="img"
        aria-label={
          unconfirmed
            ? "Требует уточнения"
            : criterion.status === "match"
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
        {!!criterion.reportedEvidence?.length && (
          <small className="criterion-reported-source">
            Со слов отельера · без независимой проверки
          </small>
        )}
        <small>{criterion.explanation}</small>
        {criterion.assessmentBasis === "historical" && (
          <small>Историческая оценка · не прогноз на даты поездки</small>
        )}
        {detailed &&
          (criterion.sourceExplanation !== criterion.explanation ||
            (criterion.details?.length || 0) > 0 ||
            (criterion.environmentalEvidence?.length || 0) > 0 ||
            (criterion.reportedEvidence?.length || 0) > 0) && (
            <details className="criterion-evidence">
              <summary>
                {criterion.decisionBasis === "estimate"
                  ? "Доступные сведения и ограничения"
                  : "Расчёт и источники"}
              </summary>
              {unconfirmed && (
                <p className="muted">
                  Этих сведений недостаточно, чтобы подтвердить условие.
                  Неизвестное условие не считается подтверждённым совпадением.
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
              {criterion.reportedEvidence?.map((e, i) => (
                <div
                  className="criterion-reported-evidence"
                  key={`${e.recordedAt}:${i}`}
                >
                  <p>
                    Заявление отельера:{" "}
                    {e.value === null ? "неизвестно" : e.value ? "да" : "нет"}.
                    {e.evidenceStatus === "conflict"
                      ? " Есть противоречащие сведения."
                      : e.evidenceStatus === "stale"
                        ? " Требуется перепроверка."
                        : ""}
                  </p>
                  <p>
                    {e.evidenceStatus === "unknown"
                      ? "Это заявление не подтверждает условие для текущего варианта размещения и всех дат поездки."
                      : "Область заявления — единица размещения из объявления. Актуальность указана отдельно."}
                  </p>
                  <p>
                    Записано {clarificationDate(e.recordedAt, e.timeZone)} · перепроверить
                    до {clarificationDate(e.recheckAt, e.timeZone)} ({timeZoneLabel(e.timeZone || "Asia/Seoul")}).
                    {e.observedOn
                      ? ` Проверено отельером ${clarificationDate(e.observedOn, e.timeZone)}.`
                      : " Дата проверки отельером неизвестна."}
                  </p>
                  {e.validFrom && e.validTo && (
                    <p>
                      Для проживания с {dateFull(e.validFrom)} по{" "}
                      {dateFull(e.validTo)}.
                    </p>
                  )}
                </div>
              ))}
            </details>
          )}
      </div>
    </div>
  );
}
