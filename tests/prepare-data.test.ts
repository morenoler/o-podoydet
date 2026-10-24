import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { prepareDataset, type Snapshot } from "../scripts/prepare-data";
import type { Dataset, Hotel } from "../shared/types";

const types: NonNullable<Hotel["lodgingType"]>[] = [
  "hotel",
  "motel",
  "guest_house",
  "hostel",
  "apartment",
];
function fixture(): Snapshot {
  return {
    regionKey: "busan-haeundae",
    bbox: "35.150,129.145,35.175,129.180",
    fetchedAt: "2026-10-24T10:00:00.000Z",
    sourceDate: "2026-10-24T09:00:00.000Z",
    elements: [
      {
        type: "way",
        id: 10,
        nodes: [1, 2, 3],
        tags: { highway: "footway" },
        geometry: [
          { lon: 129.146, lat: 35.174 },
          { lon: 129.16, lat: 35.174 },
          { lon: 129.178, lat: 35.151 },
        ],
      },
      {
        type: "way",
        id: 20,
        tags: { natural: "beach", name: "Synthetic test beach" },
        geometry: [
          { lon: 129.178, lat: 35.151 },
          { lon: 129.1781, lat: 35.151 },
        ],
      },
      ...types.map((tourism, i) => ({
        type: "node" as const,
        id: 100 + i,
        lon: 129.146,
        lat: 35.174,
        tags: { tourism, name: `Synthetic ${tourism}` },
      })),
      {
        type: "node",
        id: 200,
        lon: 129.15,
        lat: 35.157,
        tags: { tourism: "hotel", name: "Synthetic disconnected lodging" },
      },
      {
        type: "node",
        id: 201,
        lon: 129.178,
        lat: 35.151,
        tags: { tourism: "hotel", name: "Synthetic beach point" },
      },
      {
        type: "node",
        id: 202,
        lon: 129.19,
        lat: 35.151,
        tags: { tourism: "hotel", name: "Synthetic outside snapshot" },
      },
    ],
  };
}

test("all five lodging types survive absent, over-2500m and zero-length routes without invented beach facts", () => {
  const result = prepareDataset(fixture());
  assert.equal(result.hotels.length, 7);
  assert.deepEqual(
    result.hotels.slice(0, 5).map((h) => h.lodgingType),
    types,
  );
  assert.ok(result.hotels.every((h) => h.route === null));
  assert.ok(
    !result.facts.some((f) => f.feature === "beach_walk" || f.method === "geo"),
  );
  assert.equal(new Set(result.hotels.map((h) => h.id)).size, 7);
});

test("rebuild preserves existing room identities and evidence dates despite candidate order changes", () => {
  const raw = fixture(),
    previous = prepareDataset(raw);
  previous.hotels[0].rooms = [
    {
      id: "kept-room-id",
      name: "Existing demonstration category",
      capacity: 3,
      demo: true,
    },
  ];
  previous.facts = [
    {
      id: "kept-fact-id",
      hotelId: previous.hotels[0].id,
      roomId: "kept-room-id",
      feature: "family",
      value: false,
      source: "Synthetic fixture",
      quote: "Preserve exactly",
      method: "demo",
      confidence: "low",
      confidenceReason: "Test only",
      obtainedAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-02-01T00:00:00.000Z",
      demo: true,
    },
  ];
  raw.elements.reverse();
  const next = prepareDataset(raw, previous);
  assert.deepEqual(
    next.hotels.find((h) => h.id === previous.hotels[0].id)?.rooms,
    previous.hotels[0].rooms,
  );
  assert.deepEqual(
    next.facts.find((f) => f.id === "kept-fact-id"),
    previous.facts[0],
  );
  assert.equal(next.sourceDate, previous.sourceDate);
  assert.equal(next.fetchedAt, previous.fetchedAt);
});

test("expanded saved catalogue is backed by named OSM objects in the unchanged Haeundae bbox", () => {
  const raw = JSON.parse(
    readFileSync("data/osm-busan-haeundae-snapshot.json", "utf8"),
  ) as Snapshot;
  const data = JSON.parse(readFileSync("data/demo.json", "utf8")) as Dataset;
  const source = new Map(raw.elements.map((e) => [`${e.type}-${e.id}`, e]));
  assert.ok(data.hotels.length >= 60 && data.hotels.length <= 130);
  assert.deepEqual(data.bbox, [129.145, 35.15, 129.18, 35.175]);
  for (const hotel of data.hotels) {
    const element = source.get(hotel.id);
    assert.ok(element, hotel.id);
    assert.equal(hotel.lodgingType, element.tags?.tourism);
    assert.ok(
      [
        element.tags?.name,
        element.tags?.["name:en"],
        element.tags?.["name:ru"],
      ].includes(hotel.name),
    );
    if (!hotel.route)
      assert.ok(
        !data.facts.some(
          (f) => f.hotelId === hotel.id && f.feature === "beach_walk",
        ),
      );
  }
  assert.ok(new Set(data.hotels.map((h) => h.lodgingType)).size >= 4);
});
