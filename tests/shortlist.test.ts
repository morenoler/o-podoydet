import assert from "node:assert/strict";
import test from "node:test";
import { emptyShortlist, importShortlist, mergeShortlistItems, parseShortlist, safeFavorite, shortlistTrip } from "../src/features/favorites/shortlistState";
import type { Trip } from "../shared/types";
const item = { id: "hotel::room", name: "Номер", path: "/hotels/hotel?room=room", note: "Моя заметка", stage: "clarify" as const };

test("legacy saved cards keep room identity and acquire neutral next step", () => {
  const value = parseShortlist({ items: [{ id: item.id, name: item.name, path: item.path }] });
  assert.equal(value.items[0].id, item.id);
  assert.equal(value.items[0].stage, "considering");
  assert.equal(value.items[0].note, "");
  assert.equal(value.trip, null);
});
test("browser import preserves account notes and does not duplicate variants", () => {
  const imported = mergeShortlistItems([item], [{ ...item, note: "Старая заметка" }, { ...item, id: "another" }, { ...item, id: "another" }]);
  assert.equal(imported.length, 2);
  assert.equal(imported[0].note, "Моя заметка");
});
test("malformed storage does not crash or create unsafe links and images", () => {
  assert.deepEqual(parseShortlist(null), emptyShortlist());
  assert.deepEqual(parseShortlist([]), emptyShortlist());
  for (const path of ["javascript:alert(1)", "//evil.test", "/hotels/a?next=secret", "/hotels/a#secret", "/hotels/a\\b"]) assert.equal(safeFavorite({ ...item, path }), null);
  const safe = safeFavorite({ ...item, photos: ["javascript:alert(1)", "/images/../private.jpg", "/images/hotel.jpg", "https://photos.test/1.jpg"], stage: "confirmed" });
  assert.deepEqual(safe?.photos, ["/images/hotel.jpg", "https://photos.test/1.jpg"]);
  assert.equal(safe?.stage, "considering");
  assert.equal(parseShortlist({ items: [item, item] }).items.length, 1);
});
test("saved trip supports browsing without dates and keeps structured wishes", () => {
  const trip = { region: "Пусан", checkIn: "", checkOut: "", adults: 2, children: 0, preferences: [{ feature: "courtyard", required: true }], scenarios: [], text: "Хочу во двор" };
  assert.deepEqual(shortlistTrip(trip), trip);
  assert.equal(shortlistTrip({ ...trip, checkIn: "nonsense" }), null);
  assert.equal(shortlistTrip({ ...trip, preferences: [{ feature: "invented", required: true }] }), null);
  assert.equal(shortlistTrip({ ...trip, checkIn: "2026-11-03", checkOut: "2026-11-02" }), null);
});

test("sign-in import keeps saved journey A even after the active search changed to B", () => {
  const trip = { region: "Пусан", checkIn: "2026-12-01", checkOut: "2026-12-04", adults: 2, children: 1, preferences: [{ feature: "courtyard" as const, required: true }], scenarios: [], text: "Тихий отдых" };
  const guest = { ...emptyShortlist(), title: "Семейная поездка A", trip, items: [item] };
  const imported = importShortlist(emptyShortlist(), guest);
  assert.equal(imported.title, guest.title);
  assert.deepEqual(imported.trip, guest.trip);
  assert.equal(imported.items[0].note, item.note);
  const account = { ...emptyShortlist(), title: "Поездка B", trip: { ...trip, checkIn: "2027-02-01", checkOut: "2027-02-08" }, items: [{ ...item, id: "different" }] };
  const merged = importShortlist(account, guest);
  assert.equal(merged.title, "Поездка B");
  assert.deepEqual(merged.trip, account.trip);
  assert.equal(merged.items.length, 2);
});

test("Sochi saved journey retains its currency-bound budget, catalog limits and amenity wishes", () => {
  const trip: Trip = {
    region: "Сочи", checkIn: "2026-12-01", checkOut: "2026-12-04", adults: 2, children: 0,
    preferences: [{ feature: "washing_machine", required: true }, { feature: "pool", required: false }],
    scenarios: [], text: "Стиралка обязательна", admissionMode: "explore",
    hotelFilters: { maxPricePerNight: 8000, lodgingTypes: ["apartment"], query: "балкон",
      nearby: [{ kind: "beach", maxMeters: 900 }] },
  };
  const saved = parseShortlist({ ...emptyShortlist(), title: "Зима в Сочи", trip, items: [item] });
  assert.deepEqual(saved.trip, trip);
  assert.deepEqual(importShortlist(emptyShortlist(), saved).trip, trip);
  assert.deepEqual(shortlistTrip({ ...trip, checkIn: "", checkOut: "" }), { ...trip, checkIn: "", checkOut: "" });
  assert.equal(shortlistTrip({ ...trip, region: "Несуществующий регион" }), null);
});

test("importing Busan cards into a saved Sochi trip does not reinterpret the account budget", () => {
  const sochi: Trip = { region: "Сочи", checkIn: "", checkOut: "", adults: 2, children: 0,
    preferences: [], scenarios: [], text: "", hotelFilters: { maxPricePerNight: 8000 } };
  const busan: Trip = { ...sochi, region: "Пусан", hotelFilters: { maxPricePerNight: 150000 } };
  const account = { ...emptyShortlist(), title: "Сочи", trip: sochi, items: [item] };
  const browser = { ...emptyShortlist(), title: "Пусан", trip: busan, items: [{ ...item, id: "busan-room" }] };
  const merged = importShortlist(account, browser);
  assert.deepEqual(merged.trip, sochi);
  assert.equal(merged.title, account.title);
  assert.equal(merged.items.length, 2);
  assert.equal(emptyShortlist().title, "Моя поездка");
});
