import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { isPhotoUrl } from "../../shared/lib/hotelPhotos";
export interface FavoriteItem {
  id: string;
  name: string;
  path: string;
  hotelId?: string;
  photos?: string[];
  address?: string;
}
function read(key: string): FavoriteItem[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (item) =>
          typeof item?.id === "string" &&
          typeof item?.name === "string" &&
          typeof item?.path === "string" &&
          /^\/(stays|hotels)\/[^/?#\\]+(?:\?room=[^&#\\]+)?$/.test(item.path),
      )
      .slice(0, 200)
      .map((item) => ({
        id: item.id,
        name: item.name,
        path: item.path,
        hotelId: typeof item.hotelId === "string" ? item.hotelId : undefined,
        address: typeof item.address === "string" ? item.address : undefined,
        photos: Array.isArray(item.photos)
          ? item.photos.filter(isPhotoUrl)
          : undefined,
      }));
  } catch {
    return [];
  }
}
const Context = createContext<{
  items: FavoriteItem[];
  isFavorite: (id: string) => boolean;
  toggle: (item: FavoriteItem) => void;
  error: string;
} | null>(null);
export function FavoritesProvider({
  children,
  scope = "guest",
}: {
  children: ReactNode;
  scope?: string;
}) {
  const key = `o-favorites-v2:${scope}`;
  const [snapshot, setSnapshot] = useState(() => ({ key, items: read(key) }));
  const [error, setError] = useState("");
  const items = snapshot.key === key ? snapshot.items : read(key);
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === key) setSnapshot({ key, items: read(key) });
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, [key]);
  const toggle = (item: FavoriteItem) => {
    const next = items.some((value) => value.id === item.id)
      ? items.filter((value) => value.id !== item.id)
      : [...items, item].slice(-200);
    setSnapshot({ key, items: next });
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setError("");
    } catch {
      setError(
        "Не удалось сохранить избранное в браузере. Оно доступно до закрытия страницы.",
      );
    }
  };
  return (
    <Context.Provider
      value={{
        items,
        isFavorite: (id) => items.some((item) => item.id === id),
        toggle,
        error,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useFavorites() {
  const value = useContext(Context);
  if (!value) throw new Error("FavoritesProvider is required");
  return value;
}
