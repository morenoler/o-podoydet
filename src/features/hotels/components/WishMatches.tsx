import type { CriterionDecision } from "../../../../shared/types";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, CircleHelp, X } from "lucide-react";
import { CriterionLine } from "./CriterionLine";
import { criterionMatches, criterionNeedsClarification } from "../../../shared/lib/matchPresentation";

export function WishMatches({ criteria }: { criteria: CriterionDecision[] }) {
  if (!criteria.length)
    return (
      <div className="wish-empty">
        <strong>Пожелания пока не выбраны</strong>
        <p>Выберите, что важно вам, и здесь появятся совпадения.</p>
        <Link to="/wishes">
          Выбрать пожелания <ArrowRight size={14} />
        </Link>
      </div>
    );
  const matched = criteria.filter(criterionMatches);
  const groups = [
    {
      key: "match",
      title: "Совпадает с вашими пожеланиями",
      Icon: CheckCircle2,
      items: matched,
    },
    {
      key: "mismatch",
      title: "Не совпадает",
      Icon: X,
      items: criteria.filter((c) => c.status === "mismatch" && !criterionNeedsClarification(c)),
    },
    {
      key: "unknown",
      title: "Требует уточнения",
      Icon: CircleHelp,
      items: criteria.filter(criterionNeedsClarification),
    },
  ];
  return (
    <section
      className="wish-matches"
      aria-label="Совпадения с вашими пожеланиями"
    >
      <div className="wish-summary">
        <strong>Ваши пожелания</strong>
        <span>
          Совпало {matched.length} из {criteria.length}
        </span>
      </div>
      {matched.length < criteria.length &&
        criteria.some((c) => c.required) &&
        criteria.every((c) => !c.required || criterionMatches(c)) && (
          <p className="wish-requirements">Обязательные условия выполнены</p>
        )}
      {groups
        .filter((group) => group.key === "match" || group.items.length)
        .map(({ key, title, Icon, items }) => (
          <div className={`wish-group wish-${key}`} key={key}>
            <p className="wish-group-title">
              <Icon size={18} aria-hidden="true" />
              <strong>{title}</strong>
              <span>{items.length}</span>
            </p>
            {items.length ? (
              <ul>
                {[...items]
                  .sort((a, b) => Number(b.required) - Number(a.required))
                  .map((criterion) => (
                    <li key={criterion.feature}>
                      <CriterionLine criterion={criterion} />
                      {criterion.facts.some((fact) => fact.demo) && (
                        <span className="wish-demo">
                          Условие номера · демоданные
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="wish-no-match">
                Нет совпадений по выбранным пожеланиям.
              </p>
            )}
          </div>
        ))}
    </section>
  );
}
