import { useLocation, Link } from "react-router-dom";
import { Compass, Building2 } from "lucide-react";

export function Header() {
  const location = useLocation();
  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="brand" aria-label="О!Подойдёт — начать подбор">
          <span className="brand-mark">О!</span>Подойдёт
          <span className="brand-dot" />
        </Link>
        <nav aria-label="Главная навигация">
          <Link
            to="/"
            className={
              location.pathname !== "/host" ? "nav-link active" : "nav-link"
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
        <span className="prototype">MVP</span>
      </div>
    </header>
  );
}
