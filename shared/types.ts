import type { WindowDirection } from "./account";
export type Point = [number, number]; // longitude, latitude
export type FeatureId =
  | "beach_walk"
  | "step_free_route"
  | "courtyard"
  | "step_free_access"
  | "family"
  | "area_safety"
  | "clean_air"
  | "low_noise";
export type Value = boolean | number | string | null;
export interface Fact {
  id: string;
  hotelId: string;
  roomId?: string;
  feature: FeatureId;
  value: Value;
  source: string;
  sourceUrl?: string;
  quote: string;
  method: "geo" | "host" | "demo" | "official";
  confidence: "high" | "medium" | "low";
  confidenceReason: string;
  obtainedAt: string;
  sourceDate?: string;
  expiresAt: string;
  validFrom?: string;
  validTo?: string;
  supersededBy?: string;
  demo: boolean;
}
export interface Room {
  id: string;
  name: string;
  capacity: number | null;
  demo: boolean;
  evidenceStatus?: "verified" | "unknown";
  sourceUrl?: string;
  obtainedAt?: string;
  quote?: string;
  capacityMayVary?: boolean;
}
export interface Route {
  meters: number;
  coordinates: Point[];
  wayIds: number[];
  steps: number;
  beachName: string;
  beachId: number;
  connectionMeters: number;
  approximate: boolean;
  noStepsAlternative?: { meters: number; coordinates: Point[] };
}
export interface NoiseSource {
  name: string;
  kind: string;
  meters: number;
  osmUrl: string;
  coordinates: Point;
}
export interface Hotel {
  /** Published owner listing; has no fabricated OpenStreetMap geometry. */
  accountListingId?: string;
  floor?: number | null;
  windowDirections?: WindowDirection[];
  photos?: string[];
  pricePerNight?: number;
  currency?: "KRW";
  /** Fictional lab listing: its placeholder coordinates must not produce environmental claims. */
  synthetic?: boolean;
  dataNotes?: string[];
  id: string;
  name: string;
  lodgingType?: "hotel" | "motel" | "guest_house" | "hostel" | "apartment";
  address: string;
  coordinates: Point | null;
  osmUrl: string;
  rooms: Room[];
  route: Route | null;
  noise: NoiseSource[];
}
export interface MapLine {
  coordinates: Point[];
  kind: string;
}
export interface Dataset {
  evidencePolicy?: "verified-only" | "demo";
  region: string;
  fetchedAt: string;
  sourceDate: string;
  attribution: string;
  bbox: [number, number, number, number];
  hotels: Hotel[];
  facts: Fact[];
  map: MapLine[];
}
export interface Preference {
  feature: FeatureId;
  required: boolean;
}
/** Explicit edits take precedence over wishes still present in the original free text. */
export interface PreferenceOverride extends Preference {
  enabled: boolean;
}
export interface Trip {
  region: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  scenarios: string[];
  preferences: Preference[];
  preferenceOverrides?: PreferenceOverride[];
  text: string;
}
export type MatchStatus =
  | "match"
  | "mismatch"
  | "unknown"
  | "conflict"
  | "stale";
export interface Criterion {
  feature: FeatureId;
  required: boolean;
  status: MatchStatus;
  evidenceStatus?: MatchStatus;
  assumed?: boolean;
  decisionBasis?: "evidence" | "estimate";
  assumption?: string;
  sourceExplanation?: string;
  nearestRoadMeters?: number;
  currentAirUsAqi?: number;
  currentAirTime?: string;
  facts: Fact[];
  explanation: string;
  environmentalEvidence?: {
    sourceUrl: string;
    observedAt?: string;
    details: string;
  }[];
  details?: string[];
  value?: number | string;
  riskLevel?: "high" | "moderate" | "low" | "unknown";
  assessmentBasis?: "historical" | "dated";
}
/** API decision contract. Raw evidence evaluation can still be unknown or stale. */
export interface CriterionDecision extends Criterion {
  status: "match" | "mismatch";
  evidenceStatus: MatchStatus;
  assumed: boolean;
  decisionBasis: "evidence" | "estimate";
  sourceExplanation: string;
}
export interface RoomMatch {
  capacityStatus?: "match" | "mismatch";
  capacityEvidenceStatus?: "match" | "mismatch" | "unknown";
  capacityAssumed?: boolean;
  estimatedCapacity?: number;
  capacityExplanation?: string;
  room: Room;
  criteria: CriterionDecision[];
  score: number;
  status: "fits" | "excluded";
}
export interface HotelMatch {
  hotel: Hotel;
  best: RoomMatch;
  rooms: RoomMatch[];
  preferences?: Preference[];
  warnings?: string[];
  conflicts?: string[];
  mode?: "rules" | "llm";
  ownerCriteria?: OwnerCriterion[];
}
export interface OwnerCriterion {
  id: string;
  feature: "floor" | "window_direction";
  label: string;
  required: boolean;
  status: "match" | "mismatch";
  evidenceStatus: "match" | "mismatch" | "unknown";
  assumed: boolean;
  explanation: string;
  sourceExplanation: string;
}
export interface Trace {
  step: string;
  detail: string;
  tool?: string;
}
export interface SearchResult {
  searchId: string;
  results: HotelMatch[];
  excluded: HotelMatch[];
  preferences: Preference[];
  warnings: string[];
  conflicts: string[];
  trace: Trace[];
  mode: "rules" | "llm";
}
export interface Question {
  id: string;
  hotelId: string;
  roomId: string;
  feature: FeatureId;
  text: string;
  status: "open" | "answered";
  createdAt: string;
  answer?: string;
  trace: Trace[];
}
export interface Extraction {
  feature: FeatureId;
  value: boolean;
  quote: string;
}
export interface Draft {
  id: string;
  questionId: string;
  text: string;
  extractions: Extraction[];
  warnings: string[];
  mode: "rules" | "llm";
}
