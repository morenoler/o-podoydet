import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ArrowLeft, ChevronDown, Heart, LogOut, Menu, UserRound } from "lucide-react";
import type { AccountUser } from "../../../shared/account";
import { Modal } from "../../shared/ui/Modal";
import "./SiteHeader.css";

export function SiteHeader({
  user = null,
  loading = false,
  accounts = false,
  laboratory = false,
  onLogout,
}: {
  user?: AccountUser | null;
  loading?: boolean;
  accounts?: boolean;
  laboratory?: boolean;
  onLogout?: () => Promise<void>;
}) {
  const { pathname, search } = useLocation();
  const [menu, setMenu] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false),
    [logoutError, setLogoutError] = useState("");
  async function logout() {
    if (!onLogout) return;
    setLoggingOut(true);
    setLogoutError("");
    try {
      await onLogout();
      setMenu(false);
    } catch (error) {
      setLogoutError((error as Error).message);
    } finally {
      setLoggingOut(false);
    }
  }
  const account = user?.role === "host" ? "/host" : "/account";
  const inAccount = accounts && /^\/(account|host)(\/|$)/.test(pathname);
  const inListing = pathname.startsWith("/stays/");
  const editing =
    inAccount && pathname === "/host" && /[?&](edit|new)=/.test(search);
  const back = editing ? "/host" : inListing ? "/stays" : "/";
  const title = editing
    ? search.includes("new=")
      ? "Новое объявление"
      : "Редактирование"
    : pathname.endsWith("/profile")
      ? "Мой профиль"
      : pathname.endsWith("/questions")
        ? user?.role === "host"
          ? "Вопросы гостей"
          : "Мои вопросы"
        : pathname.endsWith("/bookings")
          ? "Бронирования"
          : inListing
            ? "Объявления"
            : pathname.startsWith("/host")
              ? "Мои объявления"
              : "Мои поездки";
  const links = [
    {
      to: "/",
      label: "Найти отель",
      active:
        ["/", "/results", "/wishes", "/trip"].includes(pathname) ||
        pathname.startsWith("/hotels/"),
    },
    ...(accounts
      ? [
          {
            to: "/stays",
            label: "Объявления",
            active: pathname.startsWith("/stays"),
          },
          {
            to: account,
            label: user?.role === "host" ? "Кабинет отельера" : "Мои поездки",
            active: inAccount,
          },
        ]
      : [{ to: "/host", label: "Отельерам", active: pathname === "/host" }]),
    { to: "/about", label: "Как это работает", active: pathname === "/about" },
  ];
  return (
    <>
      <header
        className={`site-header${inAccount || inListing ? " has-mobile-context" : ""}`}
      >
        <div className="site-header-inner">
          <Link
            to="/"
            className="site-brand"
            aria-label="О!Подойдёт — на главную"
          >
            <span>О!</span>
            <strong>Подойдёт</strong>
          </Link>
          {(inAccount || inListing) && (
            <div className="site-mobile-context">
              <Link to={back} className="icon-button" aria-label="Назад">
                <ArrowLeft size={25} aria-hidden="true" />
              </Link>
              <strong>{title}</strong>
            </div>
          )}
          <nav className="site-navigation" aria-label="Главная навигация">
            {links.slice(0, 3).map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={link.active ? "active" : ""}
                aria-current={link.active ? "page" : undefined}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="site-header-actions">
            <Link
              className="site-favorites"
              to="/favorites"
              aria-label="Избранное"
            >
              <Heart size={24} aria-hidden="true" />
              <span>Избранное</span>
            </Link>
            {accounts ? (
              loading ? (
                <span className="site-account-loading" role="status">
                  Загрузка…
                </span>
              ) : user ? (
                <button
                  className="site-account-button"
                  onClick={() => setMenu(true)}
                  aria-label="Открыть меню аккаунта"
                  aria-haspopup="dialog"
                >
                  <span className="site-avatar">
                    {user.name.trim().slice(0, 1).toUpperCase()}
                  </span>
                  <span className="site-user-name">
                    {user.name.split(" ")[0]}
                  </span>
                  <ChevronDown size={18} aria-hidden="true" />
                </button>
              ) : (
                <button className="site-account-button" onClick={() => setMenu(true)} aria-label="Войти или открыть меню" aria-haspopup="dialog">
                  <span className="site-avatar"><UserRound size={20} aria-hidden="true" /></span>
                  <span className="site-user-name">Войти</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              )
            ) : null}
            <button
              className="icon-button site-menu-toggle"
              onClick={() => setMenu(true)}
              aria-label="Открыть меню"
              aria-haspopup="dialog"
            >
              <Menu size={26} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <Modal
        open={menu}
        onClose={() => setMenu(false)}
        title={user ? user.name : "Меню"}
        className="site-menu-dialog"
      >
        <nav aria-label="Меню сайта">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} onClick={() => setMenu(false)}>
              {link.label}
            </NavLink>
          ))}
          <Link to="/favorites" onClick={() => setMenu(false)}>
            Избранное
          </Link>
          {accounts && user && (
            <Link to={`${account}/profile`} onClick={() => setMenu(false)}>
              Мой профиль
            </Link>
          )}
          {accounts && !user && (
            <>
              <Link to="/login" onClick={() => setMenu(false)}>
                Войти
              </Link>
              <Link to="/register?role=host" onClick={() => setMenu(false)}>
                Разместить своё жильё
              </Link>
            </>
          )}
          {laboratory && (
            <Link to="/lab" onClick={() => setMenu(false)}>
              Лаборатория ИИ
            </Link>
          )}
        </nav>
        {user && onLogout && (
          <button
            className="button secondary site-logout"
            disabled={loggingOut}
            onClick={() => void logout()}
          >
            <LogOut size={18} aria-hidden="true" />
            {loggingOut ? "Выходим…" : "Выйти из аккаунта"}
          </button>
        )}
        {logoutError && <p role="alert">{logoutError}</p>}
      </Modal>
    </>
  );
}
