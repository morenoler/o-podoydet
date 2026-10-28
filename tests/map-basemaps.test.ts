import test from "node:test";
import assert from "node:assert/strict";
import { createBasemaps, imageryAttribution, OSM_ATTRIBUTION } from "../src/features/map/basemaps";

test("a missing imagery key leaves OSM available without issuing anonymous imagery requests", () => {
  for (const key of [undefined, "", "  "]) {
    const maps = createBasemaps(key);
    assert.equal(maps.satellite.available, false);
    assert.equal(maps.satellite.url, "");
    assert.equal(maps.satellite.metadataUrl, undefined);
    assert.equal(maps.streets.available, true);
    assert.equal(maps.streets.maxNativeZoom, 19);
    assert.match(maps.streets.url, /tile\.openstreetmap\.org/);
  }
});

test("imagery uses the authorized ArcGIS service and native city zoom with encoded browser token", () => {
  const { satellite } = createBasemaps(" synthetic-token&unexpected=1 ");
  assert.equal(satellite.available, true);
  assert.match(satellite.url, /^https:\/\/ibasemaps-api\.arcgis\.com\//);
  assert.match(satellite.url, /\/tile\/\{z\}\/\{y\}\/\{x\}\?token=synthetic-token%26unexpected%3D1$/);
  assert.equal(satellite.maxNativeZoom, 19);
  assert.match(satellite.attribution, /Powered by.*Esri/);
  assert.match(OSM_ATTRIBUTION, /OpenStreetMap contributors/);
});

test("imagery credits come from provider metadata, are escaped and require a successful response", () => {
  const base = createBasemaps("synthetic-token").satellite.attribution;
  const credit = imageryAttribution({ copyrightText: 'Esri, Vantor & <img src=x onerror="test">' }, base);
  assert.match(credit, /Powered by/);
  assert.match(credit, /Esri, Vantor &amp; &lt;img/);
  assert.doesNotMatch(credit, /<img/);
  for (const invalid of [null, {}, { copyrightText: "" }, { error: { code: 498 }, copyrightText: "Esri" }, { copyrightText: 12 }])
    assert.throws(() => imageryAttribution(invalid, base));
});
