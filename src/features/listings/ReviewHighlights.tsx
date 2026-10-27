import { useId } from "react";
import { Link } from "react-router-dom";
import { MessageSquareText } from "lucide-react";
import { reviewHighlightsForListing } from "../../../shared/reviewHighlights";

export function ReviewHighlights({ listing, compact = false }: {
  listing: { id: string; demo?: boolean };
  compact?: boolean;
}) {
  const headingId = useId();
  const summary = reviewHighlightsForListing(listing);
  if (!summary && compact) return null;
  return <section
    className={`review-highlights${compact ? " review-highlights-compact" : ""}`}
    id={compact ? undefined : "listing-reviews"}
    aria-labelledby={headingId}
  >
    <div className="review-highlights-heading">
      <MessageSquareText size={18} aria-hidden="true" />
      {compact ? <h3 id={headingId}>За что хвалят в отзывах</h3> : <h2 id={headingId}>За что хвалят в отзывах</h2>}
      {summary && <span className="review-highlights-demo">Демо</span>}
    </div>
    {summary ? <>
      <p className="review-highlights-note">{compact
        ? "Вымышленный пример, не реальные отзывы."
        : "Пример для вымышленного объявления. Темы сгенерированы для демонстрации и не основаны на реальных отзывах."}</p>
      <ul className="review-highlights-list">
        {summary.highlights.slice(0, compact ? 3 : undefined).map((highlight) => <li key={highlight.key}>
          <strong>{highlight.label}</strong>
          {!compact && <p>{highlight.description}</p>}
        </li>)}
      </ul>
      {compact && <Link className="review-highlights-link" to={`/stays/${encodeURIComponent(listing.id)}#listing-reviews`}>Все темы отзывов</Link>}
    </> : <p className="review-highlights-note">Отзывы для этого объявления пока не загружены. Когда они появятся, здесь будут темы, которые отмечают гости.</p>}
  </section>;
}
