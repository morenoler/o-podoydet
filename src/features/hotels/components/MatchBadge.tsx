import type { HotelMatch } from "../../../../shared/types";
export function MatchBadge({ match }: { match: HotelMatch }) {
  const excluded = match.best.status === "excluded";
  return (
    <span className={`match-badge ${excluded ? "excluded" : ""}`}>
      {excluded ? "Не подходит под фильтры" : "Подходит под фильтры"}
    </span>
  );
}
