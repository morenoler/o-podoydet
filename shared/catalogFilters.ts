import type { CatalogSearchSnippet, Fact, Hotel, HotelFilters, Room } from "./types";
import { matchesNearby } from "./nearby";

// Keep these deliberately small aliases in sync with application/HotelFilters.java.
// Translating a word only expands retrieval; it never upgrades evidence about an amenity.
const aliases: Record<string, string> = Object.fromEntries([
  ["suite", "suites", "люкс", "люксы", "люкса", "люксе"],
  ["twin", "твин"],
  ["double", "дабл"],
  ["deluxe", "делюкс", "делюксом"],
  ["standard", "стандарт", "стандартный"],
  ["family", "семейный", "семейная", "семейные", "семейного"],
  ["balcony", "балкон", "балконом", "балкона", "балконе"],
  ["terrace", "терраса", "террасой", "террасы", "террасе"],
  ["kitchen", "kitchenette", "кухня", "кухней", "кухни", "кухне"],
  ["pool", "бассейн", "бассейном", "бассейна", "бассейне"],
  ["parking", "парковка", "парковкой", "парковки", "парковке"],
  ["breakfast", "завтрак", "завтраком", "завтрака", "завтраки"],
  ["sauna", "сауна", "сауной", "сауны", "сауне"],
  ["gym", "fitness", "спортзал", "спортзалом", "спортзала", "фитнес"],
  ["airconditioning", "airconditioned", "кондиционер", "кондиционером", "кондиционера"],
  ["ocean", "sea", "море", "моря", "морем", "океан", "океана"],
  ["view", "вид", "видом", "вида"],
].flatMap(([canonical, ...words]) => [[canonical, canonical], ...words.map((word) => [word, canonical])]));

function tokens(value: string): string[] {
  return (value.normalize("NFKC").toLowerCase().replaceAll("ё", "е")
    .replace(/\bair[\s-]+condition(?:ing|ed)\b/g, "airconditioning")
    .match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => !["с", "со", "на", "и", "в", "во", "для", "the", "with", "a", "an", "and", "in", "of"].includes(word))
    .map((word) => aliases[word] ?? word);
}

function fields(hotel: Hotel, facts: Fact[], room?: Room): CatalogSearchSnippet[] {
  const values: CatalogSearchSnippet[] = [
    { field: "name", text: hotel.name }, { field: "address", text: hotel.address },
  ];
  if (room) {
    values.push({ field: "room", text: room.name, roomId: room.id, sourceUrl: room.sourceUrl, ...sourceDates(room) });
    if (room.quote) values.push({ field: "quote", text: room.quote, roomId: room.id, sourceUrl: room.sourceUrl, ...sourceDates(room) });
  }
  for (const fact of facts) {
    if (fact.hotelId !== hotel.id || (fact.roomId && fact.roomId !== room?.id)) continue;
    // Demo quotes must not be used to retrieve a real object.
    if (fact.demo && !hotel.synthetic && !room?.demo) continue;
    values.push({ field: "quote", text: fact.quote, sourceUrl: fact.sourceUrl, roomId: fact.roomId, factId: fact.id, ...sourceDates(fact) });
  }
  return values.filter((value) => value.text?.trim());
}

function sourceDates(source: Partial<Fact>): Pick<CatalogSearchSnippet, "obtainedAt" | "sourceDate" | "expiresAt"> {
  return Object.fromEntries(["obtainedAt", "sourceDate", "expiresAt"].flatMap((key) => {
    const value = source[key as keyof Fact];
    return typeof value === "string" && value ? [[key, value]] : [];
  }));
}

function matchesQuery(hotel: Hotel, query: string, facts: Fact[], room?: Room): boolean {
  const requested = tokens(query);
  if (!query.trim()) return true;
  if (!requested.length) return false;
  const available = new Set(fields(hotel, facts, room).flatMap((value) => tokens(value.text)));
  // Prefixes support partial names; short words must match a complete token.
  return requested.every((word) => [...available].some((value) => value === word || (word.length >= 3 && value.startsWith(word))));
}

export function countHotelFilters(filters?: HotelFilters): number {
  if (!filters) return 0;
  return Number(Boolean(filters.query?.trim())) + Number(Boolean(filters.lodgingTypes?.length))
    + Number(filters.maxPricePerNight !== undefined) + Number(filters.maxBeachMeters !== undefined) + (filters.nearby?.length || 0);
}

export function hasHotelFilters(filters?: HotelFilters): boolean {
  return countHotelFilters(filters) > 0;
}

/** Preview only; the server repeats all limits against its captured catalog/evidence snapshot. */
export function matchesHotelFilters(hotel: Hotel, filters?: HotelFilters, facts: Fact[] = [], room?: Room): boolean {
  if (!hasHotelFilters(filters)) return true;
  if (!matchesNearby(hotel, filters)) return false;
  if (filters?.lodgingTypes?.length && (!hotel.lodgingType || !filters.lodgingTypes.includes(hotel.lodgingType))) return false;
  if (filters?.maxPricePerNight !== undefined && (
    hotel.currency !== "KRW" || typeof hotel.pricePerNight !== "number" || !Number.isFinite(hotel.pricePerNight)
    || hotel.pricePerNight <= 0 || hotel.pricePerNight > filters.maxPricePerNight
  )) return false;
  if (filters?.maxBeachMeters !== undefined && (
    !hotel.route || !Number.isFinite(hotel.route.meters) || hotel.route.meters < 0 || hotel.route.meters > filters.maxBeachMeters
  )) return false;
  if (!filters?.query?.trim()) return true;
  // Never combine words from different categories to manufacture a matching room.
  return room ? matchesQuery(hotel, filters.query, facts, room)
    : hotel.rooms.length ? hotel.rooms.some((candidate) => matchesQuery(hotel, filters.query!, facts, candidate))
      : matchesQuery(hotel, filters.query, facts);
}

export function matchingCatalogSnippets(hotel: Hotel, filters?: HotelFilters, facts: Fact[] = [], room?: Room): CatalogSearchSnippet[] {
  const requested = tokens(filters?.query ?? "");
  if (!requested.length) return [];
  return fields(hotel, facts, room).filter((value) => tokens(value.text).some((word) =>
    requested.some((term) => word === term || (term.length >= 3 && word.startsWith(term))))).slice(0, 4);
}
