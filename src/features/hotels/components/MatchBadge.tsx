import type { HotelMatch } from "../../../../shared/types";
export function MatchBadge({ match }: { match: HotelMatch }) {
  const excluded = match.best.status === "excluded";
  const knownMismatch = match.best.capacityEvidenceStatus === "mismatch" ||
    match.best.criteria.some((c) => c.required && c.status === "mismatch" && !c.assumed);
  return (
    <span className={`match-badge ${excluded ? "excluded" : ""}`}>
      {excluded ? knownMismatch ? "Не подходит под фильтры" : "Нужны уточнения" : "Подходит под фильтры"}
    </span>
  );
}
