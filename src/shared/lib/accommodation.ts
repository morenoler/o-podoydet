/** Search IDs are stable across ordinary hotels and owner-published listings. */
export const accountListingPrefix = "account-listing:";

export function accountListingId(hotel: {
  id: string;
  accountListingId?: string;
}) {
  return (
    hotel.accountListingId ||
    (hotel.id.startsWith(accountListingPrefix)
      ? hotel.id.slice(accountListingPrefix.length)
      : undefined)
  );
}

export function accommodationPath(
  hotel: { id: string; accountListingId?: string },
  roomId?: string,
) {
  const listingId = accountListingId(hotel);
  if (listingId) return `/stays/${encodeURIComponent(listingId)}`;
  return `/hotels/${encodeURIComponent(hotel.id)}${roomId ? `?room=${encodeURIComponent(roomId)}` : ""}`;
}
