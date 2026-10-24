import { useEffect, useState } from "react";
import { CircleHelp, ExternalLink, Wind, ShieldCheck } from "lucide-react";
import { api } from "./api";
import type { AreaAssessment } from "../shared/area";

const timestamp = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        timeZone: "Asia/Seoul",
        dateStyle: "medium",
        timeStyle: "short",
      }) + " (Пусан, UTC+9)"
    : "Время не указано";
const metricNames = {
  reported_incidents: "Зарегистрированные происшествия",
  crime_density_grade: "Категория плотности происшествий",
  crime_rate_per_100000: "Частота на 100 000 жителей",
};

export function AreaPanel({ hotelId }: { hotelId: string }) {
  const [assessment, setAssessment] = useState<AreaAssessment | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus("loading");
    setAssessment(null);
    api<{ assessment: AreaAssessment | null }>(
      `/areas/${encodeURIComponent(hotelId)}`,
    )
      .then((data) => {
        if (active) {
          setAssessment(data.assessment);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [hotelId, attempt]);
  const air = assessment?.airQuality;
  const stale =
    air &&
    (air.status === "stale" ||
      [air.time, air.fetchedAt].some(
        (t) => t && Date.now() - Date.parse(t) > 6 * 60 * 60 * 1000,
      ));
  return (
    <section className="subsection area-section" aria-labelledby="area-heading">
      <h2 id="area-heading">Район вокруг отеля</h2>
      <p className="muted">
        Качество воздуха и доступные сведения о безопасности. У этих данных своё
        время и границы покрытия.
      </p>
      {status === "loading" ? (
        <p role="status">Загружаем сведения о районе…</p>
      ) : status === "error" ? (
        <div className="notice" role="alert">
          <CircleHelp size={20} />
          <span>
            Не удалось загрузить оценку района.{" "}
            <button
              className="text-link"
              onClick={() => setAttempt((a) => a + 1)}
            >
              Повторить
            </button>
          </span>
        </div>
      ) : !assessment ? (
        <div className="notice">
          <CircleHelp size={20} />
          <span>
            Оценка для этого отеля ещё не подготовлена. Отсутствие сведений не
            означает, что район безопасен или воздух чистый.
          </span>
        </div>
      ) : (
        <div className="area-columns">
          <article className="area-air">
            <h3>
              <Wind size={21} />
              Качество воздуха
            </h3>
            <span className={`area-status ${stale ? "outdated" : ""}`}>
              {stale
                ? "Снимок устарел"
                : air?.status === "unknown"
                  ? "Недостаточно данных"
                  : air?.status === "partial"
                    ? "Частичные данные модели"
                    : "Данные модели"}
            </span>
            <p className="area-aqi">
              <strong>{air?.usAqi ?? "—"}</strong>
              <span>
                US AQI
                {air?.category && (
                  <b>
                    {air.category}
                    {stale ? " на момент снимка" : ""}
                  </b>
                )}
              </span>
            </p>
            <dl className="air-metrics">
              <div>
                <dt>PM2.5</dt>
                <dd>
                  {air?.pm25 ?? "—"}
                  <small>мкг/м³</small>
                </dd>
              </div>
              <div>
                <dt>PM10</dt>
                <dd>
                  {air?.pm10 ?? "—"}
                  <small>мкг/м³</small>
                </dd>
              </div>
              <div>
                <dt>NO₂</dt>
                <dd>
                  {air?.no2 ?? "—"}
                  <small>мкг/м³</small>
                </dd>
              </div>
            </dl>
            <p className="area-date">{timestamp(air?.time || null)}</p>
            <p>
              Модель CAMS Global, сетка около 45 км. Эти значения не различают
              соседние улицы и не относятся к выбранным датам поездки.
            </p>
            {stale && (
              <p className="area-warning">
                Снимок старше 6 часов. Для текущей оценки требуется обновление.
              </p>
            )}
            {air?.error && (
              <p className="muted">
                Источник не предоставил проверяемую оценку.
              </p>
            )}
            <a href={air?.sourceUrl} target="_blank" rel="noreferrer">
              Open-Meteo / CAMS <ExternalLink size={13} />
            </a>
            <details>
              <summary>Источник и ограничения</summary>
              <p>
                {air?.attribution}.{" "}
                <a href={air?.licenseUrl} target="_blank" rel="noreferrer">
                  Лицензия
                </a>
              </p>
              <p>Получено: {timestamp(air?.fetchedAt || null)}</p>
              <ul>
                {air?.limitations.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </details>
          </article>
          <article className="area-safety">
            <h3>
              <ShieldCheck size={21} />
              Безопасность района
            </h3>
            <span className="area-status">
              {assessment.safety.status === "unknown"
                ? "Не оценена"
                : "Исторические сведения"}
            </span>
            <p className="area-summary">{assessment.safety.summary}</p>
            {assessment.safety.evidence.map((e) => (
              <div className="area-evidence" key={e.id}>
                <strong>{e.geography.name}</strong>
                <p>
                  {e.metricLabel || metricNames[e.metric]}: {e.value} {e.unit}
                </p>
                <p>
                  Период: {e.period.from} — {e.period.to}
                </p>
                <a href={e.sourceUrl} target="_blank" rel="noreferrer">
                  {e.sourcePublisher} <ExternalLink size={13} />
                </a>
                <details>
                  <summary>Как получено значение</summary>
                  <p>{e.methodology}</p>
                  <p>Запись источника: {e.sourceRecord}</p>
                  <p>
                    <a
                      href={e.geography.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Граница территории
                    </a>
                  </p>
                  <ul>
                    {e.limitations.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                </details>
              </div>
            ))}
            <p>
              Общий балл безопасности не рассчитывается. Наличие камер или
              полиции рядом не заменяет статистику происшествий.
            </p>
            <a
              href={assessment.safety.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Источник сведений о безопасности <ExternalLink size={13} />
            </a>
            <details>
              <summary>Ограничения оценки</summary>
              <ul>
                {assessment.safety.limitations.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </details>
          </article>
        </div>
      )}
    </section>
  );
}
