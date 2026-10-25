import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "../features/auth/AuthProvider";
import { FavoritesProvider } from "../features/favorites/FavoritesProvider";
import { TripProvider } from "./providers/TripProvider";
import { Header } from "./layout/Header";
import { AppRouter } from "./router";
import "./layout/app-shell.css";
const laboratory = import.meta.env.VITE_LAB_MODE === "true";
export function App() {
  return (
    <AuthProvider>
      <TripProvider>
        <AccountFavorites />
      </TripProvider>
    </AuthProvider>
  );
}
function AccountFavorites() {
  const { user } = useAuth();
  return (
    <FavoritesProvider scope={user?.id || "guest"}>
      <AppLayout />
    </FavoritesProvider>
  );
}
function AppLayout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById("main")?.focus({ preventScroll: true });
    document.title = laboratory ? "О!Подойдёт · Тестовая версия" : "О!Подойдёт";
  }, [pathname]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <Header />
      <main id="main" tabIndex={-1}>
        <AppRouter />
      </main>
      <footer className="v2-footer">
        <span>
          {laboratory
            ? "Тестовая версия · заявки без оплаты"
            : "Заявки на размещение без оплаты"}
        </span>
        <div className="v2-footer-links">
          <Link to="/about">Как это работает</Link>
          {laboratory && <Link to="/lab">Лаборатория ИИ</Link>}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            © OpenStreetMap contributors
          </a>
        </div>
      </footer>
    </div>
  );
}
