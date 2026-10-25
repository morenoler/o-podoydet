/** Assets embedded in the supplied FigCraft file. Identity is bound to catalog IDs, never names. */
export const catalogPhotos: Record<string, { urls: string[]; source: string }> =
  {
    "way-627150752": {
      urls: [
        "/images/hotels/shilla-stay-haeundae-exterior.jpg",
        "/images/hotels/shilla-stay-haeundae-room.jpg",
      ],
      source:
        "https://www.regent-holidays.co.uk/holiday/south-korea/shilla-stay-haeundae/",
    },
    "way-627350916": {
      urls: ["/images/hotels/toyoko-inn-haeundae-2.jpg"],
      source: "https://www.toyoko-inn.com/eng/search/detail/00256/",
    },
    "way-843161717": {
      urls: ["/images/hotels/grand-josun-busan.jpg"],
      source: "https://gjb.josunhotel.com/facilities/subMain.do",
    },
  };
export function accommodationPhotos(hotelId?: string, photos?: string[]) {
  if (Array.isArray(photos) && photos.length) return photos.filter(isPhotoUrl);
  return hotelId ? catalogPhotos[hotelId]?.urls || [] : [];
}
export function isPhotoUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (
    /^\/uploads\/listings\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/.test(
      value,
    )
  )
    return true;
  if (/^\/images\/[\w./-]+$/.test(value))
    return (
      !value.endsWith("/") &&
      !value.includes("//") &&
      !value.split("/").some((segment) => segment === "." || segment === "..")
    );
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
