import type {
  HostListing,
  HostListingInput,
  ListingSearchProfile,
  ListingCoordinates,
  ListingBed,
  WindowDirection,
} from "../../../../shared/account";

export type EditableListing = HostListingInput & {
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
        amenities: [],
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
export interface ListingFieldsProps {
  value: EditableListing;
  update: <K extends keyof EditableListing>(
    key: K,
    value: EditableListing[K],
  ) => void;
}
