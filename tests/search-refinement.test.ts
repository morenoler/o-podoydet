import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFilterDraft } from "../src/features/search/preferences";
import { dateFull, dateLabel } from "../src/shared/lib/date";
import type { Trip } from "../shared/types";

const base: Trip = { region: "Пусан", checkIn: "2027-06-01", checkOut: "2027-06-08", adults: 2, children: 0, scenarios: [], preferences: [], text: "" };

test("filter dialog rebases its changed field without losing a chat update", () => {
  const initial = { ...base, hotelFilters: { query: "Signiel" } };
  const live = { ...initial, hotelFilters: { query: "Paradise", maxBeachMeters: 600 } };
  const draft = { ...initial, hotelFilters: { query: "Signiel", maxPricePerNight: 80000 } };
  assert.deepEqual(applyFilterDraft(live, [], initial, draft).hotelFilters,
    { query: "Paradise", maxBeachMeters: 600, maxPricePerNight: 80000 });
});

test("removing a filter and resetting never changes dates or guests", () => {
  const initial = { ...base, hotelFilters: { query: "балкон", maxPricePerNight: 90000 } };
  const draft = { ...initial, hotelFilters: { query: "балкон" } };
  const changed = applyFilterDraft(initial, [], initial, draft);
  assert.equal(changed.hotelFilters?.maxPricePerNight, undefined);
  const reset = applyFilterDraft(initial, [], initial, { ...base, hotelFilters: undefined }, true);
  assert.equal(reset.hotelFilters, undefined);
  assert.equal(reset.checkIn, base.checkIn);
  assert.equal(reset.adults, base.adults);
});

test("date-only trip dates keep their calendar day across time zones", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["America/Los_Angeles", "Pacific/Honolulu", "Asia/Seoul", "Pacific/Kiritimati"]) {
      process.env.TZ = zone;
      assert.match(dateFull("2026-11-01"), /^1 ноября 2026/);
      assert.match(dateLabel("2026-11-01"), /^1 нояб/);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
