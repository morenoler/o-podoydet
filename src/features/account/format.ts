import type { BookingStatus, WindowDirection } from "../../../shared/account";
import { propertyTimeZone, todayInTimeZone, type RegionCurrency } from "../../../shared/regions";
export function countLabel(count: number, forms: [string, string, string]) {
  const remainder = Math.abs(count) % 100;
  const last = remainder % 10;
  return `${count} ${forms[remainder >= 11 && remainder <= 14 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2]}`;
}
export const price = (value: number, currency: RegionCurrency) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
export const calendarDate = (value: string) =>
  new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
export const bookingLabels: Record<BookingStatus, string> = {
  pending: "Ожидает ответа",
  confirmed: "Подтверждено",
  completed: "Завершено",
  cancelled: "Отменено",
};
export const directionLabels: Record<WindowDirection, string> = {
  north: "север",
  north_east: "северо-восток",
  east: "восток",
  south_east: "юго-восток",
  south: "юг",
  south_west: "юго-запад",
  west: "запад",
  north_west: "северо-запад",
};
export function roomDetailsLabel(
  floor: number | null | undefined,
  directions: WindowDirection[] = [],
) {
  return [
    floor == null ? "Этаж: Не указано" : `${floor} этаж`,
    directions.length
      ? `окна на ${directions.map((direction) => directionLabels[direction]).join(", ")}`
      : "Окна: Не указано",
  ].join(" · ");
}
export function dateRange(from: string, to: string) {
  const first = new Date(`${from}T12:00:00`),
    last = new Date(`${to}T12:00:00`);
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return formatter.formatRange(first, last);
}
/** Booking dates follow the property's current market timezone, the same as the API. */
export const bookingToday = (city = "Пусан") => todayInTimeZone(propertyTimeZone(city));
export function bookingLatestDate(city = "Пусан") {
  const date = new Date(`${bookingToday(city)}T12:00:00`);
  const month = date.getMonth();
  date.setFullYear(date.getFullYear() + 2);
  if (date.getMonth() !== month) date.setDate(0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
