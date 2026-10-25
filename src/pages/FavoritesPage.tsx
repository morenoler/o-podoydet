import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import { useFavorites } from "../features/favorites/FavoritesProvider";
import { FavoriteButton } from "../features/favorites/FavoriteButton";
import { AccommodationPhoto } from "../shared/ui/AccommodationPhoto";
export function FavoritesPage() {
  const { items, error } = useFavorites();
  return (
    <div className="page favorites-page">
      <h1>Избранное</h1>
      <p className="page-intro">
        Сохранённые места для вашей поездки. Список хранится в этом браузере.
      </p>
      {error && <p role="alert">{error}</p>}
      {!items.length ? (
        <section className="v2-empty">
          <Heart size={36} aria-hidden="true" />
          <h2>Здесь будут любимые места</h2>
          <p>Нажмите на сердечко в карточке отеля или объявления.</p>
          <Link className="button primary" to="/">
            Найти отель
          </Link>
        </section>
      ) : (
        <div className="favorites-grid">
          {items.map((item) => (
            <article className="favorite-card" key={item.id}>
              <div className="favorite-photo">
                <AccommodationPhoto
                  name={item.name}
                  hotelId={item.hotelId}
                  photos={item.photos}
                />
                <FavoriteButton item={item} />
              </div>
              <div>
                <h2>
                  <Link to={item.path}>{item.name}</Link>
                </h2>
                <p>{item.address}</p>
                <Link className="button secondary" to={item.path}>
                  Подробнее
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
