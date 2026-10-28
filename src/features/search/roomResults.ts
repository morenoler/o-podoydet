import type { Dataset, Hotel, HotelCandidate, HotelFilters, HotelMatch, Room, RoomRecommendation } from "../../../shared/types";
import { matchesHotelFilters, matchingCatalogSnippets } from "../../../shared/catalogFilters";
import { nearbyMatches } from "../../../shared/nearby";
import { regionDetails } from "../../../shared/regions";
import { accountListingId } from "../../shared/lib/accommodation";
import { accommodationPrice } from "../hotels/presentationPrice";

export interface RoomSearchItem {
  id: string;
  hotel: Hotel;
  room: Room;
  recommendation?: RoomRecommendation;
}

/** Fictional lab rooms remain evaluable even though they are not collected real categories. */
export function hasEvaluableRooms(hotel: Hotel): boolean {
  return hotel.rooms.some((room) => (hotel.synthetic && room.demo)
    || (hotel.hasCollectedRoomCategories !== false && room.evidenceStatus === "verified"));
}

export function recommendationItem(recommendation: RoomRecommendation): RoomSearchItem {
  return { id: recommendation.id, hotel: recommendation.hotel, room: recommendation.room.room, recommendation };
}

export function recommendationMatch(recommendation: RoomRecommendation): HotelMatch {
  return { hotel: recommendation.hotel, best: recommendation.room, rooms: [recommendation.room], ownerCriteria: recommendation.ownerCriteria, personalWishes: recommendation.personalWishes, locationCriteria: recommendation.locationCriteria };
}

/** Before dates are chosen these are catalog categories, never matching claims. */
export function catalogRooms(catalog: Dataset | null): RoomSearchItem[] {
  return (catalog?.hotels || []).flatMap((hotel) => hotel.rooms
    .filter((room) => room.id && room.name.trim() && !room.id.endsWith("-unverified") &&
      (room.evidenceStatus === "verified" || !!accountListingId(hotel) || (catalog?.evidencePolicy === "demo" && room.demo)))
    .map((room) => ({ id: `${hotel.id}::${room.id}`, hotel, room })));
}

export function roomHotels(items: RoomSearchItem[]): Hotel[] {
  const hotels = new Map<string, Hotel>();
  for (const { hotel, room } of items) {
    if (!hotel.coordinates || hotel.synthetic || hotels.has(hotel.id)) continue;
    // Selecting a hotel opens its first result, so its marker uses that same room's offer.
    const offer = accommodationPrice(hotel, room);
    hotels.set(hotel.id, { ...hotel, pricePerNight: offer?.amount, currency: offer?.currency });
  }
  return [...hotels.values()];
}

/** Hotel presence on the map does not establish a room category or capacity. */
export function catalogHotelCandidates(catalog: Dataset | null, filters?: HotelFilters): HotelCandidate[] {
  return (catalog?.hotels || []).filter((hotel) => !hotel.synthetic && !accountListingId(hotel) && !hotel.hasCollectedRoomCategories
    && !hotel.rooms.some((room) => room.evidenceStatus === "verified" && room.scope === "room_category"))
    .map((hotel) => ({ ...hotel, rooms: [] }))
    .filter((hotel) => matchesHotelFilters(hotel, filters, catalog?.facts, undefined, regionDetails(catalog?.region || "")?.currency))
    .map((hotel) => ({ hotel, nearbyMatches: nearbyMatches(hotel, filters), catalogMatches: matchingCatalogSnippets(hotel, filters, catalog?.facts),
      limitations: ["Совпадения относятся к расположению отеля. Условия конкретной комнаты и размещение гостей нужно уточнить."] }));
}
