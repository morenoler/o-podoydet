import reputationData from "./reputation-data.json";

export interface ReputationSource {
  sourceName: string;
  sourceUrl: string;
  obtainedAt: string;
  sourceDate: string | null;
}
export interface StarClassification extends ReputationSource { value: number; status: "reported"; }
export interface GuestRating extends ReputationSource { value: number; scale: 10; reviewCount: number; }
export interface GuestReview extends ReputationSource {
  id: string;
  author: string;
  publishedAt: string;
  rating?: number;
  ratingScale?: 10;
  positive?: string;
  negative?: string;
  text?: string;
}
export interface HotelReputation { stars?: StarClassification; rating?: GuestRating; reviews?: GuestReview[]; }

function hasSource(source: ReputationSource) {
  try {
    const url = new URL(source.sourceUrl);
    return !!source.sourceName?.trim() && url.protocol === "https:" && !!url.hostname && !url.username && !url.password
      && Number.isFinite(Date.parse(source.obtainedAt || ""))
      && (!source.sourceDate || Number.isFinite(Date.parse(source.sourceDate)));
  } catch { return false; }
}
/** Provider scores must explicitly be on a ten-point scale; missing data stays unknown. */
export function validRating(rating?: GuestRating): rating is GuestRating {
  return !!rating && hasSource(rating) && rating.scale === 10 && Number.isFinite(rating.value)
    && rating.value >= 0 && rating.value <= 10 && Number.isInteger(rating.reviewCount) && rating.reviewCount > 0;
}
export function validStars(stars?: StarClassification): stars is StarClassification {
  return !!stars && hasSource(stars) && stars.status === "reported" && Number.isInteger(stars.value) && stars.value >= 1 && stars.value <= 5;
}
export function validReviews(reviews: GuestReview[] = []): GuestReview[] {
  return reviews.filter(review => hasSource(review) && review.id && review.author?.trim()
    && Number.isFinite(Date.parse(review.publishedAt || "")) && (review.text?.trim() || review.positive?.trim() || review.negative?.trim()));
}
export function hotelReputation(hotelId: string): HotelReputation {
  const record = (reputationData.hotels as unknown as Record<string, HotelReputation>)[hotelId];
  return record || {};
}
export function ratingTone(value: number) { return value > 8 ? "gold" : "silver"; }
export function reviewCountLabel(value: number) {
  const last = value % 10, lastTwo = value % 100;
  return `${value.toLocaleString("ru-RU")} ${last === 1 && lastTwo !== 11 ? "отзыв" : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? "отзыва" : "отзывов"}`;
}
