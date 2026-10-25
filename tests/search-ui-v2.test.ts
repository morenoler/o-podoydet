import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { FavoritesProvider } from "../src/features/favorites/FavoritesProvider";
import { HotelCard } from "../src/features/hotels/components/HotelCard";
import { canSearch } from "../src/features/search/searchTrip";
import type { Hotel, HotelMatch, Trip } from "../shared/types";
import type { CriterionDecision, SearchResult } from "../shared/types";
import { SearchDiagnostics } from "../src/features/search/SearchDiagnostics";
import { CapacitySummary } from "../src/features/hotels/components/CapacitySummary";
import { CriterionLine } from "../src/features/hotels/components/CriterionLine";
import { WishMatches } from "../src/features/hotels/components/WishMatches";
import { MatchBadge } from "../src/features/hotels/components/MatchBadge";

const trip: Trip = {
  region: "Пусан",
  checkIn: "2027-06-12",
  checkOut: "2027-06-17",
  adults: 2,
  children: 0,
  scenarios: [],
  preferences: [],
  text: "",
};
const hotel: Hotel = {
  id: "account-listing:owner-hotel",
  accountListingId: "owner-hotel",
  name: "Жильё владельца",
  address: "Пусан",
  floor: 2,
  windowDirections: ["east"],
  coordinates: null,
  osmUrl: "",
  rooms: [{ id: "room", name: "Стандарт", capacity: 2, demo: false }],
  route: null,
  noise: [],
};
function markup(match?: HotelMatch) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        FavoritesProvider,
        null,
        createElement(HotelCard, { hotel, match }),
      ),
    ),
  );
}

test("catalog preview does not claim a search match or invent a price", () => {
  const html = markup();
  assert.ok(html.includes("Цена и наличие не проверены"));
  assert.ok(!html.includes("Подходит под фильтры"));
  assert.ok(!html.includes("₩"));
  assert.ok(html.includes("Этаж: 2"));
  assert.ok(html.includes("Окна: восток"));
});

test("an owner-declared matching floor stays a match, not a mismatch", () => {
  const best: HotelMatch["best"] = {
    room: hotel.rooms[0],
    criteria: [],
    score: 1,
    status: "fits",
  };
  const html = markup({
    hotel,
    best,
    rooms: [best],
    ownerCriteria: [
      {
        id: "floor-0",
        feature: "floor",
        label: "Второй этаж",
        required: true,
        status: "match",
        evidenceStatus: "match",
        assumed: true,
        explanation: "По сведениям владельца",
        sourceExplanation: "По сведениям владельца",
      },
    ],
  });
  assert.ok(html.includes("Второй этаж: по сведениям отельера"));
  assert.ok(!html.includes("не совпадает"));
});

test("incomplete and impossible dates stay in catalog preview", () => {
  assert.equal(canSearch({ ...trip, checkIn: "", checkOut: "" }), false);
  assert.equal(
    canSearch({ ...trip, checkIn: "2027-02-29", checkOut: "2027-03-02" }),
    false,
  );
  assert.equal(canSearch({ ...trip, checkOut: trip.checkIn }), false);
  assert.equal(canSearch({ ...trip, adults: 7 }), false);
  assert.equal(canSearch({ ...trip, children: 5 }), false);
  assert.equal(canSearch(trip), true);
});

function decision(overrides: Partial<CriterionDecision> = {}): CriterionDecision {
  return { feature: "courtyard", required: true, status: "mismatch",
    evidenceStatus: "unknown", assumed: true, decisionBasis: "estimate",
    facts: [], explanation: "Направление окон неизвестно", sourceExplanation: "Нет источника",
    ...overrides };
}
function evaluated(overrides: Partial<HotelMatch["best"]> = {}): HotelMatch {
  const best: HotelMatch["best"] = { room: hotel.rooms[0], criteria: [], score: 0,
    status: "excluded", capacityStatus: "match", capacityEvidenceStatus: "match", capacityAssumed: false,
    ...overrides };
  return { hotel, best, rooms: [best] };
}
function diagnostics(match: HotelMatch) {
  const data: SearchResult = { searchId: "test", results: [], excluded: [match],
    preferences: [], conflicts: [], warnings: [], trace: [], mode: "rules" };
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SearchDiagnostics, { data })));
}

