import type { CriterionDecision, HotelMatch, RoomMatch } from "../../../shared/types";

/** Binary admission and the state of the evidence are different UI concepts. */
export function criterionNeedsClarification(criterion: CriterionDecision) {
  return criterion.assumed ||
    (criterion.evidenceStatus !== "match" && criterion.evidenceStatus !== "mismatch");
}

export function criterionMatches(criterion: CriterionDecision) {
  return criterion.status === "match" && !criterionNeedsClarification(criterion);
}

export function capacityNeedsClarification(match: RoomMatch) {
  return match.capacityAssumed || match.capacityEvidenceStatus === "unknown" ||
    (match.capacityStatus === "mismatch" && match.capacityEvidenceStatus !== "mismatch");
}

export function hasKnownRequiredMismatch(match: HotelMatch) {
  return match.best.capacityEvidenceStatus === "mismatch" ||
    match.best.criteria.some((c) => c.required && c.status === "mismatch" && !criterionNeedsClarification(c)) ||
    !!match.ownerCriteria?.some((c) => c.required && c.evidenceStatus === "mismatch");
}

export function matchLabel(match: HotelMatch) {
  if (match.best.status === "excluded")
    return hasKnownRequiredMismatch(match) ? "Не подходит под фильтры" : "Нужны уточнения";
  if (match.best.provisional) return "Вариант для уточнения";
  if (capacityNeedsClarification(match.best) ||
      match.best.criteria.some(criterionNeedsClarification) ||
      match.ownerCriteria?.some((c) => c.evidenceStatus === "unknown"))
    return "Есть условия для уточнения";
  if (match.best.criteria.some((c) => c.status === "mismatch") ||
      match.ownerCriteria?.some((c) => c.evidenceStatus === "mismatch"))
    return "Есть несовпадения с пожеланиями";
  return match.ownerCriteria?.some((c) => c.assumed)
    ? "Подходит по сведениям отельера" : "Подходит под фильтры";
}

export function matchPresentationState(match: HotelMatch): "match" | "unknown" | "mismatch" {
  if (hasKnownRequiredMismatch(match)) return "mismatch";
  if (match.best.status === "excluded" || match.best.provisional || capacityNeedsClarification(match.best) ||
      match.best.criteria.some(criterionNeedsClarification) ||
      match.ownerCriteria?.some((c) => c.evidenceStatus === "unknown")) return "unknown";
  return match.best.criteria.some((c) => c.status === "mismatch") ||
    match.ownerCriteria?.some((c) => c.evidenceStatus === "mismatch") ? "mismatch" : "match";
}
