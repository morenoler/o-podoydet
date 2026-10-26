import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { makeSnapshot, mergeSnapshots, parseOfficialPage, SOURCES } from "../scripts/import-official-hotel-pages";
import { prepareVerifiedDataset } from "../scripts/prepare-verified-data";
import { rankHotels } from "../shared/matching";
import type { Dataset, Trip } from "../shared/types";

const shilla = SOURCES.find(s => s.id === "shilla-standardTwin")!;
const josun = SOURCES.find(s => s.id === "josun-kidsDeluxe")!;
const faq = SOURCES.find(s => s.kind === "josun-policy")!;
const shillaHtml = `<html><title>Standard Family Twin | Shilla Stay Haeundae</title>
<nav>Ocean View Royal Suite, Guests 8, Desk, no stairs</nav><form>Children : Aged 37 months to 12 years</form>
<div class="property-detail room-detail"><div class="property-overview">
<div class="room-info-box"><dl><dt>View</dt><dd>City, Ocean</dd></dl><dl><dt>Guests</dt><dd>1–3 guests</dd></dl></div>
<ul class="list-bill"><li>When accompanied by a child, up to 4 guests may stay in the room.</li></ul></div>
<div class="detail-content amenities-list"><p>Complimentary high-speed wired and wireless (Wi-Fi) internet</p></div></div>
<footer>Desk</footer></html>`;
const josunHtml = `<title>객실 | 그랜드 조선 부산</title><nav>Family Suite, maximum 8 guests</nav>
<div id="container"><strong class="tit">Kids Deluxe</strong><div class="propertyInfo"><ul>
<li><dl><dt>VIEW</dt><dd>시티뷰, 파셜 오션뷰, 오션뷰</dd></dl></li></ul></div>
<p>Forest Sea Sky theme. Lounge access 2 adults 2 children. Elevator.</p></div>`;

test("extracts category occupancy, not booking-widget counts; child rule remains conditional", () => {
  const p = parseOfficialPage(shilla, shillaHtml);
  assert.equal(p.capacity, 3);
  assert.equal(p.extraChildCapacity, 4);
  assert.equal(p.childMaxAge, 12);
  assert.equal(p.publishedView, "City, Ocean");
  assert.equal(p.wifi, true);
  assert.equal(p.workDesk, undefined);
  assert.equal((p as any).courtyard, undefined);
  assert.equal((p as any).step_free_access, undefined);
  assert.ok(p.excerpts.join(" ").split(/\s+/).length <= 25);
});
test("refuses wrong property, wrong category, shell and missing actual occupancy", () => {
  for (const html of ["<html>enable JavaScript</html>", shillaHtml.replace("Haeundae", "Seobusan"), shillaHtml.replace("Standard Family Twin", "Deluxe"), shillaHtml.replace("<dt>Guests</dt><dd>1–3 guests</dd>", "")]) {
    assert.throws(() => parseOfficialPage(shilla, html));
  }
});
test("a missing final full stop does not discard a published child occupancy condition", () => {
  assert.equal(parseOfficialPage(shilla, shillaHtml.replace("stay in the room.", "stay in the room")).extraChildCapacity, 4);
});
test("Josun theme, lounge occupancy and elevator do not become room view, capacity or accessibility", () => {
  const p = parseOfficialPage(josun, josunHtml);
  assert.equal(p.capacity, null);
  assert.equal(p.family, true);
  assert.equal(p.publishedView, "시티뷰, 파셜 오션뷰, 오션뷰");
  assert.equal((p as any).step_free_access, undefined);
});
test("hotel family policy retains composition and age; it is not a four-adult capacity", () => {
  const p = parseOfficialPage(faq, `<title>FAQ | 그랜드 조선 부산</title><p>한 객실 당 성인 2인과 어린이 2인으로 4인 가족 기준입니다.</p><p>투숙 기준 소인 나이는 0세부터 12세입니다.</p>`);
  assert.deepEqual(p.policy, { maxAdults: 2, maxChildren: 2, maxGuests: 4, childMaxAge: 12 });
});
test("projection merge preserves uncollected hotel evidence and source dates", () => {
  const snapshot = makeSnapshot(shilla, shillaHtml, "2026-10-25T08:00:00Z");
  const base = { hotels: [{ hotelId: shilla.hotelId, rooms: [] }, { hotelId: "other", rooms: [{ id: "old", obtainedAt: "2026-10-01T00:00:00Z" }] }] };
  const merged = mergeSnapshots(base, [snapshot]);
  assert.deepEqual(merged.hotels[1], base.hotels[1]);
  assert.equal(merged.hotels[0].rooms[0].capacity, 3);
  assert.equal(merged.hotels[0].rooms[0].occupancyRules[0].childMaxAge, 12);
  assert.equal(merged.hotels[0].rooms[0].scope, "room_category");
  assert.ok(merged.hotels[0].rooms[0].facts.every((f: any) => f.feature === "family"));
  assert.equal(base.hotels[0].rooms.length, 0);
});

