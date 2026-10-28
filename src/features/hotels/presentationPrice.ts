import type { Hotel, Room } from "../../../shared/types";
import { accountListingId } from "../../shared/lib/accommodation";

/** Keep the amount and currency on the same room; a property price is not a category offer. */
export function accommodationPrice(hotel: Hotel, room?: Room): { amount: number; currency: "RUB" | "KRW" } | null {
  const singleOwnerUnit = !!accountListingId(hotel) && hotel.rooms.length === 1 && hotel.rooms[0].id === room?.id;
  const source = room && !(singleOwnerUnit && room.pricePerNight == null && room.currency == null) ? room : hotel;
  const amount = source.pricePerNight, currency = source.currency;
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0 && (currency === "RUB" || currency === "KRW")
    ? { amount, currency } : null;
}
