import type { Trip } from "../../../../shared/types";
import { Link } from "react-router-dom";
import { Footprints, CircleHelp } from "lucide-react";
import { dateFull } from "../../../shared/lib/date";
import { accountListingId } from "../../../shared/lib/accommodation";
import { Modal } from "../../../shared/ui/Modal";
import { Notice } from "../../../shared/ui/Feedback";
import { features } from "../../../../shared/features";
import { canSearch } from "../../search/searchTrip";
import type { ComparisonEntry } from "../../search/comparison";
import { LocationCriteria } from "../../places/LocationCriteria";
import { MatchBadge } from "./MatchBadge";
import { CapacitySummary } from "./CapacitySummary";
import { CriterionLine } from "./CriterionLine";
import { OwnerCriteriaSummary } from "./OwnerCriteriaSummary";
import { PersonalWishesSummary } from "./PersonalWishesSummary";
import { price } from "../../account/format";

export function CompareDialog({ entries, trip, onClose, onRemove }: {
  entries: ComparisonEntry[];
  trip: Trip;
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  const ids = [...new Set(entries.flatMap((entry) => entry.match?.best.criteria.map((criterion) => criterion.feature) || []))];
  return (
    <Modal open onClose={onClose} title="Сравните важное для вашей поездки" className="compare-dialog room-comparison-dialog">
      <p className="room-comparison-intro">
        {canSearch(trip) ? `${dateFull(trip.checkIn)} — ${dateFull(trip.checkOut)} ` : ""}
        Каждый столбец относится к одной категории номера. Неизвестное условие требует уточнения.
      </p>
      <div className="room-comparison-scroll" tabIndex={0} role="region" aria-label="Сравнение номеров; на узком экране прокрутите по горизонтали">
        <div className="comparison-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, entries.length)}, minmax(245px, 1fr))` }}>
          {entries.map(({ selection, match, message, outsideResults }) => (
            <section key={selection.id} className="room-comparison-column">
              <div className="room-comparison-identity">
                <h3>{match?.best.room.name || selection.name}</h3>
                <p>{match?.hotel.name || selection.hotelName}</p>
                <button type="button" className="text-link" onClick={() => onRemove(selection.id)} aria-label={`Убрать из сравнения ${selection.name}, ${selection.hotelName}`}>Убрать</button>
              </div>
              {match ? <>
                <MatchBadge match={match} />
                {outsideResults && <p className="room-comparison-caution">Не входит в текущую подборку. Ниже показана отдельная проверка по новым условиям.</p>}
                {accountListingId(match.hotel) && <p className="hotel-owner-source">Сведения отельера; независимая проверка не проведена.</p>}
                {match.hotel.synthetic && <p className="room-comparison-caution">Вымышленный демонстрационный объект.</p>}
                <div className="room-comparison-price">
                  <strong>{accountListingId(match.hotel) && match.hotel.currency === "KRW" && typeof match.hotel.pricePerNight === "number" && match.hotel.pricePerNight > 0 ? `${price(match.hotel.pricePerNight)} / ночь` : "Цена не указана"}</strong>
                  <small>{accountListingId(match.hotel) && typeof match.hotel.pricePerNight === "number" && match.hotel.pricePerNight > 0 ? "По цене объявления. Полную стоимость и наличие уточняйте." : "Стоимость и наличие на ваши даты нужно уточнить."}</small>
                </div>
                <CapacitySummary match={match.best} />
                <div className="comparison-distance"><Footprints size={18} aria-hidden="true" />
                  {!match.hotel.synthetic && match.hotel.route ? `${match.hotel.route.meters} м пешком до пляжа` : "Маршрут до пляжа не рассчитан"}
                </div>
                {ids.map((id) => {
                  const criterion = match.best.criteria.find((item) => item.feature === id);
                  return criterion ? <CriterionLine key={id} criterion={criterion} detailed />
                    : <p key={id} className="room-comparison-missing"><CircleHelp size={16} aria-hidden="true" />{features[id].label}: нет сведений</p>;
                })}
                <OwnerCriteriaSummary criteria={match.ownerCriteria} detailed />
                <LocationCriteria criteria={match.locationCriteria} detailed />
                <PersonalWishesSummary match={match} />
              </> : <p className="room-comparison-pending" role="status"><CircleHelp size={19} aria-hidden="true" />{message || "Оценка ещё не получена."}</p>}
              <Link to={selection.path} className="button secondary" onClick={onClose}>Посмотреть номер</Link>
            </section>
          ))}
        </div>
      </div>
      <Notice>Цена и наличие на даты не проверены. Сведения о категории не гарантируют условия конкретной физической комнаты.</Notice>
    </Modal>
  );
}
