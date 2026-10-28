import { useEffect, useState, type CSSProperties, type FormEvent, type MouseEvent } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
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

type SearchPanel = "trip" | "region" | "dates" | "guests";

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
  const [panel, setPanel] = useState<SearchPanel>("trip");
  const [anchor, setAnchor] = useState({ left: 16, top: 140 });
  const [month, setMonth] = useState(() => (hasSearchDates(trip) ? trip.checkIn : searchToday(trip.region)).slice(0, 7));
  const [draft, setDraft] = useState(trip);
  const [submitted, setSubmitted] = useState(false);
  const issues = submitted ? searchTripIssues(draft) : [];
  useEffect(() => {
    setDraft(trip);
  }, [trip]);
  function edit(nextPanel: SearchPanel = "trip", event?: MouseEvent<HTMLButtonElement>) {
    setDraft(trip);
    setSubmitted(false);
    setPanel(nextPanel);
    setMonth((hasSearchDates(trip) ? trip.checkIn : searchToday(trip.region)).slice(0, 7));
    if (event) {
      const bounds = event.currentTarget.getBoundingClientRect();
      setAnchor({ left: bounds.left, top: bounds.bottom + 16 });
    }
    setOpen(true);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = readSearchForm(draft, new FormData(event.currentTarget));
    setDraft(current);
    setSubmitted(true);
    if (panel === "guests" && !current.checkIn && !current.checkOut) {
      onSearch(current); setOpen(false); return;
    }
    if (searchTripIssues(current).length) {
      return;
    }
    onSearch(current);
    setOpen(false);
  }
  const dates = hasSearchDates(trip)
    ? `${dateLabel(trip.checkIn)} — ${dateLabel(trip.checkOut)}`
    : "Выберите даты";
  const guests = `${trip.adults} ${trip.adults === 1 ? "взрослый" : "взрослых"}${trip.children ? `, ${trip.children} дет.` : ""}`;
  const allFields = panel === "trip";
  const titles: Record<SearchPanel, string> = { trip: "Ваша поездка", region: "Куда едем", dates: "Даты поездки", guests: "Гости" };
  const availableRegions = regions.length ? regions : [trip.region];
  return (
    <div className="figcraft-search-controls" style={{ "--trip-popover-left": `${anchor.left}px`, "--trip-popover-top": `${anchor.top}px` } as CSSProperties}>
      <div className="search-bar figcraft-search-bar" aria-label="Параметры поиска">
        <button
          className="search-bar-mobile"
          type="button"
          onClick={(event) => edit("trip", event)}
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
        <button className="search-bar-destination" type="button" onClick={(event) => edit("region", event)} aria-haspopup="dialog" aria-expanded={open && panel === "region"}>
          <MapPin size={23} aria-hidden="true" />
          <span>
            <small className="sr-only">Куда едем</small>
            <strong>{trip.region}</strong>
          </span>
          <ChevronDown size={21} aria-hidden="true" />
        </button>
        <button
          className="search-bar-field"
          type="button"
          onClick={(event) => edit("dates", event)}
          aria-haspopup="dialog"
          aria-expanded={open && panel === "dates"}
        >
          <CalendarDays size={23} aria-hidden="true" />
          <span>
            <small className="sr-only">Заезд и выезд</small>
            <strong>{dates}</strong>
          </span>
          <ChevronDown size={21} aria-hidden="true" />
        </button>
        <button
          className="search-bar-field"
          type="button"
          onClick={(event) => edit("guests", event)}
          aria-haspopup="dialog"
          aria-expanded={open && panel === "guests"}
        >
          <UserRound size={23} aria-hidden="true" />
          <span>
            <small className="sr-only">Гости · один номер</small>
            <strong>{guests}</strong>
          </span>
          <ChevronDown size={21} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="button primary search-bar-submit"
          disabled={busy}
          aria-label={busy ? "Ищем варианты" : "Найти"}
          onClick={() => (canSearch(trip) ? onSearch(trip) : edit())}
        >
          <Search size={22} aria-hidden="true" />
          <span className="sr-only">{busy ? "Ищем…" : "Найти"}</span>
        </button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={titles[panel]}
        className={`search-trip-modal figcraft-trip-modal is-${panel}`}
      >
        {panel === "region" ? <div className="figcraft-region-list">
          {availableRegions.map((region) => <button key={region} type="button" aria-pressed={trip.region === region}
            onClick={() => { onSearch(changeTripRegion(trip, region)); setOpen(false); }}>
            <span><strong>{region}</strong><small>{regionDetails(region)?.country || "Доступное направление"}</small></span>
            {trip.region === region && <Check size={19} aria-hidden="true" />}
          </button>)}
        </div> : <>
        {allFields && <p className="search-dialog-intro">Один номер · наличие на даты уточняйте у отельера</p>}
        <form onSubmit={submit}>
          {panel === "dates" && <SearchMonthCalendar month={month} onMonth={setMonth} start={draft.checkIn} end={draft.checkOut} today={searchToday(draft.region)}
            onSelect={(day) => setDraft(!draft.checkIn || draft.checkOut || day <= draft.checkIn
              ? { ...draft, checkIn: day, checkOut: "" } : { ...draft, checkOut: day })} />}
          <div className="search-trip-fields">
            {allFields ?
            <label className="field">
              <span>Направление</span>
              <select name="region" value={draft.region}
                aria-invalid={issues.some((issue) => issue.field === "region")}
                onChange={(event) => setDraft(changeTripRegion(draft, event.target.value))}>
                {availableRegions.map((region) => <option key={region} value={region}>{regionDetails(region)?.label || region}</option>)}
              </select>
            </label> : <input type="hidden" name="region" value={draft.region} />}
            {allFields || panel === "dates" ? <>
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
            </> : <><input type="hidden" name="checkIn" value={draft.checkIn} /><input type="hidden" name="checkOut" value={draft.checkOut} /></>}
            {allFields || panel === "guests" ? <>
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
            </> : <><input type="hidden" name="adults" value={draft.adults} /><input type="hidden" name="children" value={draft.children} /></>}
          </div>
          {issues.length > 0 && (
            <div id="search-trip-errors" className="search-form-error" role="alert">
              {issues.map((issue) => <p key={issue.field}>{issue.message}</p>)}
            </div>
          )}
          <p className="search-dialog-intro">{panel === "dates" ? "Выберите день заезда и день выезда." : "Один номер. Наличие на даты уточняйте у отельера."}</p>
          <div className="search-dialog-footer">
            {!hasSearchDates(draft) && <button className="button secondary" type="button" aria-label="Показать каталог без дат" onClick={() => {
              onSearch({ ...draft, checkIn: "", checkOut: "" });
              setOpen(false);
            }}>{allFields ? "Показать каталог без дат" : "Без дат"}</button>}
            <button className="button primary" type="submit" disabled={busy}>
              {allFields ? "Найти отель" : "Применить"}
            </button>
          </div>
        </form>
        </>}
      </Modal>
    </div>
  );
}

