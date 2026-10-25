import { Heart } from "lucide-react";
import { useFavorites, type FavoriteItem } from "./FavoritesProvider";
export function FavoriteButton({
  item,
  className = "",
  label = false,
}: {
  item: FavoriteItem;
  className?: string;
  label?: boolean;
}) {
  const { isFavorite, toggle, error } = useFavorites();
  const active = isFavorite(item.id);
  return (
    <>
      <button
        type="button"
        className={`${label ? "button secondary" : "icon-button"} favorite-button ${active ? "is-favorite" : ""} ${className}`}
        aria-pressed={active}
        aria-label={`${active ? "Удалить из избранного" : "В избранное"}: ${item.name}`}
        onClick={(event) => {
          event.stopPropagation();
          toggle(item);
        }}
      >
        <Heart
          size={22}
          aria-hidden="true"
          fill={active ? "currentColor" : "none"}
        />
        {label && <span>{active ? "В избранном" : "В избранное"}</span>}
      </button>
      {error && (
        <span className="sr-only" role="status">
          {error}
        </span>
      )}
    </>
  );
}
