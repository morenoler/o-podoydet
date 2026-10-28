import demoHighlights from "../data/demo/review-highlights.json";

/** Display data from a future offline review processor, separate from matching evidence. */
export interface ReviewHighlight {
  key: string;
  label: string;
  description: string;
}

export interface ReviewHighlights {
  subject: { type: "listing"; id: string };
  scope: "listing";
  is_demo: boolean;
  status: "demo" | "reported";
  source: string;
  sourceDate: string | null;
  obtainedAt: string;
  recheckAfter: string | null;
  method: string;
  reviewCount: number | null;
  highlights: ReviewHighlight[];
}

const examples = demoHighlights.listings as ReviewHighlights[];

/** Both the server's provenance flag and an exact fixture identity are required. */
export function reviewHighlightsForListing(listing: { id: string; demo?: boolean }): ReviewHighlights | undefined {
  if (listing.demo !== true) return undefined;
  return examples.find((example) => example.is_demo === true && example.status === "demo"
    && example.subject.type === "listing" && example.subject.id === listing.id);
}
