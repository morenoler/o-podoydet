import assert from "node:assert/strict";
import test from "node:test";
import { amenityIds, amenityFeatures, additionalAmenityLabels } from "../shared/amenities";
import { features } from "../shared/features";
import { tripSchema, extractionSchema } from "../shared/validation";
import { evaluate, rankHotels } from "../shared/matching";
import type { Fact, Hotel, Trip } from "../shared/types";
import { criterionNeedsClarification, hasKnownOwnerAmenity } from "../src/shared/lib/matchPresentation";
import type { CriterionDecision } from "../shared/types";

const now = new Date("2026-10-28T12:00:00Z");
const trip: Trip = { region: "Пусан", checkIn: "2027-06-10", checkOut: "2027-06-17", adults: 2, children: 0, scenarios: [], preferences: [], text: "" };
const room = { id: "synthetic-room", name: "Synthetic", capacity: 2, demo: false, evidenceStatus: "verified" as const, sourceUrl: "https://example.test/category", obtainedAt: "2026-10-20T00:00:00Z", quote: "Synthetic category evidence" };
const hotel: Hotel = { id: "synthetic", name: "Synthetic", address: "Test", coordinates: null, osmUrl: "", rooms: [room], route: null, noise: [] };
function fact(overrides: Partial<Fact>): Fact {
  return { id: "synthetic-fact", hotelId: hotel.id, roomId: room.id, feature: "dishwasher", value: true, source: "Synthetic official fixture", sourceUrl: "https://example.test/category", quote: "Explicit test evidence", method: "official", confidence: "high", confidenceReason: "Test", obtainedAt: room.obtainedAt, expiresAt: "2027-01-01T00:00:00Z", demo: false, ...overrides };
}
test("amenities are selectable catalog criteria without extending private clarification extraction", () => {
  assert.ok(tripSchema.safeParse({ ...trip, preferences: amenityIds.map(feature => ({ feature, required: true })) }).success);
  for (const id of amenityIds) {
    assert.equal(features[id].scope, amenityFeatures[id].scope);
    assert.equal(extractionSchema.safeParse({ feature: id, value: true, quote: "Да" }).success, false);
  }
});
test("legacy controlled labels are hidden without promoting prose to a structured state", () => {
  assert.deepEqual(additionalAmenityLabels(["Wi-Fi", "Кухня", "Посудомоечная машина", "Лифт", "Можно с детьми"]), ["Лифт", "Можно с детьми"]);
});
test("amenity evidence respects room/hotel scope and never infers facts from prose", () => {
  assert.equal(evaluate([fact({ roomId: "another-room" })], { feature: "dishwasher", required: true }, room, trip, now).status,"unknown");
  assert.equal(evaluate([fact({ feature: "pool", roomId: undefined })], { feature: "pool", required: true }, room, trip, now).status,"match");
  const prose = { ...hotel, rooms: [{ ...room, description: "Есть посудомойка", amenities: ["Посудомоечная машина"] }] };
  assert.equal(rankHotels([prose], [], [{ feature: "dishwasher", required: true }], { ...trip, admissionMode: "explore" }, now)[0].best.provisional,true);
});
test("positive amenities must cover the trip; closures at checkout exclude or conflict", () => {
  const preference = { feature: "pool" as const, required: true };
  assert.equal(evaluate([fact({ feature: "pool", roomId: undefined, validFrom: "2027-06-11" })], preference, room, trip, now).status,"unknown");
  const closure = fact({ feature: "pool", roomId: undefined, value: false, validFrom: trip.checkOut, validTo: trip.checkOut });
  assert.equal(evaluate([closure], preference, room, trip, now).status,"mismatch");
  assert.equal(evaluate([closure, fact({ id: "positive", feature: "pool", roomId: undefined })], preference, room, trip, now).status,"conflict");
  assert.equal(evaluate([fact({ ...closure, validFrom: "2027-06-18", validTo: "2027-06-18" })], preference, room, trip, now).status,"unknown");
});
test("owner amenities retain known positive and negative values without claiming independent verification", () => {
  const criterion: CriterionDecision = { feature: "dishwasher", required: true, status: "match", evidenceStatus: "match", assumed: true,
    decisionBasis: "estimate", facts: [], explanation: "Указано владельцем", sourceExplanation: "Указано владельцем",
    ownerAmenityEvidence: { value: true, source: "owner", method: "structured_owner_declaration", scope: "room", obtainedAt: "2026-10-28T00:00:00Z", sourceDate: null } };
  assert.equal(hasKnownOwnerAmenity(criterion),true);
  assert.equal(criterionNeedsClarification(criterion),false);
  assert.equal(criterionNeedsClarification({ ...criterion, status: "mismatch", evidenceStatus: "mismatch", ownerAmenityEvidence: { ...criterion.ownerAmenityEvidence!, value: false } }),false);
  assert.equal(criterionNeedsClarification({ ...criterion, ownerAmenityEvidence: { ...criterion.ownerAmenityEvidence!, value: null } }),true);
  assert.equal(criterionNeedsClarification({ ...criterion, ownerAmenityEvidence: { ...criterion.ownerAmenityEvidence!, scope: "hotel" } }),true);
  assert.equal(criterionNeedsClarification({ ...criterion, ownerAmenityEvidence: undefined }),true);
});
