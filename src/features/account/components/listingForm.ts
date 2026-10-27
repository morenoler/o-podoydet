import type {
  HostListing,
  HostListingInput,
  ListingSearchProfile,
  WindowDirection,
} from "../../../../shared/account";
import { listingCurrency, type RegionCurrency } from "../../../../shared/regions";

export type EditableListing = HostListingInput & {
  currency: RegionCurrency;
  floor: number | null;
  windowDirections: WindowDirection[];
  photos: string[];
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
        currency: listing.currency,
        amenities: listing.amenities,
        status: listing.status,
        floor: listing.floor ?? null,
        windowDirections: listing.windowDirections || [],
        photos: listing.photos || [],
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
        status: "draft",
        floor: null,
        windowDirections: [],
        photos: [],
        searchProfile: { notes: "" },
      };
}

/** Changing currencies requires a fresh amount; never reinterpret an existing numeric price. */
export function updateEditableListing<K extends keyof EditableListing>(
  previous: EditableListing, key: K, value: EditableListing[K],
): EditableListing {
  const next = { ...previous, [key]: value };
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
