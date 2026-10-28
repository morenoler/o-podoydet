import type { Dataset, Hotel, HotelMatch, Room, RoomRecommendation } from "../../../shared/types";
import { accountListingId } from "../../shared/lib/accommodation";

export interface RoomSearchItem {
  id: string;
  hotel: Hotel;
  room: Room;
  recommendation?: RoomRecommendation;
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
  return [...new Map(items.filter(({ hotel }) => hotel.coordinates && !hotel.synthetic).map(({ hotel }) => [hotel.id, hotel])).values()];
}
