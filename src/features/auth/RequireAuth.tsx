import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import type { AccountRole } from "../../../shared/account";
import { accountPath, useAuth } from "./AuthProvider";
import { ErrorMessage } from "../../shared/ui/Feedback";

export function RequireAuth({
  children,
  role,
}: {
  children: ReactNode;
  role?: AccountRole;
}) {
  const { user, loading, error, reload } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="page" role="status">
        Открываем личный кабинет…
      </div>
    );
  if (error)
    return (
      <div className="page">
        <ErrorMessage text={error} />
        <button className="button secondary" onClick={() => void reload()}>
          Повторить
        </button>
      </div>
    );
  if (!user)
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  if (role && user.role !== role)
    return (
      <div className="page">
        <h1>
          Этот раздел для {role === "host" ? "отельеров" : "путешественников"}
        </h1>
        <p className="lead">
          Вы вошли как {user.name}. Ваши данные доступны в личном кабинете.
        </p>
        <Link className="button primary" to={accountPath(user)}>
          Перейти в мой кабинет
        </Link>
      </div>
    );
  return children;
}