test("unknown capacity is a clarification, never an established shortage", () => {
  const match = evaluated({ capacityStatus: "mismatch", capacityEvidenceStatus: "unknown", capacityAssumed: true });
  assert.match(diagnostics(match), /Вместимость требует уточнения/);
  assert.doesNotMatch(diagnostics(match), /Недостаточная вместимость/);
  const summary = renderToStaticMarkup(createElement(CapacitySummary, { match: match.best }));
  assert.match(summary, /Вместимость не подтверждена/);
  assert.doesNotMatch(summary, /Не вмещает|capacity-mismatch/);
  assert.match(markup(match), /Нужны уточнения/);
  assert.doesNotMatch(markup(match), /Подходит под фильтры|Подходит с предположениями/);
  const insufficient = evaluated({ capacityStatus: "mismatch", capacityEvidenceStatus: "mismatch" });
  assert.match(diagnostics(insufficient), /Недостаточная вместимость/);
  assert.match(markup(insufficient), /Не подходит под фильтры/);
});

test("unknown, stale and conflicting conditions stay distinct from a known mismatch", () => {
  for (const evidenceStatus of ["unknown", "stale", "conflict"] as const) {
    // Defensive rendering must use the evidence status even if an older producer omits assumed=true.
    const criterion = decision({ evidenceStatus, assumed: false });
    const match = evaluated({ criteria: [criterion] });
    assert.match(diagnostics(match), /требует уточнения/);
    assert.match(markup(match), /требует уточнения/);
    assert.doesNotMatch(markup(match), /не совпадает/);
    const line = renderToStaticMarkup(createElement(CriterionLine, { criterion }));
    assert.match(line, /criterion unknown/);
    assert.doesNotMatch(line, /Не соответствует фильтру/);
  }
  const known = evaluated({ criteria: [decision({ evidenceStatus: "mismatch", assumed: false })] });
  assert.match(diagnostics(known), /не соответствует/);
  assert.match(markup(known), /не совпадает/);
});

test("optional unknowns and mismatches are not advertised as matching every filter", () => {
  const unknown = evaluated({ status: "fits", criteria: [decision({ required: false })] });
  assert.match(markup(unknown), /Есть условия для уточнения/);
  const mismatch = evaluated({ status: "fits", criteria: [decision({ required: false, evidenceStatus: "mismatch", assumed: false })] });
  assert.match(markup(mismatch), /Есть несовпадения с пожеланиями/);
  assert.doesNotMatch(markup(mismatch), /Подходит под фильтры/);
});

test("unconfirmed positive status is not counted as a confirmed wish match", () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(WishMatches, { criteria: [decision({ status: "match" })] })));
  assert.match(html, /Совпало 0 из 1/);
  assert.doesNotMatch(html, /Обязательные условия выполнены/);
  assert.match(html, /Требует уточнения/);
});

test("owner evidence keeps reported mismatches and missing information separate", () => {
  for (const evidenceStatus of ["unknown", "mismatch"] as const) {
    const match = evaluated();
    match.ownerCriteria = [{ id: "floor", feature: "floor", label: "Этаж", required: true,
      status: "mismatch", evidenceStatus, assumed: true,
      explanation: "Сведения владельца", sourceExplanation: "Без независимой проверки" }];
    const html = renderToStaticMarkup(createElement(MatchBadge, { match }));
    assert.match(html, evidenceStatus === "unknown" ? /Нужны уточнения/ : /Не подходит под фильтры/);
    assert.match(html, evidenceStatus === "unknown" ? /match-badge unknown/ : /match-badge excluded/);
  }
});
