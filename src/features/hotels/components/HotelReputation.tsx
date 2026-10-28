import { Star, UserRound } from "lucide-react";
import { hotelReputation, ratingTone, reviewCountLabel, validRating, validReviews, validStars, type HotelReputation as Reputation } from "../reputation";

export function HotelStars({ hotelId, reputation = hotelReputation(hotelId) }: { hotelId: string; reputation?: Reputation }) {
  const stars = reputation.stars;
  if (!validStars(stars)) return null;
  return <a className="hotel-star-classification" href={stars.sourceUrl} target="_blank" rel="noreferrer"
    aria-label={`${stars.value} звёзд по данным ${stars.sourceName}`} title={`Звёздность указана в ${stars.sourceName}; официальная классификация не проверена.`}>
    {Array.from({ length: stars.value }, (_, i) => <Star key={i} size={12} fill="currentColor" aria-hidden="true" />)}
  </a>;
}

export function HotelRating({ hotelId, compact = false, reputation = hotelReputation(hotelId) }: { hotelId: string; compact?: boolean; reputation?: Reputation }) {
  const rating = reputation.rating;
  if (!validRating(rating)) return <span className={`hotel-rating-unknown${compact ? " is-compact" : ""}`}>Нет оценки</span>;
  return <span className={`hotel-rating${compact ? " is-compact" : ""}`}>
    <span className={`hotel-rating-ribbon is-${ratingTone(rating.value)}`} aria-label={`Оценка гостей: ${rating.value.toFixed(1)} из 10`}>{rating.value.toFixed(1)}</span>
    <span className="hotel-rating-count">{reviewCountLabel(rating.reviewCount)}</span>
  </span>;
}

export function HotelReviews({ hotelId, reputation = hotelReputation(hotelId) }: { hotelId: string; reputation?: Reputation }) {
  const reviews = validReviews(reputation.reviews), rating = reputation.rating;
  return <section className="hotel-guest-reviews figcraft-detail-section" id="hotel-reviews" aria-labelledby="hotel-reviews-title">
    <h2 id="hotel-reviews-title">Отзывы гостей</h2>
    {validRating(rating) && <div className="hotel-reviews-overview"><HotelRating hotelId={hotelId} reputation={reputation} />
      <div><strong>{rating.value > 8 ? "Высокая оценка гостей" : "Оценка гостей"}</strong>
        <p>По данным <a href={rating.sourceUrl} target="_blank" rel="noreferrer">{rating.sourceName}</a></p></div>
    </div>}
    {reviews.length ? <div className="hotel-review-cards">{reviews.map(review => <article className="hotel-review-card" key={review.id}>
      <header><span className="hotel-review-avatar" aria-hidden="true"><UserRound size={20} /></span><div><h3>{review.author}</h3><time dateTime={review.publishedAt}>{new Date(review.publishedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</time></div>
        {review.ratingScale === 10 && typeof review.rating === "number" && Number.isFinite(review.rating) && review.rating >= 0 && review.rating <= 10 && <span className={`hotel-review-score is-${ratingTone(review.rating)}`} aria-label={`${review.rating.toFixed(1)} из 10`}>{review.rating.toFixed(1)}</span>}
      </header>
      {review.positive && <p><strong>Что было хорошо:</strong>{review.positive}</p>}
      {review.negative && <p><strong>Что можно улучшить:</strong>{review.negative}</p>}
      {review.text && <p>{review.text}</p>}
      <a className="hotel-review-source" href={review.sourceUrl} target="_blank" rel="noreferrer">Отзыв на {review.sourceName}</a>
    </article>)}</div> : <p className="hotel-reviews-empty">Отзывы об этом отеле пока не загружены.</p>}
  </section>;
}
