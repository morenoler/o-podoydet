import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { catalogueRegionAtPoint, pointLabel } from "../src/features/search/landingSearch";
import { SearchBar } from "../src/features/search/SearchBar";
import type { Trip } from "../shared/types";

test("globe picks resolve only inside a supported catalogue city's vicinity", () => {
  assert.equal(catalogueRegionAtPoint({ latitude: 35.1796, longitude: 129.0756 }), "Пусан");
  assert.equal(catalogueRegionAtPoint({ latitude: 35.16, longitude: 129.16 }), "Пусан");
  assert.equal(catalogueRegionAtPoint({ latitude: 43.58, longitude: 39.72 }), "Сочи");
  assert.equal(catalogueRegionAtPoint({ latitude: 37.5665, longitude: 126.978 }), undefined, "Seoul must not silently become Busan");
  assert.equal(catalogueRegionAtPoint({ latitude: 55.75, longitude: 37.62 }), undefined, "Moscow is not a connected catalogue");
  assert.equal(catalogueRegionAtPoint({ latitude: 0, longitude: 180 }), undefined);
  assert.equal(catalogueRegionAtPoint({ latitude: 43.58, longitude: 39.72 }, ["Пусан"]), undefined, "backend availability is respected");
});

test("invalid globe coordinates cannot select a catalogue city", () => {
  for (const point of [{ latitude: NaN, longitude: 129 }, { latitude: 95, longitude: 39 }, { latitude: 35, longitude: Infinity }, { latitude: 35, longitude: 489 }]) {
    assert.equal(catalogueRegionAtPoint(point), undefined);
  }
  assert.equal(pointLabel({ latitude: -33.86, longitude: 151.2 }), "33.9° ю. ш., 151.2° в. д.");
  assert.equal(pointLabel({ latitude: 40.7, longitude: -74 }), "40.7° с. ш., 74.0° з. д.");
});

test("landing exposes the selected point and disables unsupported searches with an accessible explanation", () => {
  const trip: Trip = { region: "Пусан", checkIn: "2028-11-10", checkOut: "2028-11-15", adults: 2, children: 0, preferences: [], scenarios: [], text: "" };
  const html = renderToStaticMarkup(createElement(SearchBar, { trip, onSearch() {}, onChange() {}, variant: "landing", destinationLabel: "40.7° с. ш., 74.0° з. д.", searchDisabled: true }));
  assert.match(html, /40\.7° с\. ш\., 74\.0° з\. д\./);
  assert.match(html, /class="button primary search-bar-submit" disabled="" aria-label="Найти" aria-describedby="landing-coverage-note"/);
  assert.match(html, /class="search-bar-submit-label">Найти/);
});
