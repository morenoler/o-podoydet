import type { Dataset, Hotel, HotelMatch } from "../../../../shared/types";
import { Link } from "react-router-dom";
import {
  Check,
  CircleHelp,
  GitCompareArrows,
  MapPin,
  Waves,
} from "lucide-react";
import {
  accommodationPath,
  accountListingId,
} from "../../../shared/lib/accommodation";
import { AccommodationPhoto } from "../../../shared/ui/AccommodationPhoto";
import { FavoriteButton } from "../../favorites/FavoriteButton";
import { PersonalWishesSummary } from "./PersonalWishesSummary";
import { features } from "../../../../shared/features";
import { directionLabels } from "../../account/format";
import {
  capacityNeedsClarification,
  criterionNeedsClarification,
  matchLabel,
  matchPresentationState,
} from "../../../shared/lib/matchPresentation";

export function HotelCard({
  match,
  hotel: previewHotel,
  compared = false,
  onCompare,
  compareDisabled = false,
  selected = false,
  onSelect,
  onShowMap,
}: {
  match?: HotelMatch;
  hotel?: Hotel;
  dataset?: Dataset | null;
  compared?: boolean;
  onCompare?: () => void;
  compareDisabled?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onShowMap?: () => void;
}) {
  const hotel = match?.hotel || previewHotel;
  if (!hotel) return null;
  const ownerId = accountListingId(hotel);
  const detailsPath = accommodationPath(hotel, match?.best.room.id);
  const capacityUnknown = match && capacityNeedsClarification(match.best);
  const needsClarification = capacityUnknown ||
    match?.best.criteria.some(criterionNeedsClarification) ||
    match?.ownerCriteria?.some((c) => c.evidenceStatus === "unknown");
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
  const sourceHint = ownerId
    ? "Сведения отельера · без независимой проверки"
    : match?.best.room.evidenceStatus === "verified" && match.best.room.scope === "room_category"
      ? "Категория по сведениям официального сайта"
      : !match && publishedCategoryCount > 0
        ? `Категории с официального сайта: ${publishedCategoryCount}`
        : "Категорию и условия номера нужно уточнить";
  const category = match?.best.room.evidenceStatus === "verified" &&
    match.best.room.scope === "room_category" ? match.best.room : undefined;
  const roomDetails = [
    hotel.floor == null ? "" : `Этаж: ${hotel.floor}`,
    hotel.windowDirections?.length
      ? `Окна: ${hotel.windowDirections.map((value) => directionLabels[value]).join(", ")}` : "",
  ].filter(Boolean).join(" · ");
  const hasPrice =
    typeof hotel.pricePerNight === "number" &&
    hotel.pricePerNight > 0 &&
    hotel.currency === "KRW";
  const resultLabel = match ? matchLabel(match) : "Условия и источники";
  const presentationState = match ? matchPresentationState(match) : "unknown";
  return (
    <article
      className={`search-hotel-card${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      aria-label={hotel.name}
    >
      <div className="search-hotel-photo">
        <Link to={detailsPath} tabIndex={-1} aria-hidden="true">
          <AccommodationPhoto
            name={hotel.name}
            hotelId={hotel.id}
            photos={hotel.photos}
          />
        </Link>
        <FavoriteButton
          item={{
            id: ownerId ? `listing:${ownerId}` : hotel.id,
            name: hotel.name,
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
              aria-label={`${compared ? "Убрать из сравнения" : "Сравнить"} ${hotel.name}`}
              title={
                compareDisabled
                  ? "Можно сравнить до трёх отелей"
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
        <p className="search-hotel-meta">{hotel.address || "Пусан, Хэундэ"}</p>
        {category && (
          <p className="search-hotel-room">
            Категория: {category.name}
            {!capacityUnknown && !match?.best.capacityRule && category.capacity !== null && !category.capacityMayVary
              ? ` · до ${category.capacity} гостей` : ""}
          </p>
        )}
        {roomDetails && <p className="search-hotel-room">{roomDetails}</p>}
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
            {hotel.route.meters} м пешком до пляжа
          </button>
        ) : (
          <p className="search-hotel-unknown">
            <MapPin size={18} aria-hidden="true" />
            {ownerId
              ? "Расположение на карте не добавлено"
              : "Маршрут до пляжа не рассчитан"}
          </p>
        )}
        <p className="search-hotel-evidence">
          <CircleHelp size={18} aria-hidden="true" />
          <span>
            {capacityUnknown
              ? "Вместимость требует уточнения"
              : missingOwner
              ? `${missingOwner.label}: ${missingOwner.evidenceStatus === "unknown" ? "нет данных" : missingOwner.evidenceStatus === "match" ? "по сведениям отельера" : "не совпадает"}`
              : uncertain
                ? `${features[uncertain.feature].label}: ${criterionNeedsClarification(uncertain) ? "требует уточнения" : "не совпадает"}`
                : sourceHint}
          </span>
        </p>
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
                  ₩ <small>/ ночь</small>
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
                  {match ? (
                    <>
                      {presentationState !== "match"
                        ? <CircleHelp size={17} aria-hidden="true" />
                        : <Check size={17} aria-hidden="true" />}
                      {resultLabel}
                    </>
                  ) : (
                    resultLabel
                  )}
                </strong>
                <span className="search-hotel-price-note">
                  Цена и наличие не проверены
                </span>
              </>
            )}
          </div>
          <Link
            to={detailsPath}
            className={`button ${selected ? "primary" : "secondary"}`}
          >
            Подробнее
          </Link>
        </div>
      </div>
      {match && <PersonalWishesSummary match={match} />}
    </article>
  );
}
