export type Point = [number, number]; // longitude, latitude
export type FeatureId =
  | "beach_walk"
  | "step_free_route"
  | "courtyard"
  | "step_free_access"
  | "family";
export type Value = boolean | number | string;
export interface Fact {
  id: string;
  hotelId: string;
  roomId?: string;
  feature: FeatureId;
  value: Value;
  source: string;
  sourceUrl?: string;
  quote: string;
  method: "geo" | "host" | "demo";
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
  capacity: number;
  demo: boolean;
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
  id: string;
  name: string;
  address: string;
  coordinates: Point;
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
export interface Trip {
  region: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  scenarios: string[];
  preferences: Preference[];
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
  facts: Fact[];
  explanation: string;
}
export interface RoomMatch {
  room: Room;
  criteria: Criterion[];
  score: number;
  status: "fits" | "clarify" | "excluded";
}
export interface HotelMatch {
  hotel: Hotel;
  best: RoomMatch;
  rooms: RoomMatch[];
}
export interface Trace {
  step: string;
  detail: string;
  tool?: string;
}
export interface SearchResult {
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
