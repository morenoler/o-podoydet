import type { Trip } from "../../../shared/types";
import { tripSchema } from "../../../shared/validation";
import { regionDetails } from "../../../shared/regions";
import { changeTripRegion } from "./searchPolicy";

export function canSearch(trip: Trip) {
  return tripSchema.safeParse(trip).success;
}

/** The dates shown in the summary do not depend on hidden wishes or saved scenarios. */
export function hasSearchDates(trip: Pick<Trip, "checkIn" | "checkOut">) {
  return tripSchema.shape.checkIn.safeParse(trip.checkIn).success
    && tripSchema.shape.checkOut.safeParse(trip.checkOut).success
    && trip.checkOut > trip.checkIn;
}

export interface SearchTripIssue {
  field: keyof Trip | "form";
  message: string;
}

export function searchTripIssues(trip: Trip): SearchTripIssue[] {
  const result = tripSchema.safeParse(trip);
  if (result.success) return [];
  const issues = new Map<SearchTripIssue["field"], string>();
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] || "form") as SearchTripIssue["field"];
    const message = {
      checkIn: "Укажите корректную дату заезда.",
      checkOut: tripSchema.shape.checkOut.safeParse(trip.checkOut).success
        && tripSchema.shape.checkIn.safeParse(trip.checkIn).success
        ? "Выезд должен быть позже заезда." : "Укажите корректную дату выезда.",
      adults: "Выберите от 1 до 6 взрослых.",
      children: "Выберите от 0 до 4 детей.",
      region: "Выберите доступное направление: Пусан или Сочи.",
      scenarios: issue.code === "custom" ? "Сценарии поездки повторяются. Выберите каждый сценарий только один раз."
        : "Проверьте сценарии поездки: доступны «Отдых у моря», «Поездка с детьми» и «Спокойный отдых».",
      preferences: issue.code === "custom" ? "Пожелания повторяются. Выберите каждое условие только один раз."
        : issue.code === "too_big" ? "Можно выбрать не больше 8 пожеланий."
        : "Проверьте сохранённые пожелания и их обязательность в настройках поиска.",
      text: typeof trip.text === "string" && trip.text.length > 1500
        ? "Сократите особое пожелание до 1500 символов."
        : "Проверьте текст особого пожелания в настройках поиска.",
      admissionMode: "Выберите режим допуска в настройках поиска.",
      preferenceOverrides: "Проверьте изменения пожеланий в настройках поиска или сбросьте чат и его фильтры.",
      hotelFilters: "Проверьте тип размещения, текст поиска, предел цены и длину маршрута в фильтрах.",
      form: "Проверьте параметры поездки и пожелания.",
    }[field] || "Проверьте параметры поездки и пожелания.";
    issues.set(field, message);
  }
  return [...issues].map(([field, message]) => ({ field, message }));
}

/** Submit actual control values, including a date edit that has not reached React state yet. */
export function readSearchForm(trip: Trip, fields: Pick<FormData, "get">): Trip {
  return {
    ...changeTripRegion(trip, String(fields.get("region") ?? trip.region)),
    checkIn: String(fields.get("checkIn") ?? ""),
    checkOut: String(fields.get("checkOut") ?? ""),
    adults: Number(fields.get("adults") ?? NaN),
    children: Number(fields.get("children") ?? NaN),
  };
}

export function nextSearchDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function searchToday(region = "Пусан") {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: regionDetails(region)?.timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
