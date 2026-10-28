import { useEffect, useState, type CSSProperties, type FormEvent, type MouseEvent } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Minus,
  Plus,
  MapPin,
  Search,
  UserRound,
} from "lucide-react";
import type { Trip } from "../../../shared/types";
import { Modal } from "../../shared/ui/Modal";
import { canSearch, hasSearchDates, nextSearchDate, readSearchForm, searchToday, searchTripIssues } from "./searchTrip";
import { regionDetails } from "../../../shared/regions";
import { changeTripRegion } from "./searchPolicy";

type SearchPanel = "trip" | "region" | "dates" | "guests";

export function SearchBar({
  trip,
  onSearch,
  busy = false,
  regions = [trip.region],
  onChange,
  variant = "inline",
  destinationLabel,
  searchDisabled = false,
}: {
  trip: Trip;
  onSearch: (trip: Trip) => void;
  busy?: boolean;
  regions?: string[];
  /** The landing screen edits the trip without navigating until Find is pressed. */
  onChange?: (trip: Trip, field: SearchPanel) => void;
  variant?: "inline" | "landing";
  destinationLabel?: string;
  searchDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<SearchPanel>("trip");
  const [anchor, setAnchor] = useState({ left: 16, top: 140 });
  const [month, setMonth] = useState(() => (hasSearchDates(trip) ? trip.checkIn : searchToday(trip.region)).slice(0, 7));
  const [draft, setDraft] = useState(trip);
  const [submitted, setSubmitted] = useState(false);
  const [regionQuery, setRegionQuery] = useState("");
  const issues = submitted ? searchTripIssues(draft) : [];
  useEffect(() => {
    setDraft(trip);
  }, [trip]);
  function edit(nextPanel: SearchPanel = "trip", event?: MouseEvent<HTMLButtonElement>) {
    setDraft(trip);
    setSubmitted(false);
    setPanel(nextPanel);
    setRegionQuery("");
    setMonth((hasSearchDates(trip) ? trip.checkIn : searchToday(trip.region)).slice(0, 7));
    if (event) {
      const bounds = event.currentTarget.getBoundingClientRect();
      setAnchor({ left: bounds.left - (nextPanel === "dates" ? 23 : 0), top: bounds.bottom + 15 });
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
  const dates = searchDatesLabel(trip);
  const guests = `${trip.adults} ${trip.adults === 1 ? "взрослый" : "взрослых"}${trip.children ? `, ${trip.children} дет.` : ""}`;
  const allFields = panel === "trip";
  const titles: Record<SearchPanel, string> = { trip: "Ваша поездка", region: "Куда едем", dates: "Даты поездки", guests: "Гости" };
  const availableRegions = regions.length ? regions : [trip.region];
  const matchingRegions = availableRegions.filter((region) => {
    const aliases = region === "Пусан" ? "пусан busan pusan южная корея korea" : region === "Сочи" ? "сочи sochi россия russia" : region;
    return aliases.toLocaleLowerCase("ru-RU").includes(regionQuery.trim().toLocaleLowerCase("ru-RU"));
  });
  function change(next: Trip, field: SearchPanel) { if (onChange) onChange(next, field); else onSearch(next); }
  function selectDate(day: string) {
    const next = selectSearchDate(draft, day);
    setDraft(next);
    if (next.checkOut) { change(next, "dates"); setOpen(false); }
  }
  return (
    <div className={`figcraft-search-controls${variant === "landing" ? " is-landing" : ""}`} style={{ "--trip-popover-left": `${anchor.left}px`, "--trip-popover-top": `${anchor.top}px` } as CSSProperties}>
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
            <strong>{destinationLabel || trip.region}</strong>
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
          className="search-bar-field search-bar-guests"
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
          disabled={busy || searchDisabled}
          aria-label={busy ? "Ищем варианты" : "Найти"}
          aria-describedby={variant === "landing" && searchDisabled ? "landing-coverage-note" : undefined}
          onClick={() => (canSearch(trip) ? onSearch(trip) : edit())}
        >
          <Search size={22} aria-hidden="true" />
          <span className={variant === "landing" ? "search-bar-submit-label" : "sr-only"}>{busy ? "Ищем…" : "Найти"}</span>
        </button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={titles[panel]}
        className={`search-trip-modal figcraft-trip-modal is-${panel}${variant === "landing" ? " is-landing-popover" : ""}`}
      >
        {panel === "region" ? <div className="figcraft-region-list">
          {variant === "landing" && <label className="landing-destination-search"><span className="sr-only">Найти город</span><Search size={18} aria-hidden="true" /><input type="search" value={regionQuery} onChange={(event) => setRegionQuery(event.target.value)} placeholder="Найти город" autoComplete="off" /></label>}
          {matchingRegions.map((region) => <button key={region} type="button" aria-pressed={!destinationLabel && trip.region === region}
            onClick={() => { change(changeTripRegion(trip, region), "region"); setOpen(false); }}>
            <span><strong>{region}</strong><small>{regionDetails(region)?.country || "Доступное направление"}</small></span>
            {!destinationLabel && trip.region === region && <Check size={19} aria-hidden="true" />}
          </button>)}
          {!matchingRegions.length && <p className="landing-destination-empty" role="status">Такого города пока нет в каталоге. Доступны {availableRegions.join(" и ")}.</p>}
        </div> : panel === "dates" ? <>
          <p className="sr-only" aria-live="polite">{draft.checkIn && !draft.checkOut ? "Выберите день выезда." : "Выберите день заезда, затем день выезда. Даты применятся автоматически."}</p>
          <SearchMonthCalendar month={month} onMonth={setMonth} start={draft.checkIn} end={draft.checkOut}
            today={searchToday(draft.region)} onSelect={selectDate} onEdit={() => setPanel("trip")} />
        </> : panel === "guests" ? <div className="figcraft-guests">
          {([{ key: "adults", label: "Взрослые", hint: "От 18 лет", min: 1, max: 6 },
            { key: "children", label: "Дети", hint: "До 18 лет", min: 0, max: 4 }] as const).map(({ key, label, hint, min, max }) =>
            <div className="figcraft-guest-row" key={key}>
              <span><strong>{label}</strong><small>{hint}</small></span>
              <div><button type="button" aria-label={`Уменьшить: ${label.toLowerCase()}`} disabled={draft[key] <= min}
                onClick={() => setDraft({ ...draft, [key]: draft[key] - 1 })}><Minus size={16} /></button>
                <output aria-live="polite" aria-label={label}>{draft[key]}</output>
                <button type="button" aria-label={`Увеличить: ${label.toLowerCase()}`} disabled={draft[key] >= max}
                  onClick={() => setDraft({ ...draft, [key]: draft[key] + 1 })}><Plus size={16} /></button></div>
            </div>)}
          <div className="search-dialog-footer"><button className="button primary" type="button" disabled={busy}
            onClick={() => { change(draft, "guests"); setOpen(false); }}>Применить</button></div>
        </div> : <>
        {allFields && <p className="search-dialog-intro">Один номер · наличие на даты уточняйте у отельера</p>}
        <form onSubmit={submit}>
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
            {allFields ? <>
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
            {allFields ? <>
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
          <p className="search-dialog-intro">Один номер. Наличие на даты уточняйте у отельера.</p>
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

export function selectSearchDate(trip: Trip, day: string): Trip {
  return !trip.checkIn || trip.checkOut || day <= trip.checkIn
    ? { ...trip, checkIn: day, checkOut: "" } : { ...trip, checkOut: day };
}

export function searchDatesLabel(trip: Pick<Trip, "checkIn" | "checkOut">) {
  if (!hasSearchDates(trip)) return "Выберите даты";
  const sameMonth = trip.checkIn.slice(0, 7) === trip.checkOut.slice(0, 7);
  const sameYear = trip.checkIn.slice(0, 4) === trip.checkOut.slice(0, 4);
  const format = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
  const start = sameMonth ? String(Number(trip.checkIn.slice(8))) : format.format(new Date(`${trip.checkIn}T12:00:00Z`));
  return `${start} — ${format.format(new Date(`${trip.checkOut}T12:00:00Z`))}`;
}

export function SearchMonthCalendar({ month, onMonth, start, end, today, onSelect, onEdit }: {
  month: string; onMonth: (month: string) => void; start: string; end: string; today: string; onSelect: (day: string) => void;
  onEdit?: () => void;
}) {
  const first = new Date(`${month}-01T12:00:00Z`);
  const year = first.getUTCFullYear(), index = first.getUTCMonth();
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const monthLabel = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(first).replace(/\s*г\.$/, "");
  const changeMonth = (direction: number) => {
    const next = new Date(Date.UTC(year, index + direction, 1, 12));
    onMonth(next.toISOString().slice(0, 7));
  };
  return <div className="figcraft-calendar">
    <div className="figcraft-calendar-heading">
      <button type="button" aria-label="Предыдущий месяц" onClick={() => changeMonth(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
      {onEdit ? <button type="button" className="figcraft-calendar-edit" onClick={onEdit}
        aria-label={`${monthLabel}. Ввести или сбросить даты`} title="Ввести или сбросить даты"><strong aria-live="polite">{monthLabel}</strong></button>
        : <strong aria-live="polite">{monthLabel}</strong>}
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
          className={`${selected ? "is-selected" : ""} ${day === start ? "is-start" : ""} ${day === end ? "is-end" : ""} ${start && end && day >= start && day <= end ? "is-range" : ""}`}
          onClick={() => onSelect(day)}>{i + 1}</button>;
      })}
    </div>
  </div>;
}
