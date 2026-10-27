export const regionNames = ["Пусан", "Сочи"] as const;
export type RegionName = (typeof regionNames)[number];
export type RegionCurrency = "KRW" | "RUB";

const regions = {
  Пусан: { label: "Пусан, Южная Корея", country: "Южная Корея", inName: "в Пусане", currency: "KRW", currencySymbol: "₩", timeZone: "Asia/Seoul", hint: "Подбираем жильё в районе пляжа Хэундэ." },
  Сочи: { label: "Сочи, Россия", country: "Россия", inName: "в Сочи", currency: "RUB", currencySymbol: "₽", timeZone: "Europe/Moscow", hint: "Каталог центральной прибрежной части Сочи по OpenStreetMap. Категории номеров и маршруты пока не собраны." },
} as const;

export function isRegionName(value: unknown): value is RegionName {
  return typeof value === "string" && regionNames.some((region) => region === value);
}

export function regionDetails(region: string) {
  return isRegionName(region) ? regions[region] : undefined;
}

/** Initial map viewport only; it never becomes the listing's selected coordinates. */
export function listingMapCenter(city: string): [number, number] {
  return city.trim().toLocaleLowerCase("ru-RU") === "сочи" ? [39.72, 43.58] : [129.0756, 35.1796];
}

/** Default for a new owner price; existing prices keep their explicitly saved currency. */
export function listingCurrency(city: string): RegionCurrency {
  const region = regionNames.find((name) => name.toLocaleLowerCase("ru-RU") === city.trim().toLocaleLowerCase("ru-RU"));
  return region ? regions[region].currency : "KRW";
}

export function currencySymbol(currency: RegionCurrency) {
  return currency === "RUB" ? "₽" : "₩";
}

export function propertyTimeZone(city: string) {
  return listingCurrency(city) === "RUB" ? "Europe/Moscow" : "Asia/Seoul";
}

export function todayInTimeZone(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function timeZoneLabel(timeZone: string) {
  return timeZone === "Europe/Moscow" ? "Москва, UTC+3" : timeZone === "Asia/Seoul" ? "Сеул, UTC+9" : timeZone;
}

export interface RegionCatalog {
  defaultRegion: string;
  regions: { region: string; hotelCount: number; evidencePolicy: "verified-only" | "demo" }[];
}
