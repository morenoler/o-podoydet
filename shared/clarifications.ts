import type { Trip, MatchStatus } from "./types";

/** A statement concerns the single accommodation unit represented by a host listing. */
export type ClarificationFeature = "family" | "courtyard" | "step_free_access";
export interface ClarificationContext {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
}
export interface OwnerStatement {
  id: string;
  feature: ClarificationFeature;
  value: boolean | null;
  observedOn: string | null;
  recordedAt: string;
  validFrom: string | null;
  validTo: string | null;
  recheckAt: string;
  scope: "listing_unit";
  scopeId: string;
  state: "active" | "stale" | "superseded" | "scope_changed";
}
export interface ClarificationAnswer extends OwnerStatement {
  version: number;
  text: string;
  supersedes: string[];
}
/** Private DTO. Never return through the public Q&A/listing/search routes. */
export interface ListingClarification {
  id: string;
  listingId: string;
  listingTitle: string;
  roomId: string;
  feature: ClarificationFeature;
  text: string;
  note: string;
  createdAt: string;
  status: "open" | "answered";
  version: number;
  context: ClarificationContext;
  /** Material changes permanently invalidate the question's original accommodation scope. */
  scopeChanged: boolean;
  /** Current combined evidence for this condition and the original trip, across owner reports. */
  evidenceStatus: MatchStatus;
  /** Full original query is returned only to its traveler; hosts receive context only. */
  trip?: Trip;
  answer: ClarificationAnswer | null;
  history: ClarificationAnswer[];
  /** Same-scope current statements, host-only, for explicit conflict resolution. */
  relatedStatements?: OwnerStatement[];
}
export interface AskClarification {
  feature: ClarificationFeature;
  trip: Trip;
  note?: string;
  requestKey: string;
}
export interface AnswerClarification {
  expectedVersion: number;
  requestKey: string;
  value: boolean | null;
  text: string;
  observedOn: string | null;
  validFrom: string | null;
  validTo: string | null;
  validForDays: number;
  /** Explicitly replaces prior statements of the same listing and feature. */
  supersedes: string[];
}
/** Public, sanitized provenance. No dialogue, person, question ID or original trip. */
export interface ReportedEvidence {
  method: "owner_response";
  provenanceStatus: "reported";
  feature: ClarificationFeature;
  value: boolean | null;
  evidenceStatus: MatchStatus;
  scope: "listing_unit";
  scopeId: string;
  recordedAt: string;
  observedOn: string | null;
  validFrom: string | null;
  validTo: string | null;
  recheckAt: string;
}
