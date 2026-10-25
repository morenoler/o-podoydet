import type {
  CriterionDecision,
  HotelMatch,
  RoomMatch,
  Preference,
} from "../../../shared/types";

/** A detail evaluation may include reference-only conditions that the traveler never selected. */
export function matchForSelectedPreferences(
  match: HotelMatch,
  preferences: Preference[],
  room = match.best,
): HotelMatch {
  const selected = new Set(preferences.map((preference) => preference.feature));
  return {
    ...match,
    best: {
      ...room,
      criteria: room.criteria.filter((criterion) =>
        selected.has(criterion.feature),
      ),
    },
  };
}

/** Binary admission and the state of the evidence are different UI concepts. */
export function criterionNeedsClarification(criterion: CriterionDecision) {
  const knownOwnerStatement =
    (criterion.feature === "family" ||
      criterion.feature === "courtyard" ||
      criterion.feature === "step_free_access") &&
    (criterion.evidenceStatus === "match" ||
      criterion.evidenceStatus === "mismatch") &&
    !!criterion.reportedEvidence?.some(
      (evidence) =>
        evidence.method === "owner_response" &&
        evidence.provenanceStatus === "reported" &&
        evidence.feature === criterion.feature &&
        evidence.scope === "listing_unit" &&
        evidence.evidenceStatus === criterion.evidenceStatus,
    );
  return (
    (criterion.assumed && !knownOwnerStatement) ||
    (criterion.evidenceStatus !== "match" &&
      criterion.evidenceStatus !== "mismatch")
  );
}

export function criterionMatches(criterion: CriterionDecision) {
  return (
    criterion.status === "match" && !criterionNeedsClarification(criterion)
  );
}

export function capacityNeedsClarification(match: RoomMatch) {
  if (
    match.capacitySource === "owner" &&
    (match.capacityEvidenceStatus === "match" ||
      match.capacityEvidenceStatus === "mismatch")
  )
    return false;
  return (
    match.capacityAssumed ||
    match.capacityEvidenceStatus === "unknown" ||
    (match.capacityStatus === "mismatch" &&
      match.capacityEvidenceStatus !== "mismatch")
  );
}

export function hasKnownRequiredMismatch(match: HotelMatch) {
  return (
    match.best.capacityEvidenceStatus === "mismatch" ||
    match.best.criteria.some(
      (c) =>
        c.required &&
        c.status === "mismatch" &&
        !criterionNeedsClarification(c),
    ) ||
    !!match.ownerCriteria?.some(
      (c) => c.required && c.evidenceStatus === "mismatch",
    )
  );
}

export function matchLabel(match: HotelMatch) {
  if (match.best.status === "excluded")
    return hasKnownRequiredMismatch(match)
      ? "Не подходит под фильтры"
      : "Нужны уточнения";
  if (match.best.provisional) return "Вариант для уточнения";
  if (
    capacityNeedsClarification(match.best) ||
    match.best.criteria.some(criterionNeedsClarification) ||
    match.ownerCriteria?.some((c) => c.evidenceStatus === "unknown")
  )
    return "Есть условия для уточнения";
  if (
    match.best.criteria.some((c) => c.status === "mismatch") ||
    match.ownerCriteria?.some((c) => c.evidenceStatus === "mismatch")
  )
    return "Есть несовпадения с пожеланиями";
  return match.best.capacitySource === "owner" ||
    match.ownerCriteria?.some((c) => c.assumed) ||
    match.best.criteria.some(
      (criterion) => !!criterion.reportedEvidence?.length,
    )
    ? "Подходит по сведениям отельера"
    : "Подходит под фильтры";
}

export function matchPresentationState(
  match: HotelMatch,
): "match" | "unknown" | "mismatch" {
  if (hasKnownRequiredMismatch(match)) return "mismatch";
  if (
    match.best.status === "excluded" ||
    match.best.provisional ||
    capacityNeedsClarification(match.best) ||
    match.best.criteria.some(criterionNeedsClarification) ||
    match.ownerCriteria?.some((c) => c.evidenceStatus === "unknown")
  )
    return "unknown";
  return match.best.criteria.some((c) => c.status === "mismatch") ||
    match.ownerCriteria?.some((c) => c.evidenceStatus === "mismatch")
    ? "mismatch"
    : "match";
}