test("missing child age preserves base capacity and keeps the exception unresolved through ranking", () => {
  const html = shillaHtml.replace("Children : Aged 37 months to 12 years", "");
  const p = parseOfficialPage(shilla, html);
  assert.equal(p.capacity, 3);
  assert.equal(p.extraChildCapacity, undefined);
  assert.equal(p.occupancyExceptionUnresolved, true);
  assert.match(p.limitations.join(" "), /Возрастное определение ребёнка отсутствует/);
  const now = new Date("2026-10-25T12:00:00Z");
  const base = JSON.parse(readFileSync("data/demo.json", "utf8")) as Dataset;
  const research = mergeSnapshots({ hotels: [{ hotelId: shilla.hotelId, rooms: [] }] },
    [makeSnapshot(shilla, html, now.toISOString())]);
  const data = prepareVerifiedDataset(base, [research], now);
  const hotel = data.hotels.find(h => h.id === shilla.hotelId)!;
  const trip: Trip = { region: "Пусан", checkIn: "2026-11-09", checkOut: "2026-11-10",
    adults: 2, children: 2, scenarios: [], preferences: [], text: "" };
  const result = rankHotels([hotel], data.facts, [], trip, now)[0].best;
  assert.equal(result.status, "excluded");
  assert.equal(result.capacityEvidenceStatus, "unknown");
  assert.equal(hotel.rooms[0].capacity, 3);
  assert.equal(hotel.rooms[0].occupancyRules, undefined);
  assert.equal(rankHotels([hotel], data.facts, [], { ...trip, children: 1 }, now)[0].best.status, "fits");
});

test("other-category navigation and related sections cannot add occupancy, Wi-Fi or desk", () => {
  const unrelated = '<h2>Family Suite</h2><li>When accompanied by a child, up to 6 guests may stay in the room.</li><li>Desk</li><p>Complimentary high-speed wired and wireless (Wi-Fi) internet</p>';
  const base = shillaHtml
    .replace("Standard Family Twin", "Standard")
    .replace("1–3 guests", "1–2 guests")
    .replace('<li>When accompanied by a child, up to 4 guests may stay in the room.</li>', "")
    .replace('<p>Complimentary high-speed wired and wireless (Wi-Fi) internet</p>', "");
  const spec = SOURCES.find(s => s.id === "shilla-standard")!;
  for (const html of [
    base.replace("<footer>", `<nav>${unrelated}</nav><footer>`),
    base.replace('<ul class="list-bill">', `<nav>${unrelated}</nav><ul class="list-bill">`),
    base.replace('<div class="detail-content amenities-list">', `<div class="related-rooms">${unrelated}</div><div class="detail-content amenities-list">`),
    base.replace('<div class="detail-content amenities-list">', `<div class="detail-content amenities-list"><section class="recommended-categories">${unrelated}</section>`),
  ]) {
    const p = parseOfficialPage(spec, html);
    assert.equal(p.capacity, 2);
    assert.equal(p.family, undefined);
    assert.equal(p.extraChildCapacity, undefined);
    assert.equal(p.wifi, undefined);
    assert.equal(p.workDesk, undefined);
  }
});

test("missing, duplicated or similarly named detail containers fail closed", () => {
  for (const html of [
    shillaHtml.replace('class="property-detail room-detail"', 'class="room-detail-recommendation"'),
    shillaHtml.replace('class="room-info-box"', 'class="room-info-box-related"'),
    shillaHtml.replace('<footer>', '<div class="property-detail room-detail"></div><footer>'),
  ]) assert.throws(() => parseOfficialPage(shilla, html));
});
