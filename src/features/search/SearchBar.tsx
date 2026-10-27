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
import { regionDetails } from "../../../shared/regions";
import { changeTripRegion } from "./searchPolicy";

export function SearchBar({
  trip,
  onSearch,
  busy = false,
  regions = [trip.region],
}: {
  trip: Trip;
  onSearch: (trip: Trip) => void;
  busy?: boolean;
  regions?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(trip);
  const [submitted, setSubmitted] = useState(false);
  const issues = submitted ? searchTripIssues(draft) : [];
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
            <strong>{regionDetails(trip.region)?.label || trip.region}</strong>
            <small>
              {dates} · {guests}
            </small>
          </span>
          <ChevronDown size={22} aria-hidden="true" />
        </button>
        <button className="search-bar-destination" type="button" onClick={edit} aria-haspopup="dialog">
          <MapPin size={23} aria-hidden="true" />
          <span>
            <small>Куда едем</small>
            <strong>{regionDetails(trip.region)?.label || trip.region}</strong>
          </span>
          <ChevronDown size={21} aria-hidden="true" />
        </button>
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
        <p className="search-dialog-intro">Один номер · наличие на даты уточняйте у отельера</p>
        <form onSubmit={submit}>
          <div className="search-trip-fields">
            <label className="field">
              <span>Направление</span>
              <select name="region" value={draft.region}
                aria-invalid={issues.some((issue) => issue.field === "region")}
                onChange={(event) => setDraft(changeTripRegion(draft, event.target.value))}>
                {(regions.length ? regions : [trip.region]).map((region) => <option key={region} value={region}>{regionDetails(region)?.label || region}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Заезд</span>
              <input
                name="checkIn"
                type="date"
                required
                min={searchToday(draft.region)}
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
                min={nextSearchDate(draft.checkIn) || searchToday(draft.region)}
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
            {!hasSearchDates(draft) && <button className="button secondary" type="button" onClick={() => {
              onSearch({ ...draft, checkIn: "", checkOut: "" });
              setOpen(false);
            }}>Показать каталог без дат</button>}
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
