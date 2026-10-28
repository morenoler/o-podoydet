import type {
  HostListing,
  HostListingInput,
  ListingSearchProfile,
  ListingCoordinates,
  ListingBed,
  WindowDirection,
} from "../../../../shared/account";
import { sleepingPlacesTotal } from "../../../../shared/listingDetails";
import { listingCurrency, type RegionCurrency } from "../../../../shared/regions";

export type EditableListing = HostListingInput & {
  currency: RegionCurrency;
  floor: number | null;
  windowDirections: WindowDirection[];
  photos: string[];
  coordinates: ListingCoordinates | null;
  sleepingPlaces: number | null;
  beds: ListingBed[];
  searchProfile: ListingSearchProfile;
};
export function editableListing(listing?: HostListing): EditableListing {
  return listing
    ? {
        title: listing.title,
        description: listing.description,
        city: listing.city,
        address: listing.address,
        roomType: listing.roomType,
        capacity: listing.capacity,
        pricePerNight: listing.pricePerNight,
        amenityStates: { ...(listing.amenityStates || {}) },
        currency: listing.currency,
        amenities: [...listing.amenities],
        status: listing.status,
        floor: listing.floor ?? null,
        windowDirections: [...(listing.windowDirections || [])],
        photos: [...(listing.photos || [])],
        coordinates: listing.coordinates ? [...listing.coordinates] : null,
        sleepingPlaces: listing.sleepingPlaces ?? null,
        beds: (listing.beds || []).map((bed) => ({ ...bed })),
        searchProfile: { notes: listing.searchProfile?.notes || "" },
      }
    : {
        title: "",
        description: "",
        city: "Пусан",
        address: "",
        roomType: "",
        capacity: 2,
        pricePerNight: 50000,
        currency: "KRW",
        amenities: [],
        amenityStates: {},
        status: "draft",
        floor: null,
        windowDirections: [],
        photos: [],
        coordinates: null,
        sleepingPlaces: null,
        beds: [],
        searchProfile: { notes: "" },
      };
}

/** Changing currencies requires a fresh amount; never reinterpret an existing numeric price. */
export function updateEditableListing<K extends keyof EditableListing>(
  previous: EditableListing, key: K, value: EditableListing[K],
): EditableListing {
  const next = { ...previous, [key]: value };
  if (key === "beds") next.sleepingPlaces = next.beds.length ? sleepingPlacesTotal(next.beds) : null;
  const currency = key === "city" ? listingCurrency(String(value)) : next.currency;
  return currency === previous.currency ? next : { ...next, currency, pricePerNight: 0 };
}
export interface ListingFieldsProps {
  value: EditableListing;
  update: <K extends keyof EditableListing>(
    key: K,
    value: EditableListing[K],
  ) => void;
}
