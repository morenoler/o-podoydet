import type { RoomMatch } from "../../../../shared/types";
export function CapacitySummary({ match }: { match: RoomMatch }) {
  return (
    <div
      className={`capacity-summary ${match.capacityStatus === "mismatch" ? "capacity-mismatch" : ""}`}
    >
      {match.capacityAssumed && (
        <span className="assumption-label">Вместимость не подтверждена</span>
      )}
      <p>
        {match.capacityStatus === "mismatch" && !match.capacityAssumed && (
          <strong>Не вмещает всех гостей. </strong>
        )}
        {match.capacityRule
          ? `По опубликованному правилу: до ${match.capacityRule.maxGuests} гостей при указанных условиях.`
          : match.room.capacity !== null
            ? `Вместимость категории: до ${match.room.capacity} гостей.`
            : null}
        {match.capacityExplanation && <> {match.capacityExplanation}</>}
      </p>
    </div>
  );
}
