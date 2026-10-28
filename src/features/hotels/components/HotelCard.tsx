import type { Dataset, Hotel, HotelFilters, HotelMatch, Room, RoomRecommendation } from "../../../../shared/types";
import { nearbyMatches } from "../../../../shared/nearby";
import { validListingCoordinates } from "../../../../shared/listingDetails";
import { ReviewHighlights } from "../../listings/ReviewHighlights";
import { NearbySummary } from "./NearbySummary";
import { Link } from "react-router-dom";
import {
  Check,
  CircleHelp,
  GitCompareArrows,
  MapPin,
  Waves,
  X,
} from "lucide-react";
import {
  accommodationPath,
  accountListingId,
} from "../../../shared/lib/accommodation";
import { AccommodationPhoto } from "../../../shared/ui/AccommodationPhoto";
import { FavoriteButton } from "../../favorites/FavoriteButton";
import { PersonalWishesSummary } from "./PersonalWishesSummary";
import { LocationCriteria } from "../../places/LocationCriteria";
import { CriterionLine } from "./CriterionLine";
import { locationState } from "../../places/locationPresentation";
import { features } from "../../../../shared/features";
import { directionLabels } from "../../account/format";
import { dateFull } from "../../../shared/lib/date";
import { recommendationMatch } from "../../search/roomResults";
import {
  capacityNeedsClarification,
  criterionNeedsClarification,
  hasKnownOwnerAmenity,
  matchLabel,
  matchPresentationState,
} from "../../../shared/lib/matchPresentation";

