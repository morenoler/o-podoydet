import type { Fact } from "../../../../shared/types";
import { features } from "../../../../shared/features";
import { ExternalLink } from "lucide-react";
import { dateFull } from "../../../shared/lib/date";

export function FactEvidence({ fact }: { fact: Fact }) {
  return (
    <article className={`evidence ${fact.supersededBy ? "superseded" : ""}`}>
      <div className="evidence-title">
        <strong>
          {features[fact.feature].label}:{" "}
          {typeof fact.value === "boolean"
            ? fact.value
              ? "да"
              : "нет"
            : typeof fact.value === "number"
              ? `${fact.value} м`
              : (fact.value ?? "не подтверждено")}
        </strong>
        <span className={`tag ${fact.demo ? "demo" : ""}`}>
          {fact.demo
            ? "Демонстрация · не влияет на подбор"
            : fact.method === "official"
              ? "Официальный источник"
              : "Расчёт по OSM"}
        </span>
      </div>
      <blockquote>{fact.quote}</blockquote>
      <p className="evidence-source">
        {fact.sourceUrl ? (
          <a href={fact.sourceUrl} target="_blank" rel="noreferrer">
            {fact.source} <ExternalLink size={12} />
          </a>
        ) : (
          fact.source
        )}
      </p>
      <p className="muted">
        Получено {dateFull(fact.obtainedAt)} · перепроверить до{" "}
        {dateFull(fact.expiresAt)}
        {fact.sourceDate
          ? ` · исходные данные ${dateFull(fact.sourceDate)}`
          : ""}
      </p>
      <p className="muted">
        Уверенность:{" "}
        {fact.confidence === "high"
          ? "высокая"
          : fact.confidence === "medium"
            ? "средняя"
            : "низкая"}
        . {fact.confidenceReason}
      </p>
      {fact.supersededBy && (
        <p className="muted">
          Заменено новым подтверждённым ответом. Сохранено в истории.
        </p>
      )}
    </article>
  );
}
