import { useEffect, useState, type FormEvent } from "react";
import {
  CalendarDays,
  ChevronDown,
  MapPin,
  Search,
  UserRound,
} from "lucide-react";
import type { Trip } from "../../../shared/types";
import { Modal } from "../../shared/ui/Modal";
import { dateLabel } from "../../shared/lib/date";
import { canSearch, hasSearchDates, nextSearchDate, readSearchForm, searchToday, searchTripIssues } from "./searchTrip";

export function SearchBar({
  trip,
  onSearch,
  busy = false,
}: {
  trip: Trip;
  onSearch: (trip: Trip) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(trip);
  const [submitted, setSubmitted] = useState(false);
  const issues = submitted ? searchTripIssues({ ...draft, region: "Пусан" }) : [];
  useEffect(() => {
    setDraft(trip);
  }, [trip]);
  function edit() {
    setDraft(trip);
    setSubmitted(false);
    setOpen(true);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = readSearchForm(draft, new FormData(event.currentTarget));
    setDraft(current);
    setSubmitted(true);
    if (searchTripIssues(current).length) {
      return;
    }
    onSearch(current);
    setOpen(false);
  }
  const dates = hasSearchDates(trip)
    ? `${dateLabel(trip.checkIn)} — ${dateLabel(trip.checkOut)}`
    : "Выберите даты";
  const guests = `${trip.adults} взр.${trip.children ? ` · ${trip.children} дет.` : ""} · 1 номер`;
  return (
    <>
      <div className="search-bar" aria-label="Параметры поиска">
        <button
          className="search-bar-mobile"
          type="button"
          onClick={edit}
          aria-haspopup="dialog"
        >
          <MapPin aria-hidden="true" size={25} />
          <span>
            <strong>Пусан, Южная Корея</strong>
            <small>
              {dates} · {guests}
            </small>
          </span>
          <ChevronDown size={22} aria-hidden="true" />
        </button>
        <div className="search-bar-destination">
          <MapPin size={23} aria-hidden="true" />
          <span>
            <small>Куда едем</small>
            <strong>Пусан, Южная Корея</strong>
          </span>
        </div>
        <button
          className="search-bar-field"
          type="button"
          onClick={edit}
          aria-haspopup="dialog"
        >
          <CalendarDays size={23} aria-hidden="true" />
          <span>
            <small>Заезд и выезд</small>
            <strong>{dates}</strong>
          </span>
          <ChevronDown size={21} aria-hidden="true" />
        </button>
        <button
          className="search-bar-field"
          type="button"
          onClick={edit}
          aria-haspopup="dialog"
        >
          <UserRound size={23} aria-hidden="true" />
          <span>
            <small>Гости и номера</small>
            <strong>{guests}</strong>
          </span>
          <ChevronDown size={21} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="button primary search-bar-submit"
          disabled={busy}
          onClick={() => (canSearch(trip) ? onSearch(trip) : edit())}
        >
          <Search size={22} aria-hidden="true" />
          {busy ? "Ищем…" : "Найти"}
        </button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Ваша поездка"
        className="search-trip-modal"
      >
        <p className="search-dialog-intro">Пусан, Южная Корея · один номер</p>
        <form onSubmit={submit}>
          <div className="search-trip-fields">
            <label className="field">
              <span>Заезд</span>
              <input
                name="checkIn"
                type="date"
                required
                min={searchToday()}
                value={draft.checkIn}
                aria-invalid={issues.some((issue) => issue.field === "checkIn")}
                aria-describedby={issues.some((issue) => issue.field === "checkIn") ? "search-trip-errors" : undefined}
                onChange={(event) =>
                  setDraft({ ...draft, checkIn: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Выезд</span>
              <input
                name="checkOut"
                type="date"
                required
                min={nextSearchDate(draft.checkIn) || searchToday()}
                value={draft.checkOut}
                aria-invalid={issues.some((issue) => issue.field === "checkOut")}
                aria-describedby={issues.some((issue) => issue.field === "checkOut") ? "search-trip-errors" : undefined}
                onChange={(event) =>
                  setDraft({ ...draft, checkOut: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Взрослые</span>
              <select
                name="adults"
                value={draft.adults}
                aria-invalid={issues.some((issue) => issue.field === "adults")}
                aria-describedby={issues.some((issue) => issue.field === "adults") ? "search-trip-errors" : undefined}
                onChange={(event) =>
                  setDraft({ ...draft, adults: Number(event.target.value) })
                }
              >
                {[1, 2, 3, 4, 5, 6].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Дети</span>
              <select
                name="children"
                value={draft.children}
                aria-invalid={issues.some((issue) => issue.field === "children")}
                aria-describedby={issues.some((issue) => issue.field === "children") ? "search-trip-errors" : undefined}
                onChange={(event) =>
                  setDraft({ ...draft, children: Number(event.target.value) })
                }
              >
                {[0, 1, 2, 3, 4].map((value) => (
                  <option key={value} value={value}>
                    {value || "Без детей"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {issues.length > 0 && (
            <div id="search-trip-errors" className="search-form-error" role="alert">
              {issues.map((issue) => <p key={issue.field}>{issue.message}</p>)}
            </div>
          )}
          <p className="search-dialog-intro">
            Проверим, какие варианты подходят вашей компании. Наличие на даты
            поездки уточняйте у отельера.
          </p>
          <div className="search-dialog-footer">
            <button className="button primary" type="submit">
              <Search size={18} aria-hidden="true" />
              Найти отель
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