export function SearchMonthCalendar({ month, onMonth, start, end, today, onSelect }: {
  month: string; onMonth: (month: string) => void; start: string; end: string; today: string; onSelect: (day: string) => void;
}) {
  const first = new Date(`${month}-01T12:00:00Z`);
  const year = first.getUTCFullYear(), index = first.getUTCMonth();
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const changeMonth = (direction: number) => {
    const next = new Date(Date.UTC(year, index + direction, 1, 12));
    onMonth(next.toISOString().slice(0, 7));
  };
  return <div className="figcraft-calendar">
    <div className="figcraft-calendar-heading">
      <button type="button" aria-label="Предыдущий месяц" onClick={() => changeMonth(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
      <strong aria-live="polite">{new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(first)}</strong>
      <button type="button" aria-label="Следующий месяц" onClick={() => changeMonth(1)}><ChevronRight size={18} aria-hidden="true" /></button>
    </div>
    <div className="figcraft-calendar-days" aria-label="Выбор дат">
      {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((day) => <span className="figcraft-calendar-weekday" key={day}>{day}</span>)}
      {Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} aria-hidden="true" />)}
      {Array.from({ length: count }, (_, i) => {
        const day = `${month}-${String(i + 1).padStart(2, "0")}`;
        const selected = day === start || day === end;
        return <button type="button" key={day} disabled={day < today} aria-pressed={selected}
          aria-label={`${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}${day === start ? ", заезд" : day === end ? ", выезд" : ""}`}
          className={`${selected ? "is-selected" : ""} ${start && end && day > start && day < end ? "is-range" : ""}`}
          onClick={() => onSelect(day)}>{i + 1}</button>;
      })}
    </div>
  </div>;
}
