import type { WindowDirection } from "./account";
import type { ReportedEvidence } from "./clarifications";
export type Point = [number, number]; // longitude, latitude
export const nearbyKinds = ["cafe", "restaurant", "supermarket", "convenience", "pharmacy", "park", "subway", "museum", "shopping_mall", "beach", "train_station", "city_center"] as const;
export type NearbyKind = typeof nearbyKinds[number];
export interface NearbyCondition { kind: NearbyKind; maxMeters: number }
export interface NearbyPlace {
  kind: NearbyKind;
  name: string;
  meters: number;
  coordinates: Point;
  sourceUrl: string;
  osmId: string;
  obtainedAt: string;
  sourceDate?: string;
  expiresAt: string;
  method: "haversine-osm-v1";
  status: "supported";
  scope: "hotel_surroundings";
}
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
export interface OccupancyRule {
  maxGuests: number;
  maxAdults?: number;
  maxChildren?: number;
  minChildren?: number;
  childMaxAge?: number;
  sourceUrl: string;
  obtainedAt: string;
  quote: string;
}
export interface Room {
  id: string;
  name: string;
  scope?: "room_category" | "unknown";
  capacity: number | null;
  demo: boolean;
  evidenceStatus?: "verified" | "unknown";
  sourceUrl?: string;
  obtainedAt?: string;
  quote?: string;
  capacityMayVary?: boolean;
  occupancyRules?: OccupancyRule[];
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
  hasCollectedRoomCategories?: boolean;
  nearbyPlaces?: NearbyPlace[];
  sourceEvidence?: { sourceUrl: string; obtainedAt: string; sourceDate?: string; expiresAt: string; status: "reported"; method: "osm" };
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
/** Text recognition is separate from chips and from evidence about any one room. */
export interface PersonalWishes {
  status: "not_requested" | "unrecognized" | "recognized";
  /** No completeness claim is made for arbitrary free text. */
  completeness: "unverified";
  features: FeatureId[];
  excludedFeatures: FeatureId[];
  ownerCriteria: Pick<OwnerCriterion, "id" | "feature" | "label" | "required">[];
}
export type LodgingType = "hotel" | "motel" | "guest_house" | "hostel" | "apartment";
/** Hard catalog limits. Missing price/distance does not satisfy a supplied maximum. */
export interface HotelFilters {
  /** Each proximity condition must hold; distances are straight-line OSM estimates. */
  nearby?: NearbyCondition[];
  /** Literal catalog/source-text retrieval, never confirmation of a room amenity. */
  query?: string;
  lodgingTypes?: LodgingType[];
  /** Published price in KRW; availability and a quote for the travel dates are not checked. */
  maxPricePerNight?: number;
  /** Calculated route length, excluding unverified access to the water. */
  maxBeachMeters?: number;
}
export interface CatalogSearchSnippet {
  field: "name" | "address" | "room" | "quote";
  text: string;
  sourceUrl?: string;
  roomId?: string;
  factId?: string;
  obtainedAt?: string;
  sourceDate?: string;
  expiresAt?: string;
}
export interface Trip {
  /** Omission keeps the legacy verified admission contract. */
  admissionMode?: "explore" | "verified";
  region: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  scenarios: string[];
  preferences: Preference[];
  preferenceOverrides?: PreferenceOverride[];
  hotelFilters?: HotelFilters;
  text: string;
}
export type MatchStatus =
  | "match"
  | "mismatch"
  | "unknown"
  | "conflict"
  | "stale";
export interface Criterion {
  /** Sanitized owner statements; private dialogue never appears in search results. */
  reportedEvidence?: ReportedEvidence[];
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
  nearbyMatches?: NearbyPlace[];
  /** Text matches only: the criteria below retain their independent evidence status. */
  catalogMatches?: CatalogSearchSnippet[];
  /** An explicit reported capacity remains distinct from independently sourced category evidence. */
  capacitySource?: "owner" | "official";
  /** True only when admission relies on missing or outdated mandatory evidence. */
  provisional?: boolean;
  capacityStatus?: "match" | "mismatch";
  capacityEvidenceStatus?: "match" | "mismatch" | "unknown";
  capacityAssumed?: boolean;
  estimatedCapacity?: number;
  capacityExplanation?: string;
  capacityRule?: OccupancyRule;
  room: Room;
  criteria: CriterionDecision[];
  score: number;
  status: "fits" | "excluded";
}
export interface HotelMatch {
  personalWishes?: PersonalWishes;
  hotel: Hotel;
  best: RoomMatch;
  rooms: RoomMatch[];
  preferences?: Preference[];
  warnings?: string[];
  conflicts?: string[];
  mode?: "rules" | "llm";
  ownerCriteria?: OwnerCriterion[];
}
/** One named category; every criterion is evaluated against this same room. */
export interface RoomRecommendation {
  personalWishes?: PersonalWishes;
  id: string;
  hotel: Hotel;
  room: RoomMatch;
  ownerCriteria?: OwnerCriterion[];
  source: "verified" | "owner" | "demo";
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
  /** Real mapped hotels without collected room categories, never room recommendations. */
  hotelCandidates?: HotelCandidate[];
  personalWishes?: PersonalWishes;
  admissionMode?: "explore" | "verified";
  searchId: string;
  roomRecommendations: RoomRecommendation[];
  roomAlternatives: RoomRecommendation[];
  unverifiedHotelCount: number;
  results: HotelMatch[];
  excluded: HotelMatch[];
  preferences: Preference[];
  warnings: string[];
  conflicts: string[];
  trace: Trace[];
  mode: "rules" | "llm";
}
export interface HotelCandidate {
  hotel: Hotel;
  nearbyMatches: NearbyPlace[];
  catalogMatches: CatalogSearchSnippet[];
  limitations: string[];
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
