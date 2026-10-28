import type { RoomRecommendation, SearchResult, Trip } from "../../../shared/types";
import { uiAdmissionMode } from "./searchPolicy";

function hasKnownBlocker(item: RoomRecommendation) {
  return item.room.capacityEvidenceStatus === "mismatch"
    || item.room.criteria.some(criterion => criterion.required && ["mismatch", "conflict"].includes(criterion.evidenceStatus ?? criterion.status))
    || item.ownerCriteria?.some(criterion => criterion.required && criterion.evidenceStatus === "mismatch")
    || item.locationCriteria?.some(criterion => criterion.required && criterion.evidenceStatus === "mismatch");
}

/** One stream of eligible categories; map-only hotels and known exclusions never become room cards. */
export function resultFeed(result: SearchResult, admissionMode: Trip["admissionMode"]): RoomRecommendation[] {
  const explore = uiAdmissionMode(admissionMode) === "explore";
  const candidates = [...result.roomRecommendations, ...(explore ? result.roomAlternatives.filter(item => item.room.provisional) : [])];
  return [...new Map(candidates.filter(item => item.room.status !== "excluded" && !hasKnownBlocker(item) && (explore || !item.room.provisional))
    .map(item => [item.id, item])).values()];
}
