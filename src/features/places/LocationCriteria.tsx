import { Check, CircleHelp, MapPin, X } from "lucide-react";
import type { LocationCriterion } from "../../../shared/types";
import { locationDistance, locationState } from "./locationPresentation";

export function LocationCriteria({ criteria, detailed = false }: {
  criteria?: LocationCriterion[];
  detailed?: boolean;
}) {
  if (!criteria?.length) return null;
  return (
    <section className={`location-criteria${detailed ? " is-detailed" : ""}`} aria-label="Расположение по вашим пожеланиям">
      <h3><MapPin size={18} aria-hidden="true" />Расположение по вашим пожеланиям</h3>
      <ul className="location-criteria-list">
        {criteria.map((criterion) => {
          const state = locationState(criterion);
          const Icon = state === "match" ? Check : state === "mismatch" ? X : CircleHelp;
          return (
            <li key={criterion.id} className={`location-criterion is-${state}`}>
              <div className="location-criterion-heading">
                <Icon size={17} aria-hidden="true" />
                <div>
                  <strong>{criterion.label || criterion.query}</strong>
                  <span>{state === "match" ? "Совпадает по картографическим данным" : state === "mismatch" ? "Не совпадает с пожеланием" : "Недостаточно данных"}{criterion.required ? " · обязательно" : ""}</span>
                </div>
              </div>
              <p>{criterion.explanation}</p>
              {!!criterion.places?.length && (
                <ul className="location-place-list">
                  {criterion.places.map((place) => (
                    <li key={place.id}>
                      <a href={place.sourceUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{place.name}</a>
                      <span>{locationDistance(place.meters)} по прямой</span>
                    </li>
                  ))}
                </ul>
              )}
              {detailed && (
                <div className="location-criterion-evidence">
                  {!!criterion.assumptions?.length && <ul>{criterion.assumptions.map((text, index) => <li key={index}>{text}</li>)}</ul>}
                  {criterion.obtainedAt && <p>Данные получены: {new Date(criterion.obtainedAt).toLocaleDateString("ru-RU", { timeZone: "Asia/Seoul" })}{criterion.sourceDate ? ` · дата источника: ${new Date(criterion.sourceDate).toLocaleDateString("ru-RU", { timeZone: "Asia/Seoul" })}` : " · дата исходных данных не указана"}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="location-criteria-note">Расстояния рассчитаны от здания, не от конкретного окна. Это не пешеходный маршрут; время работы мест нужно уточнить.</p>
    </section>
  );
}