export function HotelCard({
  hotelFilters,
  match: hotelMatch,
  roomRecommendation,
  previewRoom,
  alternative = false,
  hotel: previewHotel,
  compared = false,
  onCompare,
  compareDisabled = false,
  selected = false,
  onSelect,
  onShowMap,
}: {
  hotelFilters?: HotelFilters;
  match?: HotelMatch;
  roomRecommendation?: RoomRecommendation;
  previewRoom?: Room;
  alternative?: boolean;
  hotel?: Hotel;
  dataset?: Dataset | null;
  compared?: boolean;
  onCompare?: () => void;
  compareDisabled?: boolean;
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
  const needsClarification = capacityUnknown ||
    match?.best.criteria.some(criterionNeedsClarification) ||
    match?.ownerCriteria?.some((c) => c.evidenceStatus === "unknown") ||
    match?.locationCriteria?.some((c) => locationState(c) === "unknown");
  const declared = match?.ownerCriteria?.some((c) => c.assumed);
  const estimated = needsClarification || declared || match?.best.provisional;
  const uncertain = match?.best.criteria.find(
    (c) => criterionNeedsClarification(c) || c.status !== "match",
  );
  const missingOwner = match?.ownerCriteria?.find(
    (c) => c.assumed || c.evidenceStatus !== "match",
  );
  const publishedCategoryCount = hotel.rooms.filter(
    (room) => room.scope === "room_category" && room.evidenceStatus === "verified",
  ).length;
  const sourceHint = hotel.synthetic || room?.demo
    ? "Демонстрационные данные · вымышленное объявление"
    : ownerId
    ? "Сведения отельера · без независимой проверки"
    : match?.best.room.evidenceStatus === "verified" && match.best.room.scope === "room_category"
      ? "Категория по сведениям официального сайта"
      : !match && publishedCategoryCount > 0
        ? `Категории с официального сайта: ${publishedCategoryCount}`
        : "Категорию и условия номера нужно уточнить";
  const category = match?.best.room.evidenceStatus === "verified" && match.best.room.scope === "room_category" ? match.best.room : undefined;
  const roomDetails = [
    hotel.floor == null ? "" : `Этаж: ${hotel.floor}`,
    hotel.windowDirections?.length
      ? `Окна: ${hotel.windowDirections.map((value) => directionLabels[value]).join(", ")}` : "",
  ].filter(Boolean).join(" · ");
  const hasPrice =
    typeof hotel.pricePerNight === "number" &&
    hotel.pricePerNight > 0 &&
    (hotel.currency === "KRW" || hotel.currency === "RUB");
  const resultLabel = match ? matchLabel(match) : "Условия и источники";
  const hasConditions = !!(match?.best.criteria.length || match?.ownerCriteria?.length);
  const presentationState = match ? matchPresentationState(match) : "unknown";
  const conditionCount = (match?.best.criteria.length || 0) + (match?.ownerCriteria?.length || 0) + (match?.locationCriteria?.length || 0);
  return (
    <article
      className={`search-hotel-card${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      onFocus={onSelect}
      aria-label={titleWithHotel}
    >
      <div className="search-hotel-photo">
        <Link to={detailsPath} tabIndex={-1} aria-hidden="true">
          <AccommodationPhoto
            name={hotel.name}
            hotelId={hotel.id}
            photos={hotel.photos}
          />
        </Link>
        {room && <span className="search-room-photo-note">{ownerId ? "Фото объявления" : "Фото отеля"}</span>}
        <FavoriteButton
          item={{
            id: ownerId ? `listing:${ownerId}` : room ? `${hotel.id}::${room.id}` : hotel.id,
            name: titleWithHotel,
            path: detailsPath,
            hotelId: hotel.id,
            photos: hotel.photos,
            address: hotel.address,
          }}
        />
      </div>
      <div className="search-hotel-content">
        <div className="search-hotel-heading">
          <Link to={detailsPath}>
            <h2>
              {hotel.name}
              {hotel.synthetic && (
                <span className="search-demo-label">ДЕМО</span>
              )}
            </h2>
          </Link>
          {onCompare && (
            <button
              type="button"
              className={`search-compare-toggle${compared ? " is-selected" : ""}`}
              aria-pressed={compared}
              aria-label={`${compared ? "Убрать из сравнения" : "Сравнить"} ${titleWithHotel}`}
              title={
                compareDisabled
                  ? "Можно сравнить до трёх номеров"
                  : "Добавить к сравнению"
              }
              disabled={compareDisabled}
              onClick={(event) => {
                event.stopPropagation();
                onCompare();
              }}
            >
              <GitCompareArrows size={19} aria-hidden="true" />
            </button>
          )}
        </div>
        {room && <p className="search-room-hotel">{title}</p>}
        {room && <p className="search-room-capacity">{capacityUnknown || capacity == null ? "Вместимость нужно уточнить" : `Вместимость: до ${capacity} гостей${match?.best.capacityRule ? " по правилу размещения" : ""}`}</p>}
        <p className="search-hotel-meta">{hotel.address || "Адрес не указан"}</p>
        <details className="search-card-information">
        <summary>Условия и источники</summary>
        {room?.sleepingPlaces != null && <p className="search-hotel-room">Спальных мест: {room.sleepingPlaces} · расстановка кроватей в подробностях</p>}
        {category && !room && (
          <p className="search-hotel-room">
            Категория: {category.name}
            {!capacityUnknown && !match?.best.capacityRule && category.capacity !== null && !category.capacityMayVary
              ? ` · до ${category.capacity} гостей` : ""}
          </p>
        )}
        {roomDetails && <p className="search-hotel-room">{roomDetails}</p>}
        <NearbySummary matches={match?.best.nearbyMatches || nearbyMatches(hotel, hotelFilters)} region={hotel.region} />
        {ownerId && <ReviewHighlights listing={{ id: ownerId, demo: hotel.synthetic }} compact />}
        {hotel.route && !hotel.synthetic ? (
          <button
            type="button"
            className="search-route-button"
            onClick={(event) => {
              event.stopPropagation();
              (onShowMap || onSelect)?.();
            }}
            disabled={!onSelect && !onShowMap}
          >
            <Waves size={20} aria-hidden="true" />
            {hotel.route.meters} м по пешеходной сети до пляжа
          </button>
        ) : (
          <p className="search-hotel-unknown">
            <MapPin size={18} aria-hidden="true" />
            {ownerId
              ? validListingCoordinates(hotel.coordinates)
                ? hotel.synthetic ? "Учебная точка на карте · вымышленный объект" : "Точка на карте указана отельером"
                : "Расположение на карте не добавлено"
              : "Маршрут до пляжа не рассчитан"}
          </p>
        )}
        <p className="search-hotel-evidence">
          <CircleHelp size={18} aria-hidden="true" />
          <span>
            {roomRecommendation && hasConditions && !alternative && !match?.best.provisional && presentationState === "match"
              ? roomRecommendation.source === "owner"
                ? "Все критерии совпали по сведениям отельера"
                : roomRecommendation.source === "demo"
                  ? "Совпадение в демонстрационных данных"
                  : "Условия сопоставлены с источниками категории"
              : capacityUnknown
              ? "Вместимость требует уточнения"
              : missingOwner
              ? `${missingOwner.label}: ${missingOwner.evidenceStatus === "unknown" ? "нет данных" : missingOwner.evidenceStatus === "match" ? "по сведениям отельера" : "не совпадает"}`
              : uncertain
                ? `${features[uncertain.feature].label}: ${criterionNeedsClarification(uncertain) ? "требует уточнения" : "не совпадает"}`
                : sourceHint}
          </span>
        </p>
        {conditionCount > 0 && <details className="search-card-evidence">
          <summary>Все условия и источники <span>{conditionCount}</span></summary>
          <p className="search-card-source">{sourceHint}</p>
        {!!match?.best.criteria.length && (
          <ul className="search-hotel-criteria" aria-label="Совпадение с вашими пожеланиями">
            {match.best.criteria.map((criterion) => {
              const uncertain = criterionNeedsClarification(criterion);
              const ownerDeclared = !uncertain && (hasKnownOwnerAmenity(criterion) || !!criterion.reportedEvidence?.length);
              const fits = criterion.status === "match";
              const Icon = uncertain ? CircleHelp : fits ? Check : X;
              return (
                <li key={criterion.feature} className={uncertain ? "is-uncertain" : fits ? "is-match" : "is-mismatch"}>
                  <div className="search-card-criterion">
                    <span><Icon size={15} aria-hidden="true" />{features[criterion.feature].label}: {uncertain ? "нужно уточнить" : fits ? ownerDeclared ? "по сведениям отельера" : "совпадает" : "не совпадает"}</span>
                    <CriterionLine criterion={criterion} detailed />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!!roomRecommendation?.ownerCriteria?.length && <ul className="search-hotel-criteria" aria-label="Дополнительные условия номера">
          {roomRecommendation.ownerCriteria.map((criterion) => <li key={criterion.id} className={criterion.evidenceStatus === "unknown" ? "is-uncertain" : criterion.status === "match" ? "is-match" : "is-mismatch"}>
            <span>{criterion.label}: {criterion.evidenceStatus === "unknown" ? "нет данных" : criterion.status === "match" ? "по сведениям отельера" : "не совпадает"}</span>
          </li>)}
        </ul>}
        <LocationCriteria criteria={match?.locationCriteria} detailed />
        </details>}
        {!!hotel.route?.connectionMeters && !hotel.synthetic && <p className="search-route-caveat">Подходы к сети: ещё ≈{Math.round(hotel.route.connectionMeters)} м, не проверены.</p>}
        </details>
        {hasPrice && match && (
          <p className={`search-hotel-result${presentationState === "mismatch" ? " is-mismatch" : estimated ? " is-estimate" : ""}`}>
            {presentationState === "match"
              ? <Check size={17} aria-hidden="true" />
              : <CircleHelp size={17} aria-hidden="true" />}
            {resultLabel}
          </p>
        )}
        <div className="search-hotel-bottom">
          <div>
            {hasPrice ? (
              <>
                <strong className="search-hotel-price">
                  {new Intl.NumberFormat("ru-RU").format(hotel.pricePerNight!)}{" "}
                  {hotel.currency === "RUB" ? "₽" : "₩"} <small>/ ночь</small>
                </strong>
                <span className="search-hotel-price-note">
                  Цена отельера · наличие уточняйте
                </span>
              </>
            ) : (
              <>
                <strong
                  className={`search-hotel-result${!match ? " is-preview" : presentationState === "mismatch" ? " is-mismatch" : presentationState === "unknown" || estimated ? " is-estimate" : ""}`}
                >
                  {roomRecommendation ? (
                    <>{alternative || match?.best.provisional || presentationState !== "match" ? <CircleHelp size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}
                      {match?.best.provisional || needsClarification ? "Вариант для уточнения" : alternative || presentationState === "mismatch" ? "Не все условия подтверждены" : hasConditions ? "Совпали выбранные условия" : "Подходит по вместимости"}
                    </>
                  ) : match ? (
                    <>
                      {presentationState !== "match"
                        ? <CircleHelp size={17} aria-hidden="true" />
                        : <Check size={17} aria-hidden="true" />}
                      {resultLabel}
                    </>
                  ) : (
                    room ? "Категория номера из каталога" : "Условия и источники"
                  )}
                </strong>
                <span className="search-hotel-price-note">
                  Цена и наличие не проверены
                </span>
              </>
            )}
          </div>
          <div className="search-card-actions">
          {match && (needsClarification || presentationState !== "match") && <Link to={`${detailsPath}#decision-next-steps`} className="search-card-next-step">Что уточнить</Link>}
          <Link
            to={detailsPath}
            className={`button ${selected ? "primary" : "secondary"}`}
          >
            {room ? "Посмотреть номер" : "Подробнее"}
          </Link>
          </div>
        </div>
      </div>
      {!!match?.best.catalogMatches?.length && <details className="search-source-matches">
        <summary>Совпадения в тексте источников</summary>
        <p>Упоминание не подтверждает наличие удобства в конкретном номере.</p>
        {match.best.catalogMatches.map((snippet, index) => <blockquote key={index}>
          {snippet.text}
          {snippet.sourceUrl && <a href={snippet.sourceUrl} target="_blank" rel="noreferrer">Источник</a>}
          <small>{snippet.sourceDate ? `Дата источника: ${dateFull(snippet.sourceDate)}.` : "Дата источника неизвестна."}
            {snippet.obtainedAt && ` Получено: ${dateFull(snippet.obtainedAt)}.`}
            {snippet.expiresAt && ` Перепроверить до: ${dateFull(snippet.expiresAt)}.`}</small>
        </blockquote>)}
      </details>}
      {match && <PersonalWishesSummary match={match} />}
    </article>
  );
}
