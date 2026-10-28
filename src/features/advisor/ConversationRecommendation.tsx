import { Link } from "react-router-dom";
import type { RoomRecommendation, Trip } from "../../../shared/types";
import { accommodationPath } from "../../shared/lib/accommodation";
import { capacityNeedsClarification, matchLabel } from "../../shared/lib/matchPresentation";
import { LocationCriteria } from "../places/LocationCriteria";
import { recommendationMatch } from "../search/roomResults";

export function ConversationRecommendation({ recommendation, pendingLocationQuery }: {
  recommendation: RoomRecommendation;
  pendingLocationQuery?: Trip["pendingLocationQuery"];
}) {
  const capacityUnknown = capacityNeedsClarification(recommendation.room);
  const capacity = recommendation.room.capacityRule?.maxGuests ?? recommendation.room.room.capacity;
  return <section className="conversation-room-recommendation" aria-label="Предложенный номер">
    <p>{pendingLocationQuery ? "По ранее выбранным условиям; новое пожелание нужно уточнить" : matchLabel(recommendationMatch(recommendation))}</p>
    <Link to={accommodationPath(recommendation.hotel, recommendation.room.room.id)}>{recommendation.room.room.name}</Link>
    <span>{recommendation.hotel.name}{capacityUnknown || capacity == null ? " · вместимость нужно уточнить" : ` · до ${capacity} гостей${recommendation.room.capacityRule ? " по правилу размещения" : ""}`}</span>
    <small>{recommendation.source === "owner" ? "По сведениям отельера" : recommendation.source === "demo" ? "Вымышленный тестовый номер" : "По проверенным данным категории"}. Наличие на даты нужно уточнить.</small>
    <LocationCriteria criteria={recommendation.locationCriteria} />
  </section>;
}
