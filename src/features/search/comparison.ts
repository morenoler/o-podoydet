import type { HotelMatch, RoomRecommendation } from "../../../shared/types";
import { accommodationPath } from "../../shared/lib/accommodation";
import { matchForSelectedPreferences } from "../../shared/lib/matchPresentation";
import { recommendationMatch, type RoomSearchItem } from "./roomResults";

/** Keep identity only: verdicts belong to a particular search, never to a saved choice. */
export interface ComparisonSelection {
  id: string;
  hotelId: string;
  roomId: string;
  name: string;
  hotelName: string;
  path: string;
}

export interface ComparisonEntry {
  selection: ComparisonSelection;
  match?: HotelMatch;
  message?: string;
  outsideResults?: boolean;
}

export function comparisonSelection(item: RoomSearchItem): ComparisonSelection {
  return {
    id: item.id, hotelId: item.hotel.id, roomId: item.room.id,
    name: item.room.name, hotelName: item.hotel.name,
    path: accommodationPath(item.hotel, item.room.id),
  };
}

export function comparisonMatchForRoom(match: HotelMatch, roomId: string): HotelMatch | undefined {
  const room = match.rooms.find((item) => item.room.id === roomId);
  return room ? matchForSelectedPreferences(match, match.preferences || room.criteria.map((c) => ({ feature: c.feature, required: c.required })), room) : undefined;
}

export function currentComparisonEntries(
  selections: ComparisonSelection[],
  candidates: RoomRecommendation[],
  evaluations: { key: string; matches: Record<string, HotelMatch>; errors: Record<string, string> } | null,
  currentKey: string,
  pendingMessage?: string,
): ComparisonEntry[] {
  return selections.map((selection) => {
    if (pendingMessage) return { selection, message: pendingMessage };
    const candidate = candidates.find((item) => item.id === selection.id);
    if (candidate) return { selection, match: recommendationMatch(candidate) };
    const fresh = evaluations?.key === currentKey ? evaluations : null;
    return {
      selection,
      match: fresh?.matches[selection.id],
      outsideResults: true,
      message: fresh?.matches[selection.id] ? undefined : fresh?.errors[selection.id] || "Перепроверяем по новым условиям…",
    };
  });
}
