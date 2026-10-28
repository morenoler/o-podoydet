import type {
  HostListing,
  HostListingInput,
  ListingSearchProfile,
  WindowDirection,
} from "../../../../shared/account";

export type EditableListing = HostListingInput & {
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
        amenities: listing.amenities,
        amenityStates: listing.amenityStates || {},
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
        amenities: [],
        amenityStates: {},
        status: "draft",
        floor: null,
        windowDirections: [],
        photos: [],
        searchProfile: { notes: "" },
      };
}
export interface ListingFieldsProps {
  value: EditableListing;
  update: <K extends keyof EditableListing>(
    key: K,
    value: EditableListing[K],
  ) => void;
}
