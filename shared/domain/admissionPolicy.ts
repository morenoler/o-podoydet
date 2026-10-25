import type { CriterionDecision, RoomMatch, Trip } from "../types";

/** Admission is separate from evidence: exploration never rewrites a fact. */
export function permitsAdmission(status: string | undefined, evidenceStatus: string | undefined, trip: Trip): boolean {
  if (evidenceStatus === "conflict") return false;
  return status === "match" || (trip.admissionMode === "explore" &&
    (evidenceStatus === "unknown" || evidenceStatus === "stale"));
}

export function decideAdmission(
  capacity: Pick<RoomMatch, "capacityStatus" | "capacityEvidenceStatus">,
  criteria: Pick<CriterionDecision, "required" | "status" | "evidenceStatus">[],
  trip: Trip,
): Pick<RoomMatch, "status" | "provisional"> {
  const mandatory = criteria.filter(c => c.required);
  const fits = permitsAdmission(capacity.capacityStatus, capacity.capacityEvidenceStatus, trip) &&
    mandatory.every(c => permitsAdmission(c.status, c.evidenceStatus, trip));
  return { status: fits ? "fits" : "excluded", provisional: fits &&
    (capacity.capacityStatus !== "match" || mandatory.some(c => c.status !== "match")) };
}
