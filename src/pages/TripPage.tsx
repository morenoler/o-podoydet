import { useApp } from "../app/providers/TripProvider";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { today } from "../shared/lib/date";
import { Steps } from "../app/layout/Steps";
import {
  MapPin,
  ChevronDown,
  ArrowRight,
  Waves,
  ShieldCheck,
  Route as RouteIcon,
  MessageCircle,
} from "lucide-react";
import { ErrorMessage } from "../shared/ui/Feedback";
import { GeoMap } from "../features/map/components/GeoMap";

export function TripPage() {
  const { trip, setTrip, catalog } = useApp();
  const [form, setForm] = useState(trip),
    [error, setError] = useState("");
  const navigate = useNavigate();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.checkIn || !form.checkOut || form.checkOut <= form.checkIn) {
      setError("Выберите даты: выезд должен быть позже заезда.");
      return;
    }
    if (form.checkIn < today()) {
      setError("Выберите дату заезда не раньше сегодняшнего дня.");
      return;
    }
    setTrip(form);
    navigate("/wishes");
  }
  return (
    <div className="page trip-page">
      <Steps current={0} />
      <div className="trip-layout">
        <section className="trip-intro">
          <div className="intro-note">
            <span className="tiny-sun" />
            Отдых начинается с вас
          </div>
          <h1>
            Тот самый отель.
            <br />
            Для вашей поездки.
          </h1>
          <p className="lead">
            Сначала выберем место и даты.
            <br />А потом найдём то, что важно именно вам.
          </p>
          <form className="trip-form" onSubmit={submit}>
            <label className="field region-field">
              <span>Куда едем?</span>
              <div className="input-icon">
                <MapPin size={20} />
                <select
                  aria-label="Регион отдыха"
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                >
                  <option value="Пусан">Пусан, Южная Корея</option>
                </select>
                <ChevronDown size={17} />
              </div>
              <small>В этой версии исследуем район пляжа Хэундэ</small>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Заезд</span>
                <input
                  type="date"
                  aria-label="Дата заезда"
                  required
                  min={today()}
                  value={form.checkIn}
                  onChange={(e) =>
                    setForm({ ...form, checkIn: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Выезд</span>
                <input
                  type="date"
                  aria-label="Дата выезда"
                  required
                  min={form.checkIn || today()}
                  value={form.checkOut}
                  onChange={(e) =>
                    setForm({ ...form, checkOut: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Взрослые</span>
                <select
                  aria-label="Количество взрослых"
                  value={form.adults}
                  onChange={(e) =>
                    setForm({ ...form, adults: Number(e.target.value) })
                  }
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}{" "}
                      {n === 1 ? "взрослый" : n < 5 ? "взрослых" : "взрослых"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Дети</span>
                <select
                  aria-label="Количество детей"
                  value={form.children}
                  onChange={(e) =>
                    setForm({ ...form, children: Number(e.target.value) })
                  }
                >
                  {[0, 1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n === 0
                        ? "Без детей"
                        : `${n} ${n === 1 ? "ребёнок" : "детей"}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {error && <ErrorMessage text={error} />}
            <button className="button primary wide" type="submit">
              Продолжить <ArrowRight size={19} />
            </button>
            <p className="form-footnote">
              Дальше — несколько пожеланий. Можно выбрать кнопками.
            </p>
          </form>
        </section>
        <aside className="destination">
          <div className="destination-map">
            {catalog ? (
              <GeoMap dataset={catalog} />
            ) : (
              <div className="map-loading">Готовим карту побережья…</div>
            )}
          </div>
          <div className="destination-title">
            <div>
              <span>Место для вашей истории</span>
              <h2>Пусан</h2>
              <p>Море, прогулки и свой ритм.</p>
            </div>
            <span className="destination-symbol">
              <Waves size={34} />
            </span>
          </div>
          <div className="destination-proof">
            <ShieldCheck size={22} />
            <p>
              <strong>Смотрим чуть глубже</strong>
              <br />
              На дорогу к пляжу, сторону окон и ступени у входа.
            </p>
          </div>
        </aside>
      </div>
      <div className="how-row">
        <div>
          <RouteIcon />
          <span>
            <strong>Проверяем маршрут</strong>Считаем путь по улицам
          </span>
        </div>
        <div>
          <MessageCircle />
          <span>
            <strong>Уточняем детали</strong>Задаём вопрос отельеру
          </span>
        </div>
        <div>
          <ShieldCheck />
          <span>
            <strong>Объясняем выбор</strong>Показываем источники и оговорки
          </span>
        </div>
      </div>
    </div>
  );
}
