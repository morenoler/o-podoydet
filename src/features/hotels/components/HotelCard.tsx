import { CapacitySummary } from "./CapacitySummary";
import type { Dataset, HotelMatch } from "../../../../shared/types";
import { Link } from "react-router-dom";
import { GeoMap } from "../../map/components/GeoMap";
import {
  Footprints,
  GitCompareArrows,
  MapPin,
  Building2,
  ArrowRight,
} from "lucide-react";
import { MatchBadge } from "./MatchBadge";
import { lodgingLabel } from "../../../shared/lib/presentation";
import { WishMatches } from "./WishMatches";

export function HotelCard({
  match,
  dataset,
  compared,
  onCompare,
  compareDisabled = false,
}: {
  match: HotelMatch;
  dataset: Dataset | null;
  compared: boolean;
  onCompare: () => void;
  compareDisabled?: boolean;
}) {
  const { hotel, best } = match;
  return (
    <article className="hotel-card">
      <Link
        to={`/hotels/${hotel.id}?room=${best.room.id}`}
        className="hotel-map-link"
        aria-label={`Подробнее об отеле ${hotel.name}`}
      >
        {dataset && <GeoMap dataset={dataset} hotel={hotel} compact />}
        <span className="distance-pill">
          <Footprints size={15} />
          {hotel.route
            ? `${hotel.route.meters} м до пляжа`
            : "Маршрут не найден"}
        </span>
      </Link>
      <div className="hotel-card-body">
        <div className="card-top">
          <MatchBadge match={match} />
          <button
            type="button"
            className={`compare-button ${compared ? "selected" : ""}`}
            aria-pressed={compared}
            aria-label={`${compared ? "Убрать из сравнения" : "Сравнить"} ${hotel.name}`}
            onClick={onCompare}
            disabled={compareDisabled}
            title={
              compareDisabled
                ? "Можно сравнить не больше трёх отелей"
                : undefined
            }
          >
            <GitCompareArrows size={18} />
          </button>
        </div>
        <Link
          to={`/hotels/${hotel.id}?room=${best.room.id}`}
          className="hotel-title"
        >
          <h2>{hotel.name}</h2>
        </Link>
        <p className="address">
          <MapPin size={14} />
          {lodgingLabel(hotel)} · {hotel.address}
        </p>
        <div className="room-label">
          <Building2 size={15} />
          {best.room.name}
          <span>
            {best.room.evidenceStatus === "verified"
              ? "Официальный источник"
              : "Нет данных о категории"}
          </span>
        </div>
        <CapacitySummary match={best} />
        <div className="card-criteria">
          <WishMatches criteria={best.criteria} />
        </div>
        <div className="card-bottom">
          <span>Цена и наличие не проверены</span>
          <Link
            to={`/hotels/${hotel.id}?room=${best.room.id}`}
            className="text-link"
          >
            Подробнее <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </article>
  );
}
