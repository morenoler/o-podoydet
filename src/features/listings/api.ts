import type { Booking, ListingQuestion } from "../../../shared/account";
import { api } from "../../shared/api/client";

export const listingsApi = {
  book: (
    id: string,
    input: { checkIn: string; checkOut: string; guests: number; note: string },
  ) => api<Booking>(`/listings/${id}/bookings`, input),
  ask: (id: string, text: string) =>
    api<ListingQuestion>(`/listings/${id}/questions`, { text }),
};
