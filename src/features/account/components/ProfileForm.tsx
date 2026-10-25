import { useRef, useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { authApi } from "../../auth/api";
import { SaveStatus } from "./AccountFeedback";
import { calendarDate } from "../format";
import { Info } from "lucide-react";

export function ProfileForm() {
  const { user, updateUser } = useAuth();
  const [form, setForm] = useState({
    name: user?.name || "",
    phone: user?.phone || "",
    about: user?.about || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  if (!user) return null;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await authApi.profile({
        name: form.name.trim(),
        phone: form.phone.trim(),
        about: form.about.trim(),
      });
      if (!result.user)
        throw new Error("Сессия завершилась. Войдите в аккаунт снова.");
      updateUser(result.user);
      setSaved(true);
    } catch (error) {
      setError((error as Error).message);
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-profile-layout">
      <form
        className="account-panel account-form profile-editor"
        onSubmit={save}
      >
        <div className="profile-identity">
          <span className="account-avatar" aria-hidden="true">
            {user.name.trim().slice(0, 1).toLocaleUpperCase("ru-RU")}
          </span>
          <div>
            <h2>{user.name}</h2>
            <p>{user.role === "host" ? "Отельер" : "Путешественник"}</p>
          </div>
        </div>
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
        <label className="field">
          <span>Имя</span>
          <input
            name="name"
            autoComplete="name"
            required
            minLength={2}
            maxLength={100}
            value={form.name}
            onChange={(event) => {
              setForm({ ...form, name: event.target.value });
              setSaved(false);
            }}
          />
        </label>
        <label className="field">
          <span>Электронная почта</span>
          <input
            type="email"
            value={user.email}
            readOnly
            aria-describedby="profile-email-hint"
          />
          <small id="profile-email-hint">
            Почта используется для входа и не меняется здесь.
          </small>
        </label>
        <label className="field">
          <span>Телефон</span>
          <input
            type="tel"
            name="phone"
            autoComplete="tel"
            maxLength={40}
            value={form.phone}
            onChange={(event) => {
              setForm({ ...form, phone: event.target.value });
              setSaved(false);
            }}
            placeholder="+7 900 000-00-00"
          />
        </label>
        <label className="field">
          <span>
            {user.role === "host" ? "О вас и вашем объекте" : "О себе"}
          </span>
          <textarea
            rows={4}
            maxLength={1000}
            value={form.about}
            onChange={(event) => {
              setForm({ ...form, about: event.target.value });
              setSaved(false);
            }}
            placeholder={
              user.role === "host"
                ? "Как вы принимаете гостей и с чем можете помочь"
                : "Что для вас важно в поездке"
            }
          />
        </label>
        <div className="account-form-actions">
          <button className="button primary" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить изменения"}
          </button>
          <button
            className="button account-text-button"
            type="button"
            disabled={busy}
            onClick={() => {
              setForm({
                name: user.name,
                phone: user.phone,
                about: user.about,
              });
              setSaved(false);
              setError("");
            }}
          >
            Отменить
          </button>
          {saved && <SaveStatus>Изменения сохранены</SaveStatus>}
        </div>
      </form>
      <aside className="account-profile-note">
        <h2>
          <Info size={24} aria-hidden="true" />
          Контакты для поездки
        </h2>
        <p>
          Укажите номер, которым пользуетесь в поездках, и коротко расскажите о
          себе. Данные сохранятся в вашем профиле.
        </p>
        <small>В сервисе с {calendarDate(user.createdAt)}</small>
      </aside>
    </div>
  );
}
