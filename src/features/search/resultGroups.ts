import type { RoomRecommendation } from "../../../shared/types";
import { criterionNeedsClarification } from "../../shared/lib/matchPresentation";
import { locationState } from "../places/locationPresentation";

/** Known conflicts remain visible even when other conditions are still unknown. */
export function hasKnownRoomMismatch(item: RoomRecommendation): boolean {
  return item.room.capacityEvidenceStatus === "mismatch" ||
    item.room.criteria.some((criterion) => criterion.status === "mismatch" && !criterionNeedsClarification(criterion)) ||
    !!item.ownerCriteria?.some((criterion) => criterion.evidenceStatus === "mismatch") ||
    !!item.locationCriteria?.some((criterion) => locationState(criterion) === "mismatch");
}

export function groupRoomAlternatives(items: RoomRecommendation[]) {
  return [
    { id: "clarify", title: "Нужно уточнить", description: "Сведений о категории или условиях пока недостаточно. Это не означает, что номер вам не подойдёт.", items: items.filter((item) => !hasKnownRoomMismatch(item)) },
    { id: "tradeoff", title: "Есть несовпадения с пожеланиями", description: "Эти варианты не выполняют часть пожеланий. Известное несоответствие обязательному условию не допускается в подборку.", items: items.filter(hasKnownRoomMismatch) },
  ].filter((group) => group.items.length > 0);
}
