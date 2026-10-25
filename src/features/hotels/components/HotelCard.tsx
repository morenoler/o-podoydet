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
import { features } from "../../../../shared/features";
import { directionLabels } from "../../account/format";

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
  const estimated =
    match?.best.capacityAssumed ||
    match?.best.criteria.some((c) => c.assumed) ||
    match?.ownerCriteria?.some((c) => c.assumed);
  const uncertain = match?.best.criteria.find(
    (c) => c.assumed || c.evidenceStatus !== "match",
  );
  const missingOwner = match?.ownerCriteria?.find(
    (c) => c.assumed || c.evidenceStatus !== "match",
  );
  const sourceHint = ownerId
    ? "Сведения отельера · без независимой проверки"
    : "Категорию и условия номера нужно уточнить";
  const hasPrice =
    typeof hotel.pricePerNight === "number" &&
    hotel.pricePerNight > 0 &&
    hotel.currency === "KRW";
  return (
    <article
      className={`search-hotel-card${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      onFocus={onSelect}
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
        <p className="search-hotel-room">
          {hotel.floor == null ? "Этаж: Не указано" : `Этаж: ${hotel.floor}`} ·{" "}
          {hotel.windowDirections?.length
            ? `Окна: ${hotel.windowDirections.map((value) => directionLabels[value]).join(", ")}`
            : "Окна: Не указано"}
        </p>
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
            {missingOwner
              ? `${missingOwner.label}: ${missingOwner.evidenceStatus === "unknown" ? "нет данных" : missingOwner.evidenceStatus === "match" ? "по сведениям отельера" : "не совпадает"}`
              : uncertain
                ? `${features[uncertain.feature].label}: ${uncertain.assumed ? "оценка, нужно уточнить" : "не совпадает"}`
                : sourceHint}
          </span>
        </p>
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
                  className={`search-hotel-result${estimated ? " is-estimate" : ""}`}
                >
                  {match ? (
                    <>
                      <Check size={17} aria-hidden="true" />
                      {estimated
                        ? "Подходит с предположениями"
                        : "Подходит под фильтры"}
                    </>
                  ) : (
                    "Условия и источники"
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
    </article>
  );
}
