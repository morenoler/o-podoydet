import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Building2, CalendarDays, Heart, Info, UserRound } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { ErrorMessage } from "../../../shared/ui/Feedback";
import "../account.css";
import "../account-v2.css";

export function AccountShell({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!user) return null;
  const host = user.role === "host";
  const base = host ? "/host" : "/account";
  const entries = host
    ? [
        { to: base, title: "Мои объявления", icon: Building2 },
        { to: `${base}/bookings`, title: "Бронирования", icon: CalendarDays },
        {
          to: `${base}/questions`,
          title: "Вопросы гостей",
          icon: Info,
        },
        { to: `${base}/profile`, title: "Мой профиль", icon: UserRound },
      ]
    : [
        { to: base, title: "Мои поездки", icon: CalendarDays },
        { to: `${base}/questions`, title: "Мои вопросы", icon: Info },
        { to: "/favorites", title: "Избранное", icon: Heart },
        { to: `${base}/profile`, title: "Мой профиль", icon: UserRound },
      ];
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page account-page account-layout">
      <aside className="account-sidebar">
        <div className="account-identity">
          <span className="account-avatar" aria-hidden="true">
            {user.name.trim().slice(0, 1).toLocaleUpperCase("ru-RU")}
          </span>
          <div>
            <strong>{user.name}</strong>
            <span>{host ? "Отельер" : "Путешественник"}</span>
          </div>
        </div>
        <nav
          className="account-nav"
          aria-label={host ? "Кабинет отельера" : "Личный кабинет"}
        >
          {entries.map(({ to, title, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === base}
              className={({ isActive }) =>
                `account-nav-link${isActive || (to === base && pathname === `${base}/${host ? "listings" : "bookings"}`) ? " selected" : ""}`
              }
            >
              <Icon size={19} aria-hidden="true" />
              <span className="account-nav-desktop-label">{title}</span>
              <span className="account-nav-mobile-label">
                {to === base
                  ? host
                    ? "Жильё"
                    : "Поездки"
                  : to.endsWith("/profile")
                    ? "Профиль"
                    : to.endsWith("/bookings")
                      ? "Заявки"
                      : to.endsWith("/questions")
                        ? "Вопросы"
                        : title}
              </span>
            </NavLink>
          ))}
        </nav>
        <div className="account-sidebar-bottom">
          <div className="account-help">
            <strong>Нужна помощь?</strong>
            <details>
              <summary>Как устроены заявки</summary>
              <p>
                Гость отправляет заявку, а отельер подтверждает проживание.
                Статус сохраняется в кабинете. Оплата через сервис не
                принимается.
              </p>
            </details>
          </div>
          <button
            className="button secondary account-signout"
            disabled={busy}
            onClick={signOut}
          >
            {busy ? "Выходим…" : "Выйти"}
          </button>
        </div>
      </aside>
      <section className="account-content">
        <div className="account-page-heading">
          <div>
            <h1 id="account-heading" tabIndex={-1}>
              {title}
            </h1>
            <p>{description}</p>
          </div>
          {action}
        </div>
        {error && <ErrorMessage text={error} />}
        {children}
      </section>
    </div>
  );
}
