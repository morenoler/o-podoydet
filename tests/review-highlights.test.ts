import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import fixtures from "../data/demo/fixtures.json";
import examples from "../data/demo/review-highlights.json";
import { reviewHighlightsForListing } from "../shared/reviewHighlights";
import { ReviewHighlights } from "../src/features/listings/ReviewHighlights";
import { editableListing, updateEditableListing } from "../src/features/account/components/listingForm";
import { listingMapCenter } from "../shared/regions";

const listing = fixtures.listings[0];
function render(subject: { id: string; demo?: boolean }, compact = false) {
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(ReviewHighlights, { listing: subject, compact })));
}

test("generated praise requires both exact fixture identity and explicit demo provenance", () => {
  assert.ok(reviewHighlightsForListing(listing));
  assert.equal(reviewHighlightsForListing({ id: listing.id }), undefined);
  assert.equal(reviewHighlightsForListing({ id: listing.id, demo: false }), undefined);
  assert.equal(reviewHighlightsForListing({ id: "real-hotel", demo: true }), undefined);
  assert.equal(reviewHighlightsForListing({ id: "33333333-unrecognized", demo: true }), undefined);
});

test("every example belongs to a published synthetic listing and contains provenance without fabricated counts", () => {
  const published = fixtures.listings.filter((item) => item.demo && item.status === "published");
  assert.deepEqual(examples.listings.map((item) => item.subject.id).sort(), published.map((item) => item.id).sort());
  for (const example of examples.listings) {
    assert.equal(example.is_demo, true);
    assert.equal(example.status, "demo");
    assert.equal(example.scope, "listing");
    assert.equal(example.subject.type, "listing");
    assert.equal(example.sourceDate, null, "generation date is not a review date");
    assert.equal(example.reviewCount, null, "no review corpus exists yet");
    assert.equal(example.recheckAfter, null);
    assert.equal(example.method, "ai_generated_demo");
    assert.ok(example.source && example.obtainedAt);
    assert.ok(example.highlights.length >= 3);
    assert.equal(new Set(example.highlights.map((item) => item.key)).size, example.highlights.length);
  }
});

test("compact cards disclose generated examples, show three themes and link to the full summary", () => {
  const html = render(listing, true);
  assert.match(html, /За что хвалят в отзывах/);
  assert.match(html, /Демо/);
  assert.match(html, /Вымышленный пример, не реальные отзывы/);
  assert.equal((html.match(/<li>/g) || []).length, 3);
  assert.ok(html.includes(`/stays/${listing.id}#listing-reviews`));
  assert.doesNotMatch(html, /Аккуратная уборка/);
});

test("detail summary includes all themes and never invents an empty listing's reputation", () => {
  const detail = render(listing);
  assert.match(detail, /id="listing-reviews"/);
  assert.match(detail, /не основаны на реальных отзывах/);
  assert.match(detail, /Аккуратная уборка/);
  assert.equal((detail.match(/<li>/g) || []).length, 4);
  assert.equal(render({ id: listing.id, demo: false }, true), "");
  const empty = render({ id: listing.id, demo: false });
  assert.match(empty, /Отзывы для этого объявления пока не загружены/);
  assert.doesNotMatch(empty, /Чистота|Гостеприимство|<li>/);
});

test("bed edits and regional currency changes coexist without changing saved prices silently", () => {
  const sochi = updateEditableListing(editableListing(), "city", "Сочи");
  const priced = updateEditableListing(sochi, "pricePerNight", 6500);
  const beds = updateEditableListing(priced, "beds", [
    { type: "double", count: 1, placesPerUnit: 2, room: "Спальня" },
    { type: "crib", count: 1, placesPerUnit: 1, room: "Спальня" },
  ]);
  assert.equal(beds.sleepingPlaces, 2);
  assert.equal(beds.currency, "RUB");
  assert.equal(beds.pricePerNight, 6500);
  const busan = updateEditableListing(beds, "city", "Пусан");
  assert.equal(busan.currency, "KRW");
  assert.equal(busan.pricePerNight, 0);
  assert.deepEqual(busan.beds, beds.beds);
  assert.equal(beds.pricePerNight, 6500);
});

test("a new owner map starts in the listing city without claiming a selected address", () => {
  assert.deepEqual(listingMapCenter(" Сочи "), [39.72, 43.58]);
  assert.deepEqual(listingMapCenter("Пусан"), [129.0756, 35.1796]);
  assert.equal(updateEditableListing(editableListing(), "city", "Сочи").coordinates, null);
});
