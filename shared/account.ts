import type { AmenityStates, AmenityEvidenceMap } from "./amenities";
import type { RegionCurrency } from "./regions";
/** Personal accounts API contract. Amounts use their explicit currency; dates are ISO calendar dates. */
export type AccountRole = "user" | "host";
export interface AccountUser {
  id: string;
  role: AccountRole;
  name: string;
  email: string;
  phone: string;
  about: string;
  createdAt: string;
}
export interface AuthResponse {
  user: AccountUser | null;
}
export type ListingStatus = "draft" | "published";
/** Coordinates selected by the owner: longitude, latitude. Not a verified entrance. */
export type ListingCoordinates = [number, number];
export type BedType = "single" | "double" | "sofa" | "bunk" | "folding" | "futon" | "crib" | "other";
export interface ListingBed {
  type: BedType;
  count: number;
  placesPerUnit: number;
  /** Owner's room label, e.g. Bedroom 1; empty means the room was not specified. */
  room?: string;
}
export interface ListingInput {
  amenityStates?: AmenityStates;
  title: string;
  description: string;
  city: string;
  address: string;
  roomType: string;
  capacity: number;
  pricePerNight: number;
  /** Explicit for new forms. Omission retains the legacy server contract. */
  currency?: RegionCurrency;
  amenities: string[];
  status: ListingStatus;
  floor?: number | null;
  windowDirections?: WindowDirection[];
  photos?: string[];
  coordinates?: ListingCoordinates | null;
  sleepingPlaces?: number | null;
  beds?: ListingBed[];
}
export interface Listing extends ListingInput {
  amenityEvidence?: AmenityEvidenceMap;
  id: string;
  hostId: string;
  hostName: string;
  currency: RegionCurrency;
  createdAt: string;
  updatedAt: string;
  floor: number | null;
  windowDirections: WindowDirection[];
  photos: string[];
  /** Set only by the explicit synthetic fixture importer, never by a public form. */
  demo?: boolean;
}
export type WindowDirection = "north" | "north_east" | "east" | "south_east" | "south" | "south_west" | "west" | "north_west";
/** Private owner-only material. Never include this in public listing/search DTOs. */
export interface ListingSearchProfile {
  notes: string;
}
export interface HostListingInput extends ListingInput { searchProfile?: ListingSearchProfile }
export interface HostListing extends Listing { searchProfile: ListingSearchProfile }
export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
export interface Booking {
  id: string;
  listingId: string;
  listingTitle: string;
  city: string;
  address: string;
  userId: string;
  guestName: string;
  guestEmail: string;
  hostId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  nights: number;
  pricePerNight: number;
  totalPrice: number;
  currency: RegionCurrency;
  status: BookingStatus;
  note: string;
  /** Private owner message; it does not confirm a booking, payment, or search condition. */
  hostReply?: string;
  repliedAt?: string;
  createdAt: string;
  updatedAt: string;
  photos: string[];
  roomType: string;
}
export interface ListingQuestion {
  id: string;
  listingId: string;
  listingTitle: string;
  userId: string;
  guestName: string;
  text: string;
  answer: string | null;
  status: "open" | "answered";
  createdAt: string;
  answeredAt: string | null;
}
