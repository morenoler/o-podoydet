import type { HotelMatch } from "../../../../shared/types";
import { matchLabel, matchPresentationState } from "../../../shared/lib/matchPresentation";
export function MatchBadge({ match }: { match: HotelMatch }) {
  const state = matchPresentationState(match);
  return (
    <span className={`match-badge ${state === "mismatch" ? "excluded" : state === "unknown" ? "unknown" : ""}`}>
      {matchLabel(match)}
    </span>
  );
}
