import type { RoomMatch } from "../../../../shared/types";
import { capacityNeedsClarification } from "../../../shared/lib/matchPresentation";
export function CapacitySummary({ match }: { match: RoomMatch }) {
  const unconfirmed = capacityNeedsClarification(match);
  return (
    <div
      className={`capacity-summary ${match.capacityStatus === "mismatch" && !unconfirmed ? "capacity-mismatch" : ""}`}
    >
      {unconfirmed && (
        <span className="assumption-label">Вместимость не подтверждена</span>
      )}
      {!unconfirmed && match.capacitySource === "owner" && (
        <span className="criterion-reported-source">
          Вместимость по объявлению
        </span>
      )}
      <p>
        {match.capacityStatus === "mismatch" && !unconfirmed && (
          <strong>Не вмещает всех гостей. </strong>
        )}
        {match.capacityRule
          ? `По опубликованному правилу: до ${match.capacityRule.maxGuests} гостей при указанных условиях.`
          : match.room.capacity !== null
            ? `${match.capacitySource === "owner" ? "По сведениям отельера" : "Вместимость категории"}: до ${match.room.capacity} гостей.`
            : null}
        {match.capacityExplanation && <> {match.capacityExplanation}</>}
      </p>
    </div>
  );
}
