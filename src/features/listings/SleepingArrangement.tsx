import { BedDouble } from "lucide-react";
import type { ListingBed } from "../../../shared/account";
import { bedTypes } from "../../../shared/listingDetails";

export function SleepingArrangement({ beds = [], sleepingPlaces }: {
  beds?: ListingBed[];
  sleepingPlaces?: number | null;
}) {
  return <section className="sleeping-arrangement" aria-label="Спальные места">
    <div className="sleeping-arrangement-heading">
      <h3><BedDouble size={20} aria-hidden="true" /> Спальные места</h3>
      {sleepingPlaces != null && <strong>Всего: {sleepingPlaces}</strong>}
    </div>
    {beds.length ? <>
      <ul>
        {beds.map((bed, index) => <li key={index}>
          <strong>{bedTypes[bed.type]?.label || "Спальное место"} × {bed.count}</strong>
          <span>{bed.type === "crib" ? "Для младенца, отдельно от основных мест" : `${bed.placesPerUnit} ${bed.placesPerUnit === 1 ? "место" : "места"} на каждую`}</span>
          <span>{bed.room?.trim() || "Комната не указана"}</span>
        </li>)}
      </ul>
      {beds.some(bed => bed.placesPerUnit > 1 && bed.type !== "bunk") &&
        <p>Места на одной двуспальной кровати или диване не означают отдельные постели.</p>}
      {beds.some(bed => bed.type === "bunk") &&
        <p>У двухъярусной кровати два яруса. Возрастные ограничения верхнего яруса уточните у отельера.</p>}
    </> : <p>Типы и количество кроватей пока не указаны. Возможность раздельного сна нужно уточнить.</p>}
  </section>;
}
