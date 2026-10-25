import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, MapPin, CalendarDays } from "lucide-react";
import type { Trip } from "../../../../shared/types";
import { today } from "../../../shared/lib/date";

type TripField = "checkIn" | "checkOut" | "adults" | "children";
type FormErrors = Partial<Record<TripField, string>>;

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function nextDate(value: string) {
  if (!validDate(value)) return today();
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function validate(form: Trip): FormErrors {
  const errors: FormErrors = {};
  if (!validDate(form.checkIn)) errors.checkIn = "Укажите дату заезда.";
  else if (form.checkIn < today())
    errors.checkIn = "Дата заезда должна быть сегодня или позже.";
  if (!validDate(form.checkOut)) errors.checkOut = "Укажите дату выезда.";
  else if (validDate(form.checkIn) && form.checkOut <= form.checkIn)
    errors.checkOut = "Выезд должен быть позже заезда.";
  if (!Number.isInteger(form.adults) || form.adults < 1 || form.adults > 6)
    errors.adults = "Выберите от 1 до 6 взрослых.";
  if (
    !Number.isInteger(form.children) ||
    form.children < 0 ||
    form.children > 4
  )
    errors.children = "Выберите от 0 до 4 детей.";
  return errors;
}

export function TripSearchForm({
  initialTrip,
  onContinue,
}: {
  initialTrip: Trip;
  onContinue: (trip: Trip) => void;
}) {
  const [form, setForm] = useState(initialTrip);
  const [errors, setErrors] = useState<FormErrors>({});
  const [attempt, setAttempt] = useState(0);
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (attempt > 0) summary.current?.focus();
  }, [attempt]);

  function update<K extends TripField>(field: K, value: Trip[K]) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      setAttempt((value) => value + 1);
      return;
    }
    onContinue({ ...form, region: "Пусан" });
  }

  const nights =
    validDate(form.checkIn) && validDate(form.checkOut)
      ? Math.round(
          (Date.parse(form.checkOut) - Date.parse(form.checkIn)) / 86_400_000,
        )
      : 0;
  const nightLabel = new Intl.PluralRules("ru-RU").select(nights);
  const nightsText =
    nightLabel === "one" ? "ночь" : nightLabel === "few" ? "ночи" : "ночей";
  const errorEntries = Object.entries(errors).filter((entry) =>
    Boolean(entry[1]),
  );

  return (
    <form
      className="trip-search-form"
      onSubmit={submit}
      noValidate
      aria-labelledby="trip-form-title"
    >
      <div className="trip-search-form-heading">
        <h2 id="trip-form-title">Куда и когда едем?</h2>
        <p>Начните с дат и количества гостей.</p>
      </div>
      {errorEntries.length > 0 && (
        <div
          className="trip-search-errors"
          role="alert"
          tabIndex={-1}
          ref={summary}
          aria-labelledby="trip-error-title"
        >
          <strong id="trip-error-title">Проверьте параметры поездки</strong>
          <ul>
            {errorEntries.map(([field, message]) => (
              <li key={field}>
                <a
                  href={`#trip-${field}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(`trip-${field}`)?.focus();
                  }}
                >
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="trip-search-field" htmlFor="trip-region">
        <span>Направление</span>
        <div className="trip-search-region">
          <MapPin size={20} aria-hidden="true" />
          <select
            id="trip-region"
            value="Пусан"
            aria-describedby="trip-region-hint"
            onChange={() => {}}
          >
            <option value="Пусан">Пусан, Южная Корея</option>
          </select>
        </div>
        <small id="trip-region-hint">
          Подбираем жильё в районе пляжа Хэундэ.
        </small>
      </label>
      <div className="trip-search-fields-row">
        <label className="trip-search-field" htmlFor="trip-checkIn">
          <span>Заезд</span>
          <input
            id="trip-checkIn"
            type="date"
            required
            min={today()}
            value={form.checkIn}
            aria-invalid={Boolean(errors.checkIn)}
            aria-describedby={errors.checkIn ? "trip-checkIn-error" : undefined}
            onChange={(event) => update("checkIn", event.target.value)}
          />
          {errors.checkIn && (
            <small className="trip-search-field-error" id="trip-checkIn-error">
              {errors.checkIn}
            </small>
          )}
        </label>
        <label className="trip-search-field" htmlFor="trip-checkOut">
          <span>Выезд</span>
          <input
            id="trip-checkOut"
            type="date"
            required
            min={nextDate(form.checkIn)}
            value={form.checkOut}
            aria-invalid={Boolean(errors.checkOut)}
            aria-describedby={
              errors.checkOut ? "trip-checkOut-error" : undefined
            }
            onChange={(event) => update("checkOut", event.target.value)}
          />
          {errors.checkOut && (
            <small className="trip-search-field-error" id="trip-checkOut-error">
              {errors.checkOut}
            </small>
          )}
        </label>
      </div>
      <div className="trip-search-fields-row">
        <label className="trip-search-field" htmlFor="trip-adults">
          <span>Взрослые</span>
          <select
            id="trip-adults"
            value={form.adults}
            aria-invalid={Boolean(errors.adults)}
            aria-describedby={errors.adults ? "trip-adults-error" : undefined}
            onChange={(event) => update("adults", Number(event.target.value))}
          >
            {[1, 2, 3, 4, 5, 6].map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
          {errors.adults && (
            <small className="trip-search-field-error" id="trip-adults-error">
              {errors.adults}
            </small>
          )}
        </label>
        <label className="trip-search-field" htmlFor="trip-children">
          <span>Дети</span>
          <select
            id="trip-children"
            value={form.children}
            aria-invalid={Boolean(errors.children)}
            aria-describedby={
              errors.children ? "trip-children-error" : undefined
            }
            onChange={(event) => update("children", Number(event.target.value))}
          >
            {[0, 1, 2, 3, 4].map((value) => (
              <option value={value} key={value}>
                {value === 0 ? "Без детей" : value}
              </option>
            ))}
          </select>
          {errors.children && (
            <small className="trip-search-field-error" id="trip-children-error">
              {errors.children}
            </small>
          )}
        </label>
      </div>
      <div className="trip-search-duration" role="status" aria-live="polite">
        <CalendarDays size={17} aria-hidden="true" />
        <span>
          {nights > 0
            ? `${nights} ${nightsText} в Пусане`
            : "Выберите даты вашей поездки"}
        </span>
      </div>
      <button type="submit" className="button primary trip-search-submit">
        Выбрать пожелания <ArrowRight size={19} aria-hidden="true" />
      </button>
      <p className="trip-search-next">
        На следующем шаге: пляж, тишина и другие важные вам условия.
      </p>
    </form>
  );
}
