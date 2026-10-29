import test from "node:test";
import assert from "node:assert/strict";
import { createBasemaps, imageryAttribution, OSM_ATTRIBUTION } from "../src/features/map/basemaps";

test("local development requests detailed Stadia tiles without an account or overzoom", () => {
  for (const hostname of ["localhost", "127.0.0.1"]) {
    const { satellite, streets } = createBasemaps(undefined, { hostname });
    assert.equal(satellite.url, "https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}.jpg");
    assert.equal(satellite.maxNativeZoom, streets.maxZoom);
    assert.equal(satellite.maxNativeZoom, satellite.maxZoom);
    assert.equal(satellite.maxNativeZoom, 19);
    assert.match(satellite.attribution, /CNES.*Airbus DS.*PlanetObserver.*Stadia Maps.*OpenMapTiles/);
    assert.doesNotMatch(satellite.description!, /10 м|2021|без новых деталей/);
  }
});

test("public hosts never silently use Stadia's localhost exception", () => {
  for (const hostname of [undefined, "example.org", "localhost.example.org", "127.0.0.1.example.org", "192.168.1.10", "[::1]"]) {
    const { satellite } = createBasemaps(undefined, { hostname });
    assert.match(satellite.url, /wmts\.terrascope\.be/);
    assert.equal(satellite.maxNativeZoom, 14);
  }
});

test("Stadia public access requires explicit domain auth or an encoded account key", () => {
  const { satellite } = createBasemaps(undefined, { hostname: "example.org", stadiaApiKey: " test&key=1 " });
  assert.match(satellite.url, /\.jpg\?api_key=test%26key%3D1$/);
  assert.match(createBasemaps(undefined, { stadiaDomainAuth: true }).satellite.url, /stadiamaps\.com/);
  assert.doesNotMatch(createBasemaps(undefined, { stadiaApiKey: "  " }).satellite.url, /stadiamaps\.com/);
  assert.match(createBasemaps("existing-esri-key", { hostname: "localhost", stadiaApiKey: "test" }).satellite.url, /arcgis\.com/);
});

test("a missing imagery key provides licensed overview satellite tiles without an ArcGIS request", () => {
  for (const key of [undefined, "", "  "]) {
    const maps = createBasemaps(key);
    assert.equal(maps.satellite.available, true);
    const url = new URL(maps.satellite.url);
    assert.equal(url.origin + url.pathname, "https://wmts.terrascope.be/wmts");
    assert.equal(url.searchParams.get("REQUEST"), "GetTile");
    assert.equal(url.searchParams.get("LAYER"), "esa-worldcover-s2rgbnir-10m-2021-v2_tcc");
    assert.equal(url.searchParams.get("TIME"), "2021-01-01");
    assert.deepEqual(["TILEMATRIXSET", "TILEMATRIX", "TILEROW", "TILECOL"].map(name => url.searchParams.get(name)),
      ["EPSG:3857", "{z}", "{y}", "{x}"]);
    assert.equal(maps.satellite.maxNativeZoom, 14);
    assert.equal(maps.satellite.maxZoom, maps.streets.maxZoom);
    assert.equal(maps.satellite.maxZoom, 19);
    assert.ok(maps.satellite.maxZoom > maps.satellite.maxNativeZoom);
    assert.equal(maps.satellite.metadataUrl, undefined);
    assert.match(maps.satellite.attribution, /Copernicus Sentinel data \(2021\)/);
    assert.match(maps.satellite.attribution, /licenses\/by\/4\.0/);
    assert.match(maps.satellite.label!, /2021.*10 м/);
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
  assert.equal(satellite.maxZoom, 19);
  assert.match(satellite.attribution, /Powered by.*Esri/);
  assert.match(satellite.description!, /Esri World Imagery/);
  assert.doesNotMatch(satellite.description!, /2021|10 м/);
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
