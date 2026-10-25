import type { Trip } from "../../../../shared/types";
import { MapPin } from "lucide-react";
import { dateLabel } from "../../../shared/lib/date";
import { Link } from "react-router-dom";

export function TripSummary({ trip }: { trip: Trip }) {
  return (
    <div className="trip-summary">
      <MapPin size={17} />
      <strong>{trip.region}</strong>
      <span className="summary-divider" />
      <span>
        {dateLabel(trip.checkIn)} — {dateLabel(trip.checkOut)}
      </span>
      <span className="summary-divider" />
      <span>{trip.adults + trip.children} гостей</span>
      <Link to="/">Изменить</Link>
    </div>
  );
}
