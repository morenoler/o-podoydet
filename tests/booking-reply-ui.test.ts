import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Booking } from "../shared/account";
import { accountApi } from "../src/features/account/api";
registerHooks({ load(url, context, nextLoad) { return url.endsWith(".css") ? { format: "module", source: "export default {};", shortCircuit: true } : nextLoad(url, context); } });
const { BookingReply } = await import("../src/features/account/components/BookingReply");
const booking: Booking = {
  id: "fixture-booking", listingId: "fixture-listing", listingTitle: "ДЕМО учебный номер", city: "Пусан", address: "Вымышленный адрес", userId: "fixture-user", guestName: "ДЕМО гость", guestEmail: "fixture@example.invalid", hostId: "fixture-host",
  checkIn: "2027-06-10", checkOut: "2027-06-14", guests: 2, nights: 4, pricePerNight: 100000, totalPrice: 400000, currency: "KRW", status: "pending", note: "Есть ли доплата за бассейн?", createdAt: "2026-10-28T00:00:00Z", updatedAt: "2026-10-28T00:00:00Z", photos: [], roomType: "Учебная категория",
};
test("traveler sees private reply, date and booking limits without a host edit form", () => {
  const html = renderToStaticMarkup(createElement(BookingReply, { booking: { ...booking, hostReply: "Бассейн доступен, доплата 10 000 KRW.", repliedAt: "2026-10-28T01:00:00Z" }, host: false }));
  assert.match(html, /Есть ли доплата за бассейн/);
  assert.match(html, /Бассейн доступен/);
  assert.match(html, /10:00/);
  assert.match(html, /Пусан/);
  assert.match(html, /Ответ не меняет статус заявки/);
  assert.doesNotMatch(html, /<textarea|Отправить ответ гостю/);
});
test("host has a bounded private reply form with accessible context and an empty-send guard", () => {
  const html = renderToStaticMarkup(createElement(BookingReply, { booking, host: true }));
  assert.match(html, /Вопросы гостя и ваш ответ/);
  assert.match(html, /maxLength="3000"/i);
  assert.match(html, /Ответ увидит только гость этой заявки/);
  assert.match(html, /disabled="">Отправить ответ гостю/);
  assert.match(html, /aria-describedby=/);
});
test("booking reply API sends only message and does not request price/status changes", async () => {
  const original = globalThis.fetch;
  let captured: { url: string; body: unknown } | undefined;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ ...booking, hostReply: "Учебный ответ", repliedAt: "2026-10-28T01:00:00Z" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const updated = await accountApi.replyToBooking(booking.id, "Учебный ответ");
    assert.deepEqual(captured, { url: "/api/host/bookings/fixture-booking/reply", body: { message: "Учебный ответ" } });
    assert.equal(updated.status, "pending");
    assert.equal(updated.totalPrice, booking.totalPrice);
  } finally { globalThis.fetch = original; }
});
