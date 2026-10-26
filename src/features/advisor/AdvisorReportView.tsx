import { ArrowRight, ExternalLink, HelpCircle } from "lucide-react";
import { Link } from "react-router-dom";
import type { AdvisorEvidence, AdvisorRun } from "../../../shared/advisor";
import {
  accountListingId,
  accommodationPath,
} from "../../shared/lib/accommodation";

function sourceUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function Evidence({ evidence }: { evidence: AdvisorEvidence }) {
  const confirmed = evidence.status === "match" && evidence.evidenceStatus === "match" && !evidence.assumed;
  const knownMismatch = evidence.evidenceStatus === "mismatch";
  return (
    <li className="advisor-evidence">
      <div>
        <strong>{evidence.label}</strong>
        <span
          className={
            confirmed
              ? "advisor-label"
              : "advisor-label advisor-label-warning"
          }
        >
          {confirmed
            ? "Условие выполнено"
            : knownMismatch ? "Условие не выполнено" : "Требует уточнения"}
          {evidence.required ? " · обязательно" : ""}
        </span>
      </div>
      {evidence.assumed && (
        <span className="advisor-assumption">Предположение</span>
      )}
      <p>{evidence.explanation}</p>
      {evidence.sources.length > 0 && (
        <ul className="advisor-sources">
          {evidence.sources.map((source, index) => {
            const url = sourceUrl(source.url);
            return url ? (
              <li key={`${source.url}-${index}`}>
                <a href={url} target="_blank" rel="noreferrer">
                  {source.label || "Источник"}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              </li>
            ) : null;
          })}
        </ul>
      )}
    </li>
  );
}

export function AdvisorReportView({ run }: { run: AdvisorRun }) {
  const { report, context } = run;
  if (!report) return null;
  const needsClarification = report.outcome === "clarification_needed";
  const noMatches =
    !needsClarification &&
    (report.outcome === "no_matches" || context.fitCount === 0);
  const candidates = [...new Set(report.candidateIds)]
    .map((id) => context.candidates.find((candidate) => candidate.id === id))
    .filter((candidate) => candidate !== undefined)
    .slice(0, 3);
  const scenarios = [...new Set(report.scenarioIds)]
    .map((id) => context.scenarios.find((scenario) => scenario.id === id))
    .filter((scenario) => scenario !== undefined);
  const question = context.questions.find(
    (item) => item.id === report.questionId,
  );

  return (
    <div className="advisor-report">
      <div className="advisor-conclusion">
        <h3>
          {needsClarification
            ? "Сначала стоит уточнить пожелание"
            : noMatches
              ? "При сохранении обязательных условий рекомендовать отель не могу"
              : "С чего начать выбор"}
        </h3>
        <p>{report.summary}</p>
        <p className="advisor-footnote">
          Данные подбора на {formatSnapshotTime(context.generatedAt)}.
        </p>
        {noMatches && (
          <p className="advisor-muted">
            Отсутствие подтверждающих данных не означает, что отель или район
            плохие. Обязательные условия остаются в силе.
          </p>
        )}
      </div>
      {candidates.length > 0 && (
        <div className="advisor-candidates">
          <h4>
            {noMatches
              ? "Что помешало этим вариантам пройти условия"
              : "Варианты для внимательного просмотра"}
          </h4>
          {candidates.map((candidate) => {
            const cautionIds = new Set(
              report.cautions
                .filter((item) => item.candidateId === candidate.id)
                .flatMap((item) => item.evidenceIds),
            );
            const cautions = candidate.criteria.filter(
              (evidence) =>
                cautionIds.has(evidence.id) ||
                evidence.assumed ||
                (evidence.required && evidence.status === "mismatch"),
            );
            return (
              <article className="advisor-candidate" key={candidate.id}>
                <div className="advisor-candidate-heading">
                  <div>
                    <Link
                      to={accommodationPath({ id: candidate.hotelId })}
                      className="advisor-hotel-link"
                    >
                      {candidate.hotelName}
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                    <p className="advisor-muted">{candidate.roomName}</p>
                    {accountListingId({ id: candidate.hotelId }) && (
                      <p className="advisor-muted">
                        Сведения отельера; независимая проверка не проведена.
                      </p>
                    )}
                  </div>
                  <span
                    className={
                      candidate.provisional ? "advisor-provisional" : candidate.status === "fits"
                        ? "advisor-fit"
                        : "advisor-excluded"
                    }
                  >
                    {candidate.provisional ? "Вариант для уточнения" : candidate.status === "fits"
                      ? "Прошёл текущие условия"
                      : "Не прошёл текущий отбор"}
                  </span>
                </div>
                {cautions.length > 0 && (
                  <div className="advisor-cautions">
                    <h5>Что отметил проверяющий</h5>
                    <ul>
                      {cautions.map((evidence) => (
                        <Evidence evidence={evidence} key={evidence.id} />
                      ))}
                    </ul>
                  </div>
                )}
                <details className="advisor-disclosure">
                  <summary>
                    Все условия и источники · {candidate.criteria.length}
                  </summary>
                  <ul>
                    {candidate.criteria.map((evidence) => (
                      <Evidence evidence={evidence} key={evidence.id} />
                    ))}
                  </ul>
                </details>
              </article>
            );
          })}
        </div>
      )}
      {scenarios.length > 0 && (
        <section
          className="advisor-scenarios"
          aria-label="Предварительные варианты изменения пожеланий"
        >
          <h4>Что изменится при другом приоритете</h4>
          <p className="advisor-muted">
            Это предварительный расчёт. Ваши пожелания ещё не изменены.
          </p>
          {scenarios.map((scenario) => (
            <article className="advisor-scenario" key={scenario.id}>
              <span className="advisor-scenario-kind">
                {scenario.kind === "requires_consent"
                  ? "Только если вы решите изменить обязательное условие"
                  : "Изменение приоритета желательного условия"}
              </span>
              <h5>{scenario.label}</h5>
              <p>{scenario.explanation}</p>
              <p className="advisor-scenario-count">
                Подходящих вариантов: <strong>{scenario.count}</strong>
                {scenario.gainedCount > 0 && (
                  <>
                    {" "}
                    · новых относительно текущего подбора:{" "}
                    <strong>{scenario.gainedCount}</strong>
                  </>
                )}
              </p>
              <Link to="/wishes" className="text-link">
                Пересмотреть это пожелание{" "}
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </article>
          ))}
        </section>
      )}
      {question && (
        <section className="advisor-question">
          <HelpCircle size={22} aria-hidden="true" />
          <div>
            <h4>{question.text}</h4>
            <p>{question.reason}</p>
            <Link to="/wishes" className="text-link">
              Уточнить в пожеланиях <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </section>
      )}
      {report.nextSteps.length > 0 && (
        <div className="advisor-next">
          <h4>Следующие шаги</h4>
          <ul>
            {report.nextSteps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="advisor-footnote">
        Разбор использует сведения текущего каталога. Цены, наличие на даты и
        бронирование не проверяются.
      </p>
    </div>
  );
}

function formatSnapshotTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });
}
