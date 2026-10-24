import type { RoomMatch } from "../../../../shared/types";
export function CapacitySummary({ match }: { match: RoomMatch }) {
  return (
    <div
      className={`capacity-summary ${match.capacityStatus === "mismatch" ? "capacity-mismatch" : ""}`}
    >
      {match.capacityAssumed && (
        <span className="assumption-label">Предположение</span>
      )}
      <p>
        {match.capacityStatus === "mismatch" && (
          <strong>Не вмещает всех гостей. </strong>
        )}
        {match.capacityAssumed && typeof match.estimatedCapacity === "number"
          ? `Расчётная вместимость: до ${match.estimatedCapacity} гостей.`
          : match.room.capacity !== null
            ? `Вместимость категории: до ${match.room.capacity} гостей.`
            : null}
        {match.capacityExplanation && <> {match.capacityExplanation}</>}
      </p>
    </div>
  );
}
