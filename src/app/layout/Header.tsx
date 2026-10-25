import { useLocation, Link } from "react-router-dom";
import { Compass, Building2, FlaskConical } from "lucide-react";
import "./Header.css";

export function Header() {
  const location = useLocation();
  return (
    <header
      className={
        import.meta.env.VITE_LAB_MODE === "true"
          ? "header lab-header"
          : "header"
      }
    >
      <div className="header-inner">
        <Link to="/" className="brand" aria-label="О!Подойдёт — начать подбор">
          <span className="brand-mark">О!</span>Подойдёт
          <span className="brand-dot" />
        </Link>
        <nav aria-label="Главная навигация">
          <Link
            to="/"
            className={
              location.pathname !== "/host" && location.pathname !== "/lab"
                ? "nav-link active"
                : "nav-link"
            }
          >
            <Compass size={18} />
            Найти свой отдых
          </Link>
          <Link
            to="/host"
            className={
              location.pathname === "/host" ? "nav-link active" : "nav-link"
            }
          >
            <Building2 size={18} />
            Отельерам
          </Link>
        </nav>
        {import.meta.env.VITE_LAB_MODE === "true" && (
          <Link
            to="/lab"
            className={
              location.pathname === "/lab"
                ? "nav-link active lab-nav"
                : "nav-link lab-nav"
            }
            aria-current={location.pathname === "/lab" ? "page" : undefined}
          >
            <FlaskConical size={17} aria-hidden="true" />
            Лаборатория
          </Link>
        )}
        <span className="prototype">MVP</span>
      </div>
    </header>
  );
}
