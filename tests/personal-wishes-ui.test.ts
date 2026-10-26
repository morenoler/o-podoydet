import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { CriterionDecision, HotelMatch, MatchStatus, PersonalWishes } from "../shared/types";
import { personalWishItems, personalWishNotice, personalWishSummary } from "../src/shared/lib/personalWishes";
import { HotelCard } from "../src/features/hotels/components/HotelCard";
import { FavoritesProvider } from "../src/features/favorites/FavoritesProvider";
import { PersonalWishesNotice } from "../src/features/advisor/PersonalWishesNotice";

const recognition: PersonalWishes = {
  status: "recognized", completeness: "unverified", features: ["low_noise"], excludedFeatures: [], ownerCriteria: [],
};
function criterion(feature: CriterionDecision["feature"], evidenceStatus: MatchStatus): CriterionDecision {
  return { feature, required: false, evidenceStatus, status: evidenceStatus === "match" ? "match" : "mismatch",
    assumed: !["match", "mismatch"].includes(evidenceStatus), decisionBasis: "evidence", sourceExplanation: "Test evidence",
    facts: [], explanation: "Synthetic criterion" };
}
function fixture(evidenceStatus: MatchStatus = "unknown"): HotelMatch {
  const room = { id: "fixture-room", name: "Тестовая категория", capacity: 2, demo: true };
  const best: HotelMatch["best"] = { room, criteria: [criterion("low_noise", evidenceStatus)], score: 0, status: "fits" };
  return { hotel: { id: "fixture-hotel", name: "Тестовый отель", address: "Тест", coordinates: null, osmUrl: "", rooms: [room], route: null, noise: [] },
    best, rooms: [best], personalWishes: { ...recognition } };
}
function renderCard(match: HotelMatch) {
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(FavoritesProvider, null, createElement(HotelCard, { match }))));
}

test("no text or an older response never produces a recognition success", () => {
  const match = fixture();
  delete match.personalWishes;
  assert.equal(personalWishSummary(match), null);
  assert.equal(personalWishNotice(undefined, false), null);
  assert.match(personalWishNotice(undefined, true)!.title, /ещё не проверено/);
  match.personalWishes = { ...recognition, status: "not_requested" };
  assert.equal(personalWishSummary(match), null);
  assert.equal(personalWishNotice(match.personalWishes, false), null);
});

test("unrecognized personal text cannot borrow a successful selected filter", () => {
  const match = fixture("match");
  match.personalWishes = { ...recognition, status: "unrecognized", features: [] };
  assert.equal(personalWishSummary(match)!.title, "Личные пожелания не учтены");
  const html = renderCard(match);
  assert.match(html, /В тексте ничего не распознано/);
  assert.ok(html.indexOf("Личные пожелания не учтены") > html.indexOf("Подробнее"));
  assert.doesNotMatch(html, /Распознанные пожелания учтены/);
});

test("assistant states no recognition before a run and offers a usable example", () => {
  const wishes: PersonalWishes = { ...recognition, status: "unrecognized", features: [] };
  const html = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(PersonalWishesNotice, { wishes, hasText: true })));
  assert.match(html, /role="status"/);
  assert.match(html, /В личном пожелании ничего не распознано/);
  assert.match(html, /Не выше 3 этажа/);
  assert.match(html, /href="\/wishes"/);
});

test("unknown, stale and conflicting evidence never becomes a personal match", () => {
  for (const state of ["unknown", "stale", "conflict"] as const) {
    const summary = personalWishSummary(fixture(state))!;
    assert.equal(summary.tone, "unknown");
    assert.equal(summary.items[0].state, "unknown");
    assert.doesNotMatch(summary.title, /учтены/);
  }
});

test("a known mismatch stays visible even when the preference is optional", () => {
  const summary = personalWishSummary(fixture("mismatch"))!;
  assert.equal(summary.tone, "mismatch");
  assert.match(summary.title, /несоответствия/);
});

test("another room cannot supply the missing personal condition", () => {
  const match = fixture("unknown");
  match.rooms.push({ ...match.best, room: { ...match.best.room, id: "different-room" }, criteria: [criterion("low_noise", "match")] });
  assert.equal(personalWishSummary(match)!.tone, "unknown");
  assert.equal(personalWishSummary({ ...match, best: match.rooms[1] })!.tone, "match");
});

test("matching floor and window claims remain attributed to the owner", () => {
  const match = fixture();
  const request = { id: "floor-0", feature: "floor" as const, label: "Не выше 3 этажа", required: false };
  match.personalWishes = { ...recognition, features: [], ownerCriteria: [request] };
  assert.equal(personalWishItems(match)[0].state, "unknown");
  match.ownerCriteria = [{ ...request, status: "match", evidenceStatus: "match", assumed: true,
    explanation: "Сведения отельера", sourceExplanation: "Сведения отельера" }];
  assert.equal(personalWishSummary(match)!.tone, "reported");
  assert.match(renderCard(match), /Со слов отельера/);
  assert.doesNotMatch(renderCard(match), /Соответствует по данным/);
});

test("an assumed match cannot be promoted to confirmed personal evidence", () => {
  const match = fixture("match");
  match.best.criteria[0].assumed = true;
  assert.equal(personalWishItems(match)[0].state, "unknown");
});

test("recognized conditions do not imply that all arbitrary prose was checked", () => {
  const summary = personalWishSummary(fixture("match"))!;
  assert.equal(summary.title, "Распознанные пожелания учтены");
  assert.match(summary.note, /Остальной текст не проверен/);
  assert.match(personalWishNotice(recognition, true)!.message, /Остальной текст не проверен/);
});

test("recognizing an opt-out does not claim a conflicting filter was removed", () => {
  const match = fixture();
  match.personalWishes = { ...recognition, features: [], excludedFeatures: ["low_noise"] };
  match.conflicts = ["Тишина выбрана в фильтрах и отменена в тексте"];
  assert.match(personalWishSummary(match)!.title, /распознана отмена/);
  const notice = personalWishNotice(match.personalWishes, true)!;
  assert.match(notice.message, /противоречий с фильтрами/);
  assert.doesNotMatch(notice.message, /Не учитываем:/);
});

test("missing criteria are unknown and duplicate extracted features are not double-counted", () => {
  const match = fixture("match");
  match.personalWishes = { ...recognition, features: ["low_noise", "low_noise", "courtyard"] };
  assert.equal(personalWishItems(match).length, 2);
  assert.equal(personalWishSummary(match)!.tone, "unknown");
});
