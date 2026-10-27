import { Link, useNavigate } from "react-router-dom";
import { Building2, ChevronRight, Luggage, MapPin, Waves } from "lucide-react";
import { useApp } from "../app/providers/TripProvider";
import { Steps } from "../app/layout/Steps";
import { GeoMap } from "../features/map/components/GeoMap";
import { TripSearchForm } from "../features/trip/components/TripSearchForm";
import { regionDetails } from "../../shared/regions";
import "../features/trip/trip-search.css";

/** Shared search entry for the main application and the laboratory. */
export function TripPage() {
  const { trip, setTrip, catalog, regions } = useApp();
  const navigate = useNavigate();
  // Lab fixtures are fictional and must not be presented as real places on the map.
  const mapCatalog = catalog
    ? { ...catalog, hotels: catalog.hotels.filter((hotel) => !hotel.synthetic) }
    : null;

  return (
    <div className="page trip-search-page">
      <div className="trip-search-heading">
        <h1>
          Найдём место
          <br />
          для вашей поездки
        </h1>
        <p>
          Расскажите, что вам важно. Мы поможем сравнить отели и разобраться в
          деталях.
        </p>
      </div>
      <Steps current={0} />
      <div className="trip-search-layout">
        <TripSearchForm
          initialTrip={trip}
          key={trip.region}
          regions={regions}
          onRegionChange={setTrip}
          onContinue={(nextTrip) => {
            setTrip(nextTrip);
            navigate("/wishes");
          }}
        />
        <aside
          className="trip-search-destination"
          aria-labelledby="trip-destination-title"
        >
          <div className="trip-search-map">
            {mapCatalog ? (
              <GeoMap dataset={mapCatalog} />
            ) : (
              <div className="trip-search-map-loading" role="status">
                Загружаем карту: {trip.region}…
              </div>
            )}
          </div>
          <div className="trip-search-destination-copy">
            <div className="trip-search-destination-title">
              <div>
                <p>
                  <MapPin size={15} aria-hidden="true" /> {regionDetails(trip.region)?.country}
                </p>
                <h2 id="trip-destination-title">{trip.region}. Ближе к морю.</h2>
              </div>
              <Waves size={32} aria-hidden="true" />
            </div>
            <p>
              {regionDetails(trip.region)?.hint}
            </p>
            <div className="trip-search-map-note">
              На карте реальные объекты из OpenStreetMap. Доступность номеров
              нужно уточнять.
            </div>
          </div>
        </aside>
      </div>
      <section
        className="trip-search-shortcuts"
        aria-label="Другие возможности"
      >
        <Link to="/stays" className="trip-search-shortcut">
          <span className="trip-search-shortcut-icon">
            <Building2 size={23} aria-hidden="true" />
          </span>
          <span>
            <strong>Объявления отельеров</strong>
            <span>Посмотрите жильё, задайте вопрос и отправьте заявку.</span>
          </span>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
        <Link to="/account" className="trip-search-shortcut">
          <span className="trip-search-shortcut-icon">
            <Luggage size={23} aria-hidden="true" />
          </span>
          <span>
            <strong>Мои поездки</strong>
            <span>Бронирования, ответы отельеров и личная информация.</span>
          </span>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </section>
      <div className="trip-search-host-link">
        <p>Сдаёте жильё?</p>
        <Link to="/host">
          Перейти в кабинет отельера{" "}
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
