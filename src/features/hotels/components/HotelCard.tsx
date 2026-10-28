import type { Dataset, Hotel, HotelFilters, HotelMatch, Room, RoomRecommendation } from "../../../../shared/types";
import { Link } from "react-router-dom";
import { Check, CircleHelp, X } from "lucide-react";
import { accommodationPath, accountListingId } from "../../../shared/lib/accommodation";
import { AccommodationPhoto } from "../../../shared/ui/AccommodationPhoto";
import { FavoriteButton } from "../../favorites/FavoriteButton";
import { PersonalWishesSummary } from "./PersonalWishesSummary";
import { HotelRating, HotelStars } from "./HotelReputation";
import { accommodationPrice } from "../presentationPrice";
import { features } from "../../../../shared/features";
import { directionLabels, price } from "../../account/format";
import { recommendationMatch } from "../../search/roomResults";
import { capacityNeedsClarification, criterionNeedsClarification, hasKnownOwnerAmenity, matchLabel, matchPresentationState } from "../../../shared/lib/matchPresentation";

export function HotelCard({ match: hotelMatch, roomRecommendation, previewRoom, alternative = false, hotel: previewHotel, selected = false, onSelect }: {
  hotelFilters?: HotelFilters;
  match?: HotelMatch;
  roomRecommendation?: RoomRecommendation;
  previewRoom?: Room;
  alternative?: boolean;
  hotel?: Hotel;
  dataset?: Dataset | null;
  selected?: boolean;
  onSelect?: () => void;
  onShowMap?: () => void;
}) {
  const match = roomRecommendation ? recommendationMatch(roomRecommendation) : hotelMatch;
  const hotel = match?.hotel || previewHotel;
  if (!hotel) return null;
  const room = roomRecommendation?.room.room || previewRoom;
  const title = room?.name || hotel.name;
  const titleWithHotel = room ? `${title}, ${hotel.name}` : title;
  const ownerId = accountListingId(hotel);
  const detailsPath = accommodationPath(hotel, room?.id || match?.best.room.id);
  const capacityUnknown = match && capacityNeedsClarification(match.best);
  const capacity = match?.best.capacityRule?.maxGuests ?? room?.capacity;
  const hasConditions = !!(match?.best.criteria.length || match?.ownerCriteria?.length || match?.locationCriteria?.length);
  const presentationState = match ? matchPresentationState(match) : "unknown";
  const category = match?.best.room.evidenceStatus === "verified" && match.best.room.scope === "room_category" ? match.best.room : undefined;
  const publishedCategoryCount = hotel.rooms.filter(item => item.scope === "room_category" && item.evidenceStatus === "verified").length;
  const sourceHint = hotel.synthetic || room?.demo ? "Демонстрационные данные · вымышленное объявление"
    : ownerId ? "Сведения отельера · без независимой проверки"
      : publishedCategoryCount ? `Категории с официального сайта: ${publishedCategoryCount}` : "Категорию и условия номера нужно уточнить";
  const offer = accommodationPrice(hotel, room ?? match?.best.room);
  const resultLabel = match?.best.provisional ? "Вариант для уточнения"
    : alternative ? "Не все условия подтверждены"
      : match ? roomRecommendation && !hasConditions && presentationState === "match" ? "Подходит по вместимости" : matchLabel(match) : "Категория номера из каталога";
  const criteria = (match?.best.criteria || []).slice(0, 2);
  const ownerCriteria = (match?.ownerCriteria || []).slice(0, Math.max(0, 2 - criteria.length));
  return <article className={`search-hotel-card${selected ? " is-selected" : ""}`} onClick={onSelect} onFocus={onSelect} aria-label={titleWithHotel}>
    <div className="search-hotel-photo">
      <Link to={detailsPath} tabIndex={-1} aria-hidden="true">
        <AccommodationPhoto name={`Фото ${ownerId ? "объявления" : "отеля"} ${hotel.name}`} hotelId={hotel.id} photos={hotel.photos} />
      </Link>
      <FavoriteButton item={{ id: ownerId ? `listing:${ownerId}` : room ? `${hotel.id}::${room.id}` : hotel.id, name: titleWithHotel, path: detailsPath, hotelId: hotel.id, photos: hotel.photos, address: hotel.address }} />
    </div>
    <div className="search-hotel-content">
      <div className="search-card-stars"><HotelStars hotelId={hotel.id} /></div>
      <div className="search-card-rating"><HotelRating hotelId={hotel.id} compact /></div>
      <div className="search-hotel-heading"><Link to={detailsPath}><h2>{hotel.name}{hotel.synthetic && <span className="search-demo-label">ДЕМО</span>}</h2></Link></div>
      {room && <p className="search-room-hotel">{title}</p>}
      <p className="search-hotel-meta">{hotel.address || "Адрес не указан"}</p>
      {!!(criteria.length + ownerCriteria.length) && <ul className="search-hotel-quick-criteria" aria-label="Основные условия">
        {criteria.map(criterion => {
          const unknown = criterionNeedsClarification(criterion), fits = criterion.status === "match";
          const Icon = unknown ? CircleHelp : fits ? Check : X;
          return <li key={criterion.feature} className={unknown ? "is-uncertain" : fits ? "is-match" : "is-mismatch"}><Icon size={12} aria-hidden="true" />{features[criterion.feature].label}: {unknown ? "нужно уточнить" : fits ? hasKnownOwnerAmenity(criterion) || !!criterion.reportedEvidence?.length ? "со слов отельера" : "есть подтверждение" : "не совпадает"}</li>;
        })}
        {ownerCriteria.map(criterion => <li key={criterion.id} className={criterion.evidenceStatus === "unknown" ? "is-uncertain" : criterion.status === "match" ? "is-match" : "is-mismatch"}>{criterion.label}: {criterion.evidenceStatus === "unknown" ? "нет данных" : criterion.status === "match" ? "по сведениям отельера" : "не совпадает"}</li>)}
      </ul>}
      {match && (match.best.provisional || presentationState !== "match" || alternative) && <p className={`search-card-admission is-${presentationState}`}>{resultLabel}</p>}
      <div className="sr-only">
        <p>{sourceHint}</p>
        {room && <p>{capacityUnknown || capacity == null ? "Вместимость нужно уточнить" : `Вместимость: до ${capacity} гостей${match?.best.capacityRule ? " по правилу размещения" : ""}`}</p>}
        {category && !room && <p>Категория: {category.name}{!capacityUnknown && !category.capacityMayVary && category.capacity != null ? ` · до ${category.capacity} гостей` : ""}</p>}
        {hotel.floor != null && <p>Этаж: {hotel.floor}</p>}
        {!!hotel.windowDirections?.length && <p>Окна: {hotel.windowDirections.map(value => directionLabels[value]).join(", ")}</p>}
        <span className={`search-hotel-result${!match ? " is-preview" : ""}`}>{resultLabel}</span>
        <span>{offer ? "Наличие и итоговую стоимость уточняйте" : "Цена и наличие не проверены"}</span>
      </div>
      <div className="search-hotel-bottom"><strong className="search-hotel-price">{offer ? <>{price(offer.amount, offer.currency)} <small>/ ночь</small></> : "Цена по запросу"}</strong></div>
    </div>
    {match && <PersonalWishesSummary match={match} />}
  </article>;
}
