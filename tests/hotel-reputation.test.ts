import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HotelRating, HotelReviews, HotelStars } from "../src/features/hotels/components/HotelReputation";
import { hotelReputation, ratingTone, reviewCountLabel, validRating, validReviews, validStars, type GuestRating, type GuestReview } from "../src/features/hotels/reputation";
import reputationData from "../src/features/hotels/reputation-data.json";

// Explicit test fixtures; these records are never part of the real hotel catalogue.
const source = { sourceName: "Test provider", sourceUrl: "https://example.test/reviews", obtainedAt: "2026-10-28T10:00:00Z", sourceDate: null };
const rating: GuestRating = { ...source, value: 8.1, scale: 10, reviewCount: 24 };
const review: GuestReview = { ...source, id: "test-review", author: "Test traveller", publishedAt: "2026-10-20", rating: 8.1, ratingScale: 10, positive: "Test positive", negative: "Test negative" };

test("unknown ratings and reviews stay unknown without borrowing stars or synthetic feedback", () => {
  const knownStars = hotelReputation(Object.keys(reputationData.hotels)[0]);
  assert.ok(validStars(knownStars.stars));
  assert.equal(validRating(knownStars.rating), false);
  const score = renderToStaticMarkup(createElement(HotelRating, { hotelId: "missing", reputation: knownStars }));
  assert.match(score, /Нет оценки/);
  assert.doesNotMatch(score, /hotel-rating-ribbon|отзывов/);
  const html = renderToStaticMarkup(createElement(HotelReviews, { hotelId: "missing" }));
  assert.match(html, /Отзывы об этом отеле пока не загружены/);
  assert.doesNotMatch(html, /hotel-review-card|Test traveller/);
  assert.equal(renderToStaticMarkup(createElement(HotelStars, { hotelId: "missing" })), "");
});

test("scores require a source, a valid date, a ten-point scale and an actual review count", () => {
  assert.equal(validRating(rating), true);
  for (const change of [{ value: NaN }, { value: 10.1 }, { value: -1 }, { scale: 5 }, { reviewCount: 0 }, { reviewCount: 1.5 }, { sourceUrl: "javascript:alert(1)" }, { sourceUrl: "https://" }, { obtainedAt: "unknown" }]) {
    assert.equal(validRating({ ...rating, ...change } as GuestRating), false, JSON.stringify(change));
  }
  assert.equal(ratingTone(8), "silver");
  assert.equal(ratingTone(8.1), "gold");
  for (const value of [8, 8.1]) {
    const html = renderToStaticMarkup(createElement(HotelRating, { hotelId: "fixture", reputation: { rating: { ...rating, value } } }));
    assert.match(html, new RegExp(`is-${value > 8 ? "gold" : "silver"}`));
    assert.match(html, /24 отзыва/);
  }
  assert.deepEqual([1, 2, 5, 11, 12, 21, 22, 111].map(reviewCountLabel), ["1 отзыв", "2 отзыва", "5 отзывов", "11 отзывов", "12 отзывов", "21 отзыв", "22 отзыва", "111 отзывов"]);
});

test("review cards show sourced author/date/text and never assume an undocumented score scale", () => {
  const html = renderToStaticMarkup(createElement(HotelReviews, { hotelId: "fixture", reputation: { rating, reviews: [review] } }));
  for (const text of ["Test traveller", "Test positive", "Test negative", "2026-10-20", source.sourceUrl, "hotel-review-score is-gold"]) assert.ok(html.includes(text));
  const unknownScale = renderToStaticMarkup(createElement(HotelReviews, { hotelId: "fixture", reputation: { reviews: [{ ...review, ratingScale: undefined }] } }));
  assert.doesNotMatch(unknownScale, /hotel-review-score/);
  assert.equal(validReviews([{ ...review, sourceUrl: "" }, { ...review, publishedAt: "unknown" }, { ...review, positive: "", negative: "" }]).length, 0);
});

test("every displayed OSM star value matches its archived source object and snapshot hash", () => {
  const sources = new Map<string, { hash: string; elements: { type: string; id: number; tags?: { stars?: string } }[] }>();
  for (const [id, record] of Object.entries(reputationData.hotels)) {
    const stars = record.stars;
    let raw = sources.get(stars.sourcePath);
    if (!raw) {
      const contents = readFileSync(new URL(`../${stars.sourcePath}`, import.meta.url));
      raw = { hash: createHash("sha256").update(contents).digest("hex"), elements: JSON.parse(contents.toString()).elements };
      sources.set(stars.sourcePath, raw);
    }
    assert.equal(raw.hash, stars.sha256, id);
    const element = raw.elements.find(item => `${item.type}-${item.id}` === id);
    assert.equal(Number(element?.tags?.stars), stars.value, id);
    assert.equal(stars.sourceUrl, `https://www.openstreetmap.org/${id.replace("-", "/")}`);
    assert.equal(validStars(hotelReputation(id).stars), true);
    assert.equal("rating" in record, false);
    assert.equal("reviews" in record, false);
  }
  assert.ok(Object.keys(reputationData.hotels).length > 0);
});
