import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { TripProvider, useApp } from "./providers/TripProvider";
import { Header } from "./layout/Header";
import { AppRouter } from "./router";
import { ErrorMessage } from "../shared/ui/Feedback";
export function App() {
  return (
    <TripProvider>
      <AppLayout />
    </TripProvider>
  );
}
function AppLayout() {
  const { catalogError } = useApp();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <>
      {" "}
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <Header />
      <main id="main" tabIndex={-1}>
        {catalogError ? (
          <div className="page">
            <ErrorMessage text={catalogError} />
            <button className="button" onClick={() => window.location.reload()}>
              Повторить загрузку
            </button>
          </div>
        ) : (
          <AppRouter />
        )}
      </main>
      <footer className="footer">
        <Link to="/" className="brand small">
          <span className="brand-mark">О!</span>Подойдёт
        </Link>
        <span>Меньше сомнений. Больше отдыха.</span>
        <span>
          Прототип ·{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            © OpenStreetMap contributors
          </a>{" "}
          · проверяемые источники
        </span>
      </footer>
    </>
  );
}
