import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  Building2,
  CalendarDays,
  Eye,
  EyeOff,
  MessageCircle,
  UserRound,
} from "lucide-react";
import type { AccountRole } from "../../shared/account";
import { accountPath, useAuth } from "../features/auth/AuthProvider";
import { AccountLoading } from "../features/account/components/AccountFeedback";
import "../features/account/account.css";

function destination(next: string | null, role: AccountRole) {
  const fallback = accountPath({ role });
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\")
  )
    return fallback;
  if (/^\/(login|register)(?:[/?#]|$)/.test(next)) return fallback;
  if (role === "user" && /^\/host(?:[/?#]|$)/.test(next)) return fallback;
  if (role === "host" && /^\/account(?:[/?#]|$)/.test(next)) return fallback;
  return next;
}

export function AuthPage({ mode = "login" }: { mode?: "login" | "register" }) {
  const registering = mode === "register";
  const { user, loading, login, register } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [role, setRole] = useState<AccountRole>(
    params.get("role") === "host" || params.get("next")?.startsWith("/host")
      ? "host"
      : "user",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const next = params.get("next");
  const requestedRole = params.get("role");
  useEffect(() => {
    setRole(
      requestedRole === "host" || next?.startsWith("/host") ? "host" : "user",
    );
  }, [requestedRole, next]);
  const siblingParams = new URLSearchParams();
  if (next) siblingParams.set("next", next);
  if (role === "host") siblingParams.set("role", "host");
  const query = siblingParams.size ? `?${siblingParams}` : "";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const current = registering
        ? await register({
            name: name.trim(),
            email: email.trim(),
            password,
            role,
          })
        : await login(email.trim(), password);
      navigate(destination(next, current.role), { replace: true });
    } catch (error) {
      setError((error as Error).message);
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="page">
        <AccountLoading text="Проверяем вход…" />
      </div>
    );
  if (user) return <Navigate to={destination(next, user.role)} replace />;
  return (
    <div className="page account-page auth-page">
      <section className="auth-story" aria-labelledby="auth-story-title">
        <span className="account-kicker">Ваш личный кабинет</span>
        <h1 id="auth-story-title">
          Все детали поездки.
          <br />В одном месте.
        </h1>
        <p>
          Сохраняйте историю проживания, уточняйте важное у отельера и следите
          за ответами.
        </p>
        <ul className="auth-benefits">
          <li>
            <CalendarDays size={22} aria-hidden="true" />
            <div>
              <strong>Поездки под рукой</strong>
              <span>Даты, стоимость и статус каждой заявки.</span>
            </div>
          </li>
          <li>
            <MessageCircle size={22} aria-hidden="true" />
            <div>
              <strong>Прямой диалог</strong>
              <span>Вопросы об объявлениях и ответы отельера.</span>
            </div>
          </li>
          <li>
            <Building2 size={22} aria-hidden="true" />
            <div>
              <strong>Свой кабинет для отельера</strong>
              <span>Объявления, бронирования и обращения гостей.</span>
            </div>
          </li>
        </ul>
        <Link className="text-link" to="/stays">
          Посмотреть объявления без регистрации
        </Link>
      </section>
      <section className="auth-panel" aria-labelledby="auth-title">
        <h2 id="auth-title">
          {registering ? "Создать аккаунт" : "Войти в аккаунт"}
        </h2>
        <p className="account-muted">
          {registering
            ? "Выберите, как будете пользоваться сервисом."
            : "Введите почту и пароль вашего аккаунта."}
        </p>
        <form className="account-form" onSubmit={submit}>
          {error && (
            <div
              className="account-form-error"
              role="alert"
              tabIndex={-1}
              ref={errorRef}
            >
              {error}
            </div>
          )}
          {registering && (
            <fieldset className="auth-role-picker">
              <legend>Я регистрируюсь как</legend>
              {(
                [
                  { value: "user", label: "Путешественник", icon: UserRound },
                  { value: "host", label: "Отельер", icon: Building2 },
                ] as const
              ).map((option) => (
                <label
                  className={
                    role === option.value ? "auth-role selected" : "auth-role"
                  }
                  key={option.value}
                >
                  <input
                    type="radio"
                    name="role"
                    value={option.value}
                    checked={role === option.value}
                    onChange={() => setRole(option.value)}
                  />
                  <option.icon size={20} aria-hidden="true" />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>
          )}
          {registering && (
            <label className="field">
              <span>Как вас зовут</span>
              <input
                name="name"
                autoComplete="name"
                required
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Имя и фамилия"
              />
            </label>
          )}
          <label className="field">
            <span>Электронная почта</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="field">
            <span>Пароль</span>
            <div className="auth-password">
              <input
                name="password"
                type={visible ? "text" : "password"}
                autoComplete={registering ? "new-password" : "current-password"}
                required
                minLength={registering ? 10 : undefined}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby={registering ? "password-hint" : undefined}
              />
              <button
                type="button"
                aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            {registering && (
              <small id="password-hint">
                От 10 до 128 символов. Можно использовать пароль из менеджера
                паролей.
              </small>
            )}
          </label>
          <button className="button primary wide" type="submit" disabled={busy}>
            {busy ? "Подождите…" : registering ? "Создать аккаунт" : "Войти"}
          </button>
        </form>
        <p className="auth-switch">
          {registering ? "Уже есть аккаунт?" : "Пока нет аккаунта?"}{" "}
          <Link to={`${registering ? "/login" : "/register"}${query}`}>
            {registering ? "Войти" : "Зарегистрироваться"}
          </Link>
        </p>
      </section>
    </div>
  );
}
