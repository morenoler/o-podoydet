import type { HotelMatch, PersonalWishes } from "../../../shared/types";
import { features } from "../../../shared/features";
import { locationState } from "../../features/places/locationPresentation";

export type PersonalWishState = "match" | "reported" | "unknown" | "mismatch" | "excluded";
export interface PersonalWishItem {
  id: string;
  label: string;
  state: PersonalWishState;
}

export function personalWishItems(match: HotelMatch): PersonalWishItem[] {
  const wishes = match.personalWishes;
  const locationItems: PersonalWishItem[] = (match.locationCriteria || []).map((criterion) => ({
    id: `location:${criterion.id}`, label: criterion.label || criterion.query, state: locationState(criterion),
  }));
  if (!wishes || wishes.status !== "recognized") return locationItems;
  const items: PersonalWishItem[] = [...new Set(wishes.features)].map((feature) => {
    // Only this room can satisfy this request. Other rooms are not evidence.
    const criterion = match.best.criteria.find((item) => item.feature === feature);
    const evidence = criterion?.evidenceStatus ?? criterion?.status;
    const state: PersonalWishState = evidence === "mismatch" ? "mismatch"
      : evidence !== "match" || criterion?.status !== "match" ? "unknown"
        : criterion.reportedEvidence?.length || criterion.facts.some((fact) => fact.method === "host")
          ? "reported" : criterion.assumed ? "unknown" : "match";
    return { id: feature, label: features[feature].label, state };
  });
  for (const request of wishes.ownerCriteria) {
    const criterion = match.ownerCriteria?.find((item) => item.id === request.id);
    const state = criterion?.evidenceStatus === "mismatch" ? "mismatch"
      : criterion?.evidenceStatus === "match" && criterion.status === "match" ? "reported" : "unknown";
    items.push({ id: request.id, label: request.label, state });
  }
  for (const feature of new Set(wishes.excludedFeatures)) {
    items.push({ id: `excluded:${feature}`, label: features[feature].label, state: "excluded" });
  }
  return [...items, ...locationItems];
}

export function personalWishSummary(match: HotelMatch) {
  const status = match.personalWishes?.status;
  if ((!status || status === "not_requested") && !match.locationCriteria?.length) return null;
  const items = personalWishItems(match);
  if (status === "unrecognized" && !match.locationCriteria?.length) return {
    tone: "unknown", title: "Личные пожелания не учтены", items,
    note: "В тексте ничего не распознано. Уточните пожелание или выберите готовые условия.",
  };
  const mismatch = items.some((item) => item.state === "mismatch");
  const unknown = !items.length || items.some((item) => item.state === "unknown");
  const reported = items.some((item) => item.state === "reported");
  const onlySettings = items.length > 0 && items.every((item) => item.state === "excluded");
  return {
    tone: mismatch ? "mismatch" : unknown ? "unknown" : reported || onlySettings ? "reported" : "match",
    title: mismatch ? "Есть несоответствия личным пожеланиям"
      : unknown ? "Личные пожелания требуют уточнения"
        : reported ? "Пожелания учтены по сведениям отельера"
          : onlySettings ? "В тексте распознана отмена условий" : "Распознанные пожелания учтены",
    items,
    note: "Проверены только распознанные условия. Остальной текст не проверен.",
  };
}

export function personalWishNotice(wishes?: PersonalWishes, hasText = false) {
  if (wishes?.status === "not_requested" || (!wishes && !hasText)) return null;
  if (!wishes) return {
    title: "Личное пожелание ещё не проверено",
    message: "Обновите подбор, чтобы проверить пожелание вместе с текущими условиями поездки.",
  };
  if (wishes.status === "unrecognized") return {
    title: "В личном пожелании ничего не распознано",
    message: "Напишите конкретнее, например: «Не выше 3 этажа. Окна на восток». Сейчас поиск учитывает даты, гостей и выбранные условия, но не этот текст.",
  };
  const labels = [...wishes.features.map((feature) => features[feature].label), ...wishes.ownerCriteria.map((item) => item.label)];
  const excluded = wishes.excludedFeatures.map((feature) => features[feature].label);
  return {
    title: "Из текста распознаны отдельные условия",
    message: [labels.length ? `Проверяем: ${labels.join("; ")}.` : "",
      excluded.length ? `В тексте отменено: ${excluded.join("; ")}. Проверьте, нет ли противоречий с фильтрами.` : "",
      "Остальной текст не проверен. Результат для каждого варианта указан внизу карточки."].filter(Boolean).join(" "),
  };
}
