import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Hotel } from "../shared/types";
import { detailMapPoints } from "../src/features/map/mapData";
import { nearbyDisplayPlaces, placePresentation, validMapPlaces, type SurroundingPlace } from "../src/features/places/placePresentation";
import { NearbyPlaceList } from "../src/features/places/NearbyPlaces";

const place: SurroundingPlace = { id: "poi", name: "Test pharmacy", meters: 230, sourceUrl: "https://www.openstreetmap.org/node/2", categories: ["pharmacy"], coordinates: [129.161, 35.161] };
const hotel: Hotel = { id: "node-1", name: "Test hotel", address: "", osmUrl: "https://www.openstreetmap.org/node/1", coordinates: [129.16, 35.16], rooms: [], noise: [], route: null };

test("nearby places retain category, name, approximate distance and original source", () => {
  const html = renderToStaticMarkup(createElement(NearbyPlaceList, { places: [place] }));
  assert.match(html, /Test pharmacy/);
  assert.match(html, /≈ 230 м/);
  assert.match(html, /расстояние по прямой/);
  assert.ok(html.includes(place.sourceUrl));
  assert.match(html, /<svg/);
  assert.equal(placePresentation(["pharmacy"]).label, "Аптека");
  assert.equal(placePresentation(["bar"]).tone, "purple");
  assert.equal(placePresentation(["unknown"]).label, "Место");
});

test("nearby lists exclude the hotel itself, duplicates and invalid distances", () => {
  assert.deepEqual(nearbyDisplayPlaces([place, place, { ...place, id: "self", sourceUrl: hotel.osmUrl }, { ...place, id: "bad", meters: -1 }, { ...place, id: "nan", meters: NaN }], hotel.id), [place]);
});

test("detail bounds include only real map points and do not force a beach route", () => {
  const invalid = [{ ...place, id: "missing", coordinates: undefined }, { ...place, id: "invalid", coordinates: [NaN, 35] }, { ...place, id: "polar", coordinates: [129, 90] }] as SurroundingPlace[];
  assert.deepEqual(validMapPlaces([place, ...invalid]), [place]);
  const withRoute = { ...hotel, route: { meters: 1000, coordinates: [[129.17, 35.16], [129.2, 35.2]], wayIds: [], steps: 0, beachName: "Test beach", beachId: 1, connectionMeters: 0, approximate: true } } as Hotel;
  assert.deepEqual(detailMapPoints(withRoute, [place, ...invalid], false), [hotel.coordinates, place.coordinates]);
  assert.equal(detailMapPoints(withRoute, [place], true).length, 4);
  assert.deepEqual(detailMapPoints({ ...withRoute, synthetic: true }, [place], false), []);
  assert.deepEqual(place.coordinates, [129.161, 35.161]);
});
